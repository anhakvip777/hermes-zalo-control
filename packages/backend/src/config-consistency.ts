/**
 * Config Consistency Checker — validates configuration at startup and via API.
 *
 * Detects dangerous/mismatched config before it causes production errors.
 * Severity levels: PASS, WARN, ERROR.
 * STRICT_CONFIG_CHECK=true → ERROR blocks startup.
 */

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";

export type Severity = "PASS" | "WARN" | "ERROR";

export interface ConfigCheck {
  name: string;
  severity: Severity;
  message: string;
  safe: boolean; // true for PASS/WARN, false for ERROR
}

export interface ConfigCheckResult {
  status: "CONFIG_OK" | "CONFIG_WARN" | "CONFIG_ERROR";
  checks: ConfigCheck[];
  summary: {
    pass: number;
    warn: number;
    error: number;
  };
}

function mask(value: string | undefined): string {
  if (!value) return "missing";
  if (value.length <= 8) return "***";
  return value.slice(0, 4) + "***" + value.slice(-4);
}

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const lower = value.toLowerCase();
  return (
    lower.includes("changeme") ||
    lower.includes("change-me") ||
    lower === "xxx" ||
    lower === "test" ||
    lower === "placeholder"
  );
}

export function runConfigChecks(): ConfigCheckResult {
  const checks: ConfigCheck[] = [];

  // ═══ 1. Auto-reply ═══
  const autoReply = config.autoReply;
  const isLive = !autoReply.dryRun;

  checks.push({
    name: "autoReply.enabled",
    severity: autoReply.enabled ? "PASS" : "WARN",
    message: autoReply.enabled ? "Auto-reply is enabled" : "Auto-reply is DISABLED",
    safe: true,
  });

  if (autoReply.enabled && autoReply.allowedThreads.length === 0) {
    checks.push({
      name: "autoReply.allowedThreads",
      severity: "ERROR",
      message: "Auto-reply enabled but allowedThreads is EMPTY — no threads will receive replies",
      safe: false,
    });
  } else {
    checks.push({
      name: "autoReply.allowedThreads",
      severity: "PASS",
      message: `Allowed threads: ${autoReply.allowedThreads.length}`,
      safe: true,
    });
  }

  checks.push({
    name: "autoReply.dryRun",
    severity: isLive ? "WARN" : "PASS",
    message: isLive ? "⚠️ LIVE MODE — replies will be sent to real Zalo users" : "Dry-run mode — safe",
    safe: !isLive,
  });

  if (isLive && autoReply.cooldownSeconds < 5) {
    checks.push({
      name: "autoReply.cooldown",
      severity: "WARN",
      message: `Cooldown is only ${autoReply.cooldownSeconds}s in live mode — risk of spam`,
      safe: true,
    });
  }

  // Group threads in allowed list while live — enhanced with risk awareness
  if (isLive) {
    // Known pattern: DM user threads typically have numeric IDs
    // Groups and unknown threads are riskier
    const groupCandidates = autoReply.allowedThreads.filter(
      (t) => t && !/^\d{15,20}$/.test(t)
    );
    if (groupCandidates.length > 0) {
      checks.push({
        name: "autoReply.groupInAllowedThreads",
        severity: "WARN",
        message: `Live mode with ${groupCandidates.length} non-DM thread(s) in allowedThreads — review at /thread-review`,
        safe: true,
      });
    }
  }

  // When dry-run is off, any allowed threads warrant caution
  if (isLive && autoReply.allowedThreads.length > 0) {
    checks.push({
      name: "autoReply.liveWithAllowedThreads",
      severity: "WARN",
      message: `Live mode active with ${autoReply.allowedThreads.length} allowed thread(s) — verify thread safety before production use`,
      safe: true,
    });
  }

  // ═══ 2. Vision ═══
  const vision = config.vision;
  const visionKey = process.env.CHIASEGPU_API_KEY || "";
  const visionModel = vision.model || process.env.ZALO_VISION_MODEL || "";

  if (vision.enabled) {
    checks.push({
      name: "vision.enabled",
      severity: "PASS",
      message: "Vision is enabled",
      safe: true,
    });

    if (!visionKey || isPlaceholder(visionKey)) {
      checks.push({
        name: "vision.apiKey",
        severity: "ERROR",
        message: "Vision enabled but API key is missing or looks like a placeholder",
        safe: false,
      });
    } else {
      checks.push({
        name: "vision.apiKey",
        severity: "PASS",
        message: `API key present (prefix: ${mask(visionKey)})`,
        safe: true,
      });
    }

    if (!visionModel) {
      checks.push({
        name: "vision.model",
        severity: "ERROR",
        message: "Vision enabled but model is not set",
        safe: false,
      });
    } else {
      checks.push({
        name: "vision.model",
        severity: "PASS",
        message: `Vision model: ${visionModel}`,
        safe: true,
      });
    }

    if (!vision.allowedMimeTypes || vision.allowedMimeTypes.length === 0) {
      checks.push({
        name: "vision.mimeTypes",
        severity: "ERROR",
        message: "Vision enabled but no allowed MIME types configured",
        safe: false,
      });
    }
  } else {
    checks.push({
      name: "vision.enabled",
      severity: "PASS",
      message: "Vision is disabled (skip all checks)",
      safe: true,
    });
  }

  // ═══ 3. Voice ═══
  const voiceEnabled = config.zalo.voiceEnabled;

  if (voiceEnabled) {
    const allowUnstable = process.env.ALLOW_UNSTABLE_VOICE === "true";

    if (!allowUnstable) {
      checks.push({
        name: "voice.unstable",
        severity: "ERROR",
        message:
          "Native Zalo voice is unstable. Set ALLOW_UNSTABLE_VOICE=true to enable",
        safe: false,
      });
    } else {
      checks.push({
        name: "voice.enabled",
        severity: "WARN",
        message: "Voice is enabled — native Zalo voice playback is unreliable",
        safe: true,
      });
    }
  } else {
    checks.push({
      name: "voice.enabled",
      severity: "PASS",
      message: "Voice is disabled (recommended)",
      safe: true,
    });
  }

  // ═══ 4. DB + backup ═══
  const dbUrl = process.env.DATABASE_URL || "file:./dev.db";
  const dbMatch = dbUrl.match(/^file:(.+)$/);
  const dbPath = dbMatch?.[1]
    ? resolve(resolve(process.cwd(), "prisma"), dbMatch[1])
    : null;

  if (dbPath && existsSync(dbPath)) {
    const dbSize = statSync(dbPath).size;
    if (dbSize < 1024) {
      checks.push({
        name: "db.size",
        severity: "WARN",
        message: `DB size suspiciously small: ${dbSize} bytes`,
        safe: true,
      });
    }
  }

  // Recent backup check
  const backupsDir = resolve(process.cwd(), "backups", "system");
  if (isLive) {
    const hasRecentBackup = checkRecentBackup(backupsDir);
    if (!hasRecentBackup) {
      checks.push({
        name: "backup.recent",
        severity: "WARN",
        message: "Live mode but no recent backup (last 24h) found",
        safe: true,
      });
    }
  }

  // ═══ 5. Process lock ═══
  const allowMulti = process.env.ALLOW_MULTIPLE_BACKEND_INSTANCES === "true";
  checks.push({
    name: "processLock.multipleInstances",
    severity: allowMulti ? "WARN" : "PASS",
    message: allowMulti
      ? "MULTIPLE BACKEND INSTANCES ALLOWED — risk of dual Zalo session"
      : "Single instance enforced",
    safe: !allowMulti,
  });

  // ═══ 6. Secrets placeholder check ═══
  const secretsToCheck: Array<{ name: string; value: string | undefined }> = [
    { name: "ADMIN_PASSWORD", value: process.env.ADMIN_PASSWORD },
    { name: "JWT_SECRET", value: process.env.JWT_SECRET },
    { name: "CHIASEGPU_API_KEY", value: process.env.CHIASEGPU_API_KEY },
  ];

  for (const { name, value } of secretsToCheck) {
    if (!value || isPlaceholder(value)) {
      checks.push({
        name: `secret.${name}`,
        severity: "ERROR",
        message: `${name} is missing or looks like a placeholder`,
        safe: false,
      });
    } else {
      checks.push({
        name: `secret.${name}`,
        severity: "PASS",
        message: `${name} is set (length: ${value.length})`,
        safe: true,
      });
    }
  }

  // ═══ Summary ═══
  const errorCount = checks.filter((c) => c.severity === "ERROR").length;
  const warnCount = checks.filter((c) => c.severity === "WARN").length;
  const passCount = checks.filter((c) => c.severity === "PASS").length;

  const status: ConfigCheckResult["status"] =
    errorCount > 0 ? "CONFIG_ERROR" : warnCount > 0 ? "CONFIG_WARN" : "CONFIG_OK";

  return {
    status,
    checks,
    summary: { pass: passCount, warn: warnCount, error: errorCount },
  };
}

function checkRecentBackup(backupsDir: string): boolean {
  try {
    if (!existsSync(backupsDir)) return false;
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const dirs = readdirSync(backupsDir, { withFileTypes: true })
      .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
      .map((d: { name: string }) => d.name);

    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    for (const d of dirs) {
      const fullPath = resolve(backupsDir, d, "manifest.json");
      if (!existsSync(fullPath)) continue;
      try {
        const m = JSON.parse(
          require("node:fs").readFileSync(fullPath, "utf-8")
        );
        const createdAt = new Date(m.createdAt).getTime();
        if (now - createdAt < oneDayMs) return true;
      } catch {
        // skip
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Startup check — log results and optionally block on errors.
 */
export async function checkConfigOnStartup(): Promise<void> {
  const result = runConfigChecks();
  const strict = process.env.STRICT_CONFIG_CHECK === "true";

  console.log(`[config-check] Status: ${result.status}`);
  console.log(
    `[config-check] PASS=${result.summary.pass} WARN=${result.summary.warn} ERROR=${result.summary.error}`
  );

  for (const check of result.checks) {
    const prefix =
      check.severity === "ERROR"
        ? "❌"
        : check.severity === "WARN"
          ? "⚠️"
          : "✅";
    console.log(`  ${prefix} [${check.severity}] ${check.name}: ${check.message}`);
  }

  if (strict && result.status === "CONFIG_ERROR") {
    throw new Error(
      "STRICT_CONFIG_CHECK=true and config has ERROR-level issues — startup blocked"
    );
  }
}
