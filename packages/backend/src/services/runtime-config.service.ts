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

/** DryRun decision with source tracking */
export interface EffectiveDryRunInfo {
  dryRun: boolean;
  source: "runtime" | "env";
}

/** Get effective dryRun + source (sync — no DB call, uses hot cache). */
export function getEffectiveDryRunInfo(): EffectiveDryRunInfo {
  return {
    dryRun: getCurrentEffectiveDryRun(),
    source: _cachedDryRun !== null ? "runtime" : "env",
  };
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

    // H1: Backup session from canonical path — not relative cwd/zalo-session
    const sessionSrc = resolve(config.zalo.sessionDir, "zalo-session.json");
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

// ═══════════════════════════════════════════════════════════════════════
// Batch 15 — Runtime Settings (general-purpose key-value store)
// ═══════════════════════════════════════════════════════════════════════

// ── Valid setting keys and their validation rules ─────────────────────

export interface RuntimeSettingMeta {
  key: string;
  label: string;
  category: string;
  type: "boolean" | "number" | "string" | "string[]";
  validate: (value: unknown) => string | null; // returns error message or null
  validateForSave?: (value: unknown, context: { allSettings: Record<string, string> }) => string | null;
}

const SETTING_META: Record<string, RuntimeSettingMeta> = {
  // ── Auto Reply ──
  "autoReply.enabled": {
    key: "autoReply.enabled", label: "Auto Reply Enabled", category: "autoReply", type: "boolean",
    validate: (v) => (typeof v !== "boolean" ? "Must be boolean" : null),
  },
  "autoReply.cooldownSeconds": {
    key: "autoReply.cooldownSeconds", label: "Cooldown (seconds)", category: "autoReply", type: "number",
    validate: (v) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return "Must be a number";
      if (v < 1 || v > 300) return "Must be 1-300";
      return null;
    },
  },
  "autoReply.allowedThreads": {
    key: "autoReply.allowedThreads", label: "Allowed Threads", category: "autoReply", type: "string[]",
    validate: (v) => {
      if (!Array.isArray(v)) return "Must be an array";
      if (!v.every((s: unknown) => typeof s === "string")) return "All items must be strings";
      return null;
    },
    validateForSave: (v, ctx) => {
      const enabled = ctx.allSettings["autoReply.enabled"];
      if (enabled === "true" && Array.isArray(v) && v.length === 0) {
        return "Cannot have empty allowedThreads when autoReply is enabled";
      }
      return null;
    },
  },

  // ── Message Batching ──
  "messageBatching.enabled": {
    key: "messageBatching.enabled", label: "Batching Enabled", category: "messageBatching", type: "boolean",
    validate: (v) => (typeof v !== "boolean" ? "Must be boolean" : null),
  },
  "messageBatching.windowMs": {
    key: "messageBatching.windowMs", label: "Batching Window (ms)", category: "messageBatching", type: "number",
    validate: (v) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return "Must be a number";
      if (v < 1000 || v > 15000) return "Must be 1000-15000";
      return null;
    },
  },
  "messageBatching.maxMessages": {
    key: "messageBatching.maxMessages", label: "Max Messages Per Batch", category: "messageBatching", type: "number",
    validate: (v) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return "Must be a number";
      if (v < 1 || v > 20) return "Must be 1-20";
      return null;
    },
  },
  "messageBatching.maxChars": {
    key: "messageBatching.maxChars", label: "Max Chars Per Batch", category: "messageBatching", type: "number",
    validate: (v) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return "Must be a number";
      if (v < 100 || v > 10000) return "Must be 100-10000";
      return null;
    },
  },
  "messageBatching.threadTypes": {
    key: "messageBatching.threadTypes", label: "Batching Thread Types", category: "messageBatching", type: "string[]",
    validate: (v) => {
      if (!Array.isArray(v)) return "Must be an array";
      const valid = ["user", "group"];
      if (!v.every((s: unknown) => typeof s === "string" && valid.includes(s))) {
        return "Must be 'user' and/or 'group'";
      }
      return null;
    },
    validateForSave: (v) => {
      if (Array.isArray(v) && v.includes("group")) {
        return "Group batching is not recommended for initial release — set to ['user'] only";
      }
      return null;
    },
  },

  // ── Document ──
  "document.enabled": {
    key: "document.enabled", label: "Document Ingestion", category: "document", type: "boolean",
    validate: (v) => (typeof v !== "boolean" ? "Must be boolean" : null),
  },
  "document.maxSizeMb": {
    key: "document.maxSizeMb", label: "Max File Size (MB)", category: "document", type: "number",
    validate: (v) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return "Must be a number";
      if (v < 1 || v > 100) return "Must be 1-100";
      return null;
    },
  },
  "document.allowedExtensions": {
    key: "document.allowedExtensions", label: "Allowed Extensions", category: "document", type: "string[]",
    validate: (v) => {
      if (!Array.isArray(v)) return "Must be an array";
      const safe = ["pdf", "docx", "txt", "md", "csv", "pptx", "xlsx"];
      const dangerous = ["exe", "sh", "bat", "cmd", "ps1", "js", "ts", "py", "rb", "env", "key", "pem"];
      for (const ext of v) {
        if (typeof ext !== "string") return "All items must be strings";
        if (dangerous.includes(ext.toLowerCase())) return `Extension '.${ext}' is not allowed for safety`;
        if (!safe.includes(ext.toLowerCase())) return `Extension '.${ext}' is not in the safe list: ${safe.join(", ")}`;
      }
      return null;
    },
  },

  // ── Vision ──
  "vision.enabled": {
    key: "vision.enabled", label: "Vision/OCR", category: "vision", type: "boolean",
    validate: (v) => (typeof v !== "boolean" ? "Must be boolean" : null),
  },
  "vision.maxImageSizeMb": {
    key: "vision.maxImageSizeMb", label: "Max Image Size (MB)", category: "vision", type: "number",
    validate: (v) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return "Must be a number";
      if (v < 1 || v > 50) return "Must be 1-50";
      return null;
    },
  },

  // ── Rule Engine ──
  "ruleEngine.enabled": {
    key: "ruleEngine.enabled", label: "Rule Engine", category: "ruleEngine", type: "boolean",
    validate: (v) => (typeof v !== "boolean" ? "Must be boolean" : null),
  },
};

export function getSettingMeta(): RuntimeSettingMeta[] {
  return Object.values(SETTING_META);
}

// ── Get all runtime settings (with effective values) ──────────────────

export interface RuntimeSettingEntry {
  key: string;
  value: string;
  label: string;
  category: string;
  updatedBy: string;
  updatedAt: string;
}

export async function getAllRuntimeSettings(): Promise<RuntimeSettingEntry[]> {
  try {
    const dbRows = await prisma.runtimeSetting.findMany({ orderBy: { updatedAt: "desc" } });
    const dbMap = new Map(dbRows.map((r) => [r.key, r]));

    const result: RuntimeSettingEntry[] = [];
    for (const meta of Object.values(SETTING_META)) {
      const dbRow = dbMap.get(meta.key);
      // Effective value: DB override first, then env/config fallback
      const effectiveValue = dbRow?.value ?? getEnvDefault(meta.key);
      result.push({
        key: meta.key,
        value: effectiveValue,
        label: meta.label,
        category: meta.category,
        updatedBy: dbRow?.updatedBy ?? "default",
        updatedAt: dbRow?.updatedAt.toISOString() ?? new Date(0).toISOString(),
      });
    }
    return result;
  } catch {
    return [];
  }
}

/** Get env/config default for a setting key. */
function getEnvDefault(key: string): string {
  switch (key) {
    case "autoReply.enabled": return String(config.autoReply.enabled);
    case "autoReply.cooldownSeconds": return String(config.autoReply.cooldownSeconds);
    case "autoReply.allowedThreads": return JSON.stringify(config.autoReply.allowedThreads);
    case "messageBatching.enabled": return String(config.messageBatching.enabled);
    case "messageBatching.windowMs": return String(config.messageBatching.windowMs);
    case "messageBatching.maxMessages": return String(config.messageBatching.maxMessages);
    case "messageBatching.maxChars": return String(config.messageBatching.maxChars);
    case "messageBatching.threadTypes": return JSON.stringify(config.messageBatching.threadTypes);
    case "document.enabled": return String(config.document?.enabled ?? false);
    case "document.maxSizeMb": return String(config.document?.maxSizeMB ?? 50);
    case "document.allowedExtensions": return JSON.stringify(config.document?.allowedExtensions ?? ["pdf", "docx", "txt", "md", "csv"]);
    case "vision.enabled": return String(config.vision?.enabled ?? false);
    case "vision.maxImageSizeMb": return String(Math.round((config.vision?.maxSizeBytes ?? 10 * 1024 * 1024) / (1024 * 1024)));
    case "ruleEngine.enabled": return "true";
    default: return "";
  }
}

// ── Get a single effective runtime setting ────────────────────────────

export async function getRuntimeSettingValue(key: string): Promise<string | null> {
  try {
    const dbRow = await prisma.runtimeSetting.findUnique({ where: { key } });
    if (dbRow) return dbRow.value;
    return getEnvDefault(key) || null;
  } catch {
    return getEnvDefault(key) || null;
  }
}

// ── Set runtime setting (with validation + audit) ─────────────────────

export interface SetRuntimeSettingInput {
  key: string;
  value: unknown;
  reason: string;
  changedBy?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SetRuntimeSettingResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  oldValue?: string;
  newValue?: string;
}

export async function setRuntimeSetting(
  input: SetRuntimeSettingInput,
): Promise<SetRuntimeSettingResult> {
  const { key, value, reason, changedBy = "admin", ipAddress, userAgent } = input;

  // ── 1. Validate key exists ─────────────────────────────────────
  const meta = SETTING_META[key];
  if (!meta) {
    return { success: false, error: `Unknown setting: ${key}`, errorCode: "UNKNOWN_KEY" };
  }

  // ── 2. Type coercion ───────────────────────────────────────────
  let coercedValue: unknown = value;
  if (meta.type === "number" && typeof value === "string") {
    coercedValue = parseFloat(value);
    if (isNaN(coercedValue as number)) {
      return { success: false, error: `Expected number for ${key}`, errorCode: "INVALID_TYPE" };
    }
  }
  if (meta.type === "boolean" && typeof value === "string") {
    if (value === "true") coercedValue = true;
    else if (value === "false") coercedValue = false;
    else return { success: false, error: `Expected boolean for ${key}`, errorCode: "INVALID_TYPE" };
  }
  if (meta.type === "string[]" && typeof value === "string") {
    try { coercedValue = JSON.parse(value); } catch { /* keep as string, validation will catch */ }
  }

  // ── 3. Validate ────────────────────────────────────────────────
  const validationError = meta.validate(coercedValue);
  if (validationError) {
    return { success: false, error: validationError, errorCode: "VALIDATION_ERROR" };
  }

  // ── 4. Validate against other settings (context) ────────────────
  if (meta.validateForSave) {
    // Build context from current effective values
    const context = await buildSettingContext(key, coercedValue);
    const ctxError = meta.validateForSave(coercedValue, { allSettings: context });
    if (ctxError) {
      return { success: false, error: ctxError, errorCode: "CONTEXT_VALIDATION_ERROR" };
    }
  }

  // ── 5. Serialize value ─────────────────────────────────────────
  const serializedValue = meta.type === "string[]" ? JSON.stringify(coercedValue) : String(coercedValue);

  // ── 6. Get old value ───────────────────────────────────────────
  let oldValue: string | null = null;
  try {
    const existing = await prisma.runtimeSetting.findUnique({ where: { key } });
    oldValue = existing?.value ?? null;
  } catch { /* ignore */ }

  // ── 7. Save to DB ──────────────────────────────────────────────
  try {
    await prisma.runtimeSetting.upsert({
      where: { key },
      create: { key, value: serializedValue, updatedBy: changedBy },
      update: { value: serializedValue, updatedBy: changedBy },
    });

    // ── 8. Write audit log ───────────────────────────────────────
    await prisma.runtimeConfigAudit.create({
      data: {
        key,
        oldValue: oldValue ?? undefined,
        newValue: serializedValue,
        changedBy,
        reason: reason || null,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    });

    // ── 9. Update in-memory cache for hot settings ────────────────
    updateHotCache(key, coercedValue);

    console.log(
      `[runtime-config] setting updated: ${key} = ${serializedValue} ` +
      `(was: ${oldValue ?? "default"}) by ${changedBy}`,
    );

    return { success: true, oldValue: oldValue ?? undefined, newValue: serializedValue };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `DB error: ${msg}`, errorCode: "DB_ERROR" };
  }
}

/** Build context of all effective setting values for cross-validation. */
async function buildSettingContext(
  updatingKey: string,
  updatingValue: unknown,
): Promise<Record<string, string>> {
  const ctx: Record<string, string> = {};
  for (const meta of Object.values(SETTING_META)) {
    if (meta.key === updatingKey) {
      ctx[meta.key] = meta.type === "string[]" ? JSON.stringify(updatingValue) : String(updatingValue);
    } else {
      ctx[meta.key] = await getRuntimeSettingValue(meta.key) ?? "";
    }
  }
  return ctx;
}

// ── Hot cache: settings that need immediate effect (no restart) ──────

interface HotCache {
  autoReplyCooldownSeconds: number | null;
  messageBatchingEnabled: boolean | null;
  messageBatchingWindowMs: number | null;
  messageBatchingMaxMessages: number | null;
  messageBatchingMaxChars: number | null;
  messageBatchingThreadTypes: string[] | null;
}

const hotCache: HotCache = {
  autoReplyCooldownSeconds: null,
  messageBatchingEnabled: null,
  messageBatchingWindowMs: null,
  messageBatchingMaxMessages: null,
  messageBatchingMaxChars: null,
  messageBatchingThreadTypes: null,
};

function updateHotCache(key: string, value: unknown): void {
  switch (key) {
    case "autoReply.cooldownSeconds":
      hotCache.autoReplyCooldownSeconds = typeof value === "number" ? value : parseInt(String(value), 10);
      break;
    case "messageBatching.enabled":
      hotCache.messageBatchingEnabled = Boolean(value === true || value === "true");
      break;
    case "messageBatching.windowMs":
      hotCache.messageBatchingWindowMs = typeof value === "number" ? value : parseInt(String(value), 10);
      break;
    case "messageBatching.maxMessages":
      hotCache.messageBatchingMaxMessages = typeof value === "number" ? value : parseInt(String(value), 10);
      break;
    case "messageBatching.maxChars":
      hotCache.messageBatchingMaxChars = typeof value === "number" ? value : parseInt(String(value), 10);
      break;
    case "messageBatching.threadTypes":
      hotCache.messageBatchingThreadTypes = Array.isArray(value) ? value as string[] :
        (typeof value === "string" ? parseStringArray(value) : null);
      break;
  }
}

function parseStringArray(value: string): string[] {
  try { return JSON.parse(value); } catch { return []; }
}

/** Initialize hot cache from DB at startup. */
export async function initHotCache(): Promise<void> {
  for (const key of Object.keys(hotCache) as Array<keyof HotCache>) {
    const settingKey = key.replace(/([A-Z])/g, ".$1").toLowerCase()
      .replace("auto.reply", "autoReply.")
      .replace("message.batching", "messageBatching.");
    // Map back to proper keys
    const keyMap: Record<string, string> = {
      "auto.reply.cooldown.seconds": "autoReply.cooldownSeconds",
      "message.batching.enabled": "messageBatching.enabled",
      "message.batching.window.ms": "messageBatching.windowMs",
      "message.batching.max.messages": "messageBatching.maxMessages",
      "message.batching.max.chars": "messageBatching.maxChars",
      "message.batching.thread.types": "messageBatching.threadTypes",
    };
    const actualKey = keyMap[key] ?? key;
    try {
      const dbVal = await getRuntimeSettingValue(actualKey);
      if (dbVal !== null) {
        updateHotCache(actualKey, dbVal);
      }
    } catch { /* ignore */ }
  }
}

// ── Sync getters for hot-cached settings ──────────────────────────────

/** Get effective cooldown seconds (runtime override → env fallback). */
export function getEffectiveCooldownSeconds(): number {
  return hotCache.autoReplyCooldownSeconds ?? config.autoReply.cooldownSeconds;
}

/** Get effective message batching enabled flag. */
export function getEffectiveBatchingEnabled(): boolean {
  return hotCache.messageBatchingEnabled ?? config.messageBatching.enabled;
}

/** Get effective message batching window (ms). */
export function getEffectiveBatchingWindowMs(): number {
  return hotCache.messageBatchingWindowMs ?? config.messageBatching.windowMs;
}

/** Get effective message batching max messages. */
export function getEffectiveBatchingMaxMessages(): number {
  return hotCache.messageBatchingMaxMessages ?? config.messageBatching.maxMessages;
}

/** Get effective message batching max chars. */
export function getEffectiveBatchingMaxChars(): number {
  return hotCache.messageBatchingMaxChars ?? config.messageBatching.maxChars;
}

/** Get effective message batching thread types. */
export function getEffectiveBatchingThreadTypes(): string[] {
  return hotCache.messageBatchingThreadTypes ?? config.messageBatching.threadTypes;
}

/** Get all effective message batching config as a single object. */
export function getEffectiveBatchingConfig() {
  return {
    enabled: getEffectiveBatchingEnabled(),
    windowMs: getEffectiveBatchingWindowMs(),
    maxMessages: getEffectiveBatchingMaxMessages(),
    maxChars: getEffectiveBatchingMaxChars(),
    threadTypes: getEffectiveBatchingThreadTypes(),
  };
}
