/**
 * Runtime Config Service — DB-stored runtime overrides cho auto-reply config.
 *
 * Cho phép admin toggle dryRun=true/false qua API mà không cần restart.
 * Có xác nhận, audit log, backup tự động trước khi bật live.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../db.js";
import { runConfigChecks } from "../config-consistency.js";
import { config } from "../config.js";

// ── Types ────────────────────────────────────────────────────────────

export interface EffectiveAutoReplyConfig {
  enabled: boolean;
  dryRun: boolean;
  allowedThreads: string[];
  cooldownSeconds: number;
  groupReplyWindowSeconds: number;
  /** Source of dryRun: "env" | "runtime" */
  dryRunSource: "env" | "runtime";
}

export interface RuntimeConfigEntry {
  key: string;
  value: string;
  updatedBy: string;
  updatedAt: string;
}

export interface SetRuntimeConfigInput {
  dryRun: boolean;
  confirmText: string;
  reason: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SetRuntimeConfigResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  backupName?: string;
  oldValue?: string;
  newValue?: string;
}

// ── Keys ─────────────────────────────────────────────────────────────

const KEY_AUTO_REPLY_DRY_RUN = "autoReply.dryRun";

// ── In-memory cache ──────────────────────────────────────────────────
// Updated at startup and on every setRuntimeConfig() call.
// All sync code reads from this cache for immediate effect.
let _cachedDryRun: boolean | null = null;

/** Initialize the cache from DB at startup. Call once at app boot. */
export async function initRuntimeConfig(): Promise<void> {
  try {
    const runtime = await prisma.runtimeSetting.findUnique({
      where: { key: KEY_AUTO_REPLY_DRY_RUN },
    });
    _cachedDryRun = runtime ? runtime.value === "true" : null;
    console.log(
      `[runtime-config] Initialized: dryRun=${getCurrentEffectiveDryRun()} (source: ${_cachedDryRun !== null ? "runtime" : "env"})`,
    );
  } catch {
    _cachedDryRun = null;
  }
}

/** Get current effective dryRun (sync — safe for all code paths). */
export function getCurrentEffectiveDryRun(): boolean {
  return _cachedDryRun ?? config.autoReply.dryRun;
}

// ── Get effective config ─────────────────────────────────────────────

/**
 * Lấy effective auto-reply config: DB RuntimeSetting override trước, env fallback sau.
 * Dùng hàm này ở mọi nơi cần biết dryRun thực tế.
 */
export async function getEffectiveAutoReplyConfig(): Promise<EffectiveAutoReplyConfig> {
  let dryRun = config.autoReply.dryRun;
  let dryRunSource: "env" | "runtime" = "env";

  try {
    const runtime = await prisma.runtimeSetting.findUnique({
      where: { key: KEY_AUTO_REPLY_DRY_RUN },
    });
    if (runtime) {
      dryRun = runtime.value === "true";
      dryRunSource = "runtime";
    }
  } catch {
    // DB not available — fall back to env
  }

  return {
    enabled: config.autoReply.enabled,
    dryRun,
    allowedThreads: config.autoReply.allowedThreads,
    cooldownSeconds: config.autoReply.cooldownSeconds,
    groupReplyWindowSeconds: config.autoReply.groupReplyWindowSeconds,
    dryRunSource,
  };
}

/**
 * Sync version — dùng ở nơi không thể await (constructors, etc).
 * Chỉ dùng env config, không check DB.
 */
export function getEffectiveAutoReplyConfigSync(): EffectiveAutoReplyConfig {
  return {
    enabled: config.autoReply.enabled,
    dryRun: config.autoReply.dryRun,
    allowedThreads: config.autoReply.allowedThreads,
    cooldownSeconds: config.autoReply.cooldownSeconds,
    groupReplyWindowSeconds: config.autoReply.groupReplyWindowSeconds,
    dryRunSource: "env",
  };
}

// ── Get all runtime settings ─────────────────────────────────────────

export async function getRuntimeConfig(): Promise<RuntimeConfigEntry[]> {
  try {
    const rows = await prisma.runtimeSetting.findMany({
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((r) => ({
      key: r.key,
      value: r.value,
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt.toISOString(),
    }));
  } catch {
    return [];
  }
}

// ── Set runtime config (with validation) ─────────────────────────────

export async function setRuntimeConfig(
  input: SetRuntimeConfigInput,
): Promise<SetRuntimeConfigResult> {
  const { dryRun, confirmText, reason, ipAddress, userAgent } = input;

  // ── 1. Validate confirm text ───────────────────────────────────
  if (dryRun === false) {
    // Switching to LIVE mode
    if (confirmText !== "ENABLE LIVE MODE") {
      return {
        success: false,
        error: "Confirmation text must be exactly 'ENABLE LIVE MODE' to enable live mode",
        errorCode: "BAD_CONFIRM_TEXT",
      };
    }
    if (!reason || reason.trim().length < 10) {
      return {
        success: false,
        error: "Reason is required (minimum 10 characters) to enable live mode",
        errorCode: "REASON_TOO_SHORT",
      };
    }

    // Check config consistency
    const configCheck = runConfigChecks();
    if (configCheck.status === "CONFIG_ERROR") {
      return {
        success: false,
        error: `Cannot enable live mode while config has errors: ${configCheck.summary.error} error(s)`,
        errorCode: "CONFIG_ERROR",
      };
    }

    // Check recent backup
    const hasRecentBackup = await checkRecentBackupInDb();
    if (!hasRecentBackup) {
      // Try to create backup automatically
      const backupName = await createAutoBackup();
      if (!backupName) {
        return {
          success: false,
          error: "No recent backup found and automatic backup failed — cannot enable live mode safely",
          errorCode: "NO_BACKUP",
        };
      }
      // Proceed with the auto-created backup
    }
  } else {
    // Switching to DRY RUN mode
    if (confirmText !== "ENABLE DRY RUN") {
      return {
        success: false,
        error: "Confirmation text must be exactly 'ENABLE DRY RUN' to enable dry-run mode",
        errorCode: "BAD_CONFIRM_TEXT",
      };
    }
  }

  // ── 2. Create backup before switching to live ───────────────────
  let backupName: string | undefined;
  if (dryRun === false) {
    backupName = await createAutoBackup() ?? undefined;
  }

  // ── 3. Get current value for audit ────────────────────────────
  let oldValue = String(config.autoReply.dryRun);
  try {
    const existing = await prisma.runtimeSetting.findUnique({
      where: { key: KEY_AUTO_REPLY_DRY_RUN },
    });
    if (existing) {
      oldValue = existing.value;
    }
  } catch {
    // ignore
  }
  const newValue = String(dryRun);

  // ── 4. Save to DB ─────────────────────────────────────────────
  try {
    await prisma.runtimeSetting.upsert({
      where: { key: KEY_AUTO_REPLY_DRY_RUN },
      create: {
        key: KEY_AUTO_REPLY_DRY_RUN,
        value: newValue,
        updatedBy: "admin",
      },
      update: {
        value: newValue,
        updatedBy: "admin",
      },
    });

    // ── 5. Write audit log ─────────────────────────────────────
    const confirmTextHash = createHash("sha256")
      .update(confirmText)
      .digest("hex")
      .slice(0, 16);

    await prisma.runtimeConfigAudit.create({
      data: {
        key: KEY_AUTO_REPLY_DRY_RUN,
        oldValue,
        newValue,
        changedBy: "admin",
        reason: reason || null,
        confirmTextHash,
        backupName: backupName || null,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    });

    // ── 6. Update in-memory cache for immediate effect ─────────
    _cachedDryRun = dryRun;
    console.log(
      `[runtime-config] dryRun toggled: ${oldValue} → ${newValue} (source: runtime, backup: ${backupName || "none"})`,
    );

    return {
      success: true,
      oldValue,
      newValue,
      backupName,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to save runtime config: ${msg}`,
      errorCode: "DB_ERROR",
    };
  }
}

// ── Get audit history ─────────────────────────────────────────────────

export async function getRuntimeConfigAudit(limit = 20) {
  try {
    const rows = await prisma.runtimeConfigAudit.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      oldValue: r.oldValue,
      newValue: r.newValue,
      changedBy: r.changedBy,
      reason: r.reason,
      backupName: r.backupName,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

async function checkRecentBackupInDb(): Promise<boolean> {
  const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  try {
    const count = await prisma.runtimeConfigAudit.count({
      where: {
        backupName: { not: null },
        createdAt: { gte: oneDayAgo },
      },
    });
    return count > 0;
  } catch {
    return false;
  }
}

async function createAutoBackup(): Promise<string | null> {
  try {
    const { execSync } = await import("node:child_process");
    const cwd = resolve(process.cwd(), "packages", "backend");
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const backupName = `auto-runtime-config-backup-${timestamp}.sqlite`;

    const dbPath = resolve(cwd, "prisma", "dev.db");
    const backupDir = resolve(cwd, "backups", "system");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(backupDir, { recursive: true });

    // Simple file copy for SQLite
    const { copyFileSync } = await import("node:fs");
    const destPath = resolve(backupDir, backupName);
    copyFileSync(dbPath, destPath);

    // Also copy session if exists
    const sessionSrc = resolve(cwd, "zalo-session", "zalo-session.json");
    if (existsSync(sessionSrc)) {
      const sessionDest = resolve(backupDir, `${backupName}.session.json`);
      copyFileSync(sessionSrc, sessionDest);
    }

    console.log(`[runtime-config] Auto-backup created: ${backupName}`);
    return backupName;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[runtime-config] Auto-backup failed: ${msg}`);
    return null;
  }
}
