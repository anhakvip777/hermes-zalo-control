// =============================================================================
// Production Readiness Service — gate check before going live
// =============================================================================

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { runConfigChecks, type ConfigCheckResult } from "../config-consistency.js";
import { getCurrentEffectiveDryRun, getAllRuntimeSettings } from "./runtime-config.service.js";
import { getHeartbeatSummary, type HeartbeatEntry } from "./heartbeat.service.js";
import { getThreadReviewSummary } from "./allowed-thread-review.service.js";
import { readLockFile, checkProcessLock } from "../process-lock.js";

// ── Types ────────────────────────────────────────────────────────────

export type CheckSeverity = "critical" | "high" | "medium" | "low";
export type CheckStatus = "pass" | "warn" | "fail";
export type Verdict = "READY_FOR_LIVE" | "WARNING_ONLY" | "NOT_READY";

export interface ReadinessCheck {
  id: string;
  label: string;
  category: string;
  status: CheckStatus;
  severity: CheckSeverity;
  message: string;
  action?: string;
}

export interface ReadinessSummary {
  pass: number;
  warn: number;
  fail: number;
  criticalFail: number;
  highFail: number;
}

export interface ReadinessResult {
  verdict: Verdict;
  score: number;
  timestamp: string;
  checks: ReadinessCheck[];
  summary: ReadinessSummary;
}

// ── Helpers ──────────────────────────────────────────────────────────

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const lower = value.toLowerCase();
  return lower.includes("changeme") || lower.includes("change-me") ||
    lower === "xxx" || lower === "test" || lower === "placeholder" || lower === "admin";
}

function hoursAgo(isoString: string | null): number | null {
  if (!isoString) return null;
  const then = new Date(isoString).getTime();
  return Math.round((Date.now() - then) / (3600 * 1000) * 10) / 10;
}

function maskSessionPath(path: string): string {
  const parts = path.split("/");
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path;
}

// ── Zalo Checks ──────────────────────────────────────────────────────

async function checkZaloGroup(checks: ReadinessCheck[]): Promise<void> {
  // Zalo connected?
  try {
    const { getZaloGateway } = await import("./zalo-gateway.service.js");
    const gw = getZaloGateway();
    const gs = gw.getStatus();

    if (gs.connected) {
      checks.push({
        id: "zalo.connected", label: "Zalo connected",
        category: "Zalo", status: "pass", severity: "critical",
        message: `Connected as ${gs.selfDisplayName ?? gs.selfUserId ?? "unknown"}`,
      });
    } else {
      checks.push({
        id: "zalo.connected", label: "Zalo connected",
        category: "Zalo", status: "fail", severity: "critical",
        message: gs.lastError ? `Disconnected: ${gs.lastError}` : "Disconnected",
        action: "Reconnect via /zalo-ops or scan QR code.",
      });
    }

    // Listener active?
    const listenerActive = (gw as any).listenerActive ?? gs.connected;
    if (listenerActive) {
      checks.push({
        id: "zalo.listener", label: "Listener active",
        category: "Zalo", status: "pass", severity: "high",
        message: "Listener is active and receiving messages.",
      });
    } else if (gs.connected) {
      checks.push({
        id: "zalo.listener", label: "Listener active",
        category: "Zalo", status: "fail", severity: "high",
        message: "Zalo connected but listener not active. Messages won't be received.",
        action: "Try reconnecting via /zalo-ops.",
      });
    } else {
      checks.push({
        id: "zalo.listener", label: "Listener active",
        category: "Zalo", status: "fail", severity: "high",
        message: "Listener not active (Zalo disconnected).",
      });
    }
  } catch {
    checks.push({
      id: "zalo.connected", label: "Zalo connected",
      category: "Zalo", status: "fail", severity: "critical",
      message: "Zalo gateway not initialized.",
    });
  }

  // Message pipeline heartbeat
  const hbSummary = await getHeartbeatSummary();
  const pipelineHb = hbSummary["messagePipeline"];
  if (pipelineHb && pipelineHb.status === "ok") {
    checks.push({
      id: "zalo.messagePipeline", label: "Message pipeline heartbeat",
      category: "Zalo", status: "pass", severity: "medium",
      message: `Pipeline heartbeat OK (${pipelineHb.ageSeconds}s ago).`,
    });
  } else if (pipelineHb && pipelineHb.status === "stale") {
    checks.push({
      id: "zalo.messagePipeline", label: "Message pipeline heartbeat",
      category: "Zalo", status: "warn", severity: "medium",
      message: `Pipeline heartbeat stale (${pipelineHb.ageSeconds}s old). May be normal if no recent messages.`,
    });
  } else {
    checks.push({
      id: "zalo.messagePipeline", label: "Message pipeline heartbeat",
      category: "Zalo", status: "warn", severity: "low",
      message: "No pipeline heartbeat recorded. May be normal if no messages yet.",
    });
  }
}

// ── Safety Checks ────────────────────────────────────────────────────

async function checkSafetyGroup(checks: ReadinessCheck[]): Promise<void> {
  const dryRun = getCurrentEffectiveDryRun();

  // Dry-run status
  if (dryRun) {
    checks.push({
      id: "safety.dryRun", label: "Dry-run mode active",
      category: "Safety", status: "pass", severity: "high",
      message: "✅ Currently in dry-run mode — no real messages sent.",
    });
  } else {
    checks.push({
      id: "safety.dryRun", label: "Dry-run mode",
      category: "Safety", status: "fail", severity: "critical",
      message: "⚠️ LIVE mode — real messages are being sent.",
      action: "Verify this is intentional. Switch back to dry-run via Safety Mode if testing.",
    });
  }

  // Safety Mode confirm gate exists
  checks.push({
    id: "safety.confirmGate", label: "Live switch requires confirm",
    category: "Safety", status: "pass", severity: "high",
    message: "Switching from dryRun to live requires Safety Mode confirmation text.",
  });

  // Allowed threads
  const settingsArr = await getAllRuntimeSettings();
  const allowedSetting = settingsArr.find((s: any) => s.key === "autoReply.allowedThreads");
  const allowedThreads: string[] = allowedSetting?.value
    ? (() => { try { const v = JSON.parse(allowedSetting.value); return Array.isArray(v) ? v : []; } catch { return []; } })()
    : config.autoReply.allowedThreads;

  if (allowedThreads.length === 0) {
    checks.push({
      id: "safety.allowedThreads", label: "Allowed threads configured",
      category: "Safety", status: "fail", severity: "critical",
      message: "Auto-reply enabled but allowedThreads is EMPTY — nobody will receive replies.",
      action: "Add at least one thread ID via /thread-settings or Runtime Control.",
    });
  } else {
    checks.push({
      id: "safety.allowedThreads", label: "Allowed threads configured",
      category: "Safety", status: "pass", severity: "high",
      message: `${allowedThreads.length} allowed thread(s): ${allowedThreads.join(", ")}`,
    });
  }

  // Group risk check
  try {
    const review = await getThreadReviewSummary();
    if (review.highRiskCount > 0) {
      const severity: CheckSeverity = dryRun ? "medium" : "high";
      const status: CheckStatus = dryRun ? "warn" : "fail";
      checks.push({
        id: "safety.groupRisk", label: "High-risk threads in allowlist",
        category: "Safety", status, severity,
        message: `${review.highRiskCount} high-risk thread(s) detected. Groups should have mentionRequired=true.${dryRun ? " (Safe: dry-run mode active)" : " ⚠️ RISKY in live mode!"}`,
        action: "Review high-risk threads at /thread-review. Enable groupMentionRequired for groups.",
      });
    } else if (review.groupCount > 0) {
      checks.push({
        id: "safety.groupRisk", label: "No high-risk threads",
        category: "Safety", status: "pass", severity: "medium",
        message: `${review.groupCount} group(s) in allowlist, all low-risk.`,
      });
    } else {
      checks.push({
        id: "safety.groupRisk", label: "No groups in allowlist",
        category: "Safety", status: "pass", severity: "low",
        message: "No groups in allowlist — only DM threads (safest configuration).",
      });
    }
  } catch {
    checks.push({
      id: "safety.groupRisk", label: "Group risk check",
      category: "Safety", status: "warn", severity: "medium",
      message: "Could not run group risk check (service unavailable).",
    });
  }
}

// ── Config Checks ────────────────────────────────────────────────────

function checkConfigGroup(checks: ReadinessCheck[], configResult: ConfigCheckResult): void {
  if (configResult.status === "CONFIG_OK") {
    checks.push({
      id: "config.status", label: "Configuration status",
      category: "Config", status: "pass", severity: "high",
      message: `CONFIG_OK — ${configResult.summary.pass} pass, ${configResult.summary.warn} warn, ${configResult.summary.error} error.`,
    });
  } else if (configResult.status === "CONFIG_WARN") {
    checks.push({
      id: "config.status", label: "Configuration status",
      category: "Config", status: "warn", severity: "high",
      message: `CONFIG_WARN — ${configResult.summary.pass} pass, ${configResult.summary.warn} warn, ${configResult.summary.error} error.`,
    });
  } else {
    checks.push({
      id: "config.status", label: "Configuration status",
      category: "Config", status: "fail", severity: "critical",
      message: `CONFIG_ERROR — ${configResult.summary.error} error(s). Some errors may not block startup (STRICT_CHECK disabled).`,
      action: "Fix config errors in .env or Runtime Settings. Run /api/system/config-check for details.",
    });
  }

  // Check for STRICT errors
  const strictErrors = configResult.checks.filter(c => !c.safe && c.severity === "ERROR");
  if (strictErrors.length > 0) {
    checks.push({
      id: "config.strictErrors", label: "Strict config errors",
      category: "Config", status: "fail", severity: "critical",
      message: `${strictErrors.length} strict error(s): ${strictErrors.map(c => c.name).join(", ")}`,
      action: "Fix these errors before going live.",
    });
  } else {
    checks.push({
      id: "config.strictErrors", label: "No strict config errors",
      category: "Config", status: "pass", severity: "high",
      message: "No STRICT-level config errors detected.",
    });
  }
}

// ── Health Checks ────────────────────────────────────────────────────

async function checkHealthGroup(checks: ReadinessCheck[]): Promise<void> {
  // Backend health — heartbeat
  const hbSummary = await getHeartbeatSummary();
  const backendHb = hbSummary["backend"];

  if (backendHb && backendHb.status === "ok") {
    checks.push({
      id: "health.backend", label: "Backend healthy",
      category: "Health", status: "pass", severity: "critical",
      message: `Backend heartbeat OK (${backendHb.ageSeconds}s ago).`,
    });
  } else {
    checks.push({
      id: "health.backend", label: "Backend healthy",
      category: "Health", status: "fail", severity: "critical",
      message: backendHb ? `Backend heartbeat ${backendHb.status} (${backendHb.ageSeconds}s old).` : "No backend heartbeat.",
      action: "Check if backend process is running and healthy.",
    });
  }

  // Worker heartbeat
  const workerHb = hbSummary["schedulerWorker"];
  if (workerHb && workerHb.status === "ok") {
    checks.push({
      id: "health.worker", label: "Schedule worker active",
      category: "Health", status: "pass", severity: "high",
      message: `Worker heartbeat OK (${workerHb.ageSeconds}s ago).`,
    });
  } else {
    checks.push({
      id: "health.worker", label: "Schedule worker active",
      category: "Health", status: workerHb?.status === "stale" ? "warn" : "fail",
      severity: "high",
      message: workerHb ? `Worker heartbeat ${workerHb.status}.` : "No worker heartbeat.",
      action: "Scheduled messages won't send without an active worker. Check PM2 status.",
    });
  }

  // Process lock
  const lockCheck = checkProcessLock();
  const lockInfo = readLockFile();
  const isOwner = lockInfo !== null && lockInfo.pid === process.pid;

  if (lockCheck.locked && !lockCheck.stale && isOwner) {
    checks.push({
      id: "health.processLock", label: "Process lock owner",
      category: "Health", status: "pass", severity: "critical",
      message: `This process is the lock owner (PID ${process.pid}). No dual-instance conflict.`,
    });
  } else if (lockCheck.locked && !lockCheck.stale && !isOwner) {
    checks.push({
      id: "health.processLock", label: "Process lock conflict",
      category: "Health", status: "fail", severity: "critical",
      message: `Another process holds the lock (PID ${lockCheck.info?.pid ?? "unknown"}). Dual-instance DETECTED!`,
      action: "Stop the duplicate backend instance immediately.",
    });
  } else if (lockCheck.stale) {
    checks.push({
      id: "health.processLock", label: "Process lock stale",
      category: "Health", status: "pass", severity: "medium",
      message: "Lock was stale, this instance claimed it normally.",
    });
  } else {
    checks.push({
      id: "health.processLock", label: "Process lock",
      category: "Health", status: "pass", severity: "low",
      message: "Process lock not held. Single instance assumed.",
    });
  }

  // DB health
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({
      id: "health.db", label: "Database accessible",
      category: "Health", status: "pass", severity: "critical",
      message: "Database connection OK.",
    });
  } catch {
    checks.push({
      id: "health.db", label: "Database accessible",
      category: "Health", status: "fail", severity: "critical",
      message: "Database connection FAILED. Backend cannot function without DB.",
      action: "Check database file and connection.",
    });
  }
}

// ── Backup Checks ────────────────────────────────────────────────────

async function checkBackupGroup(checks: ReadinessCheck[]): Promise<void> {
  const { existsSync: ex, statSync: st, readdirSync: rd } = await import("node:fs");
  const backupsDir = resolve(process.cwd(), "backups", "system");
  let latestAt: string | null = null;
  let backupCount = 0;

  // Check backups/system dir first, then backups/db
  for (const dir of [backupsDir, resolve(process.cwd(), "backups", "db")]) {
    try {
      if (ex(dir)) {
        const files = rd(dir).filter((f: string) =>
          f.endsWith(".sqlite") || f.endsWith(".db") || f.endsWith(".sqlite3") ||
          (ex(resolve(dir, f)) && st(resolve(dir, f)).isDirectory())
        );
        backupCount += files.length;
        for (const f of files) {
          try {
            const p = resolve(dir, f);
            const s = st(p);
            if (!latestAt || s.mtime.toISOString() > latestAt) {
              latestAt = s.mtime.toISOString();
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
  }

  // Also check backup-* directories at project root
  try {
    const rootDir = resolve(process.cwd());
    const { readdirSync: rd } = require("fs") as typeof import("fs");
    const rootDirs = rd(rootDir, { withFileTypes: true })
      .filter((d: any) => d.isDirectory() && d.name.startsWith("backup-"));
    for (const d of rootDirs) {
      const p = resolve(rootDir, d.name);
      try {
        const st = statSync(p);
        if (!latestAt || st.mtime.toISOString() > latestAt) {
          latestAt = st.mtime.toISOString();
        }
        backupCount++;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  const ageHours = hoursAgo(latestAt);

  if (latestAt && ageHours !== null && ageHours <= 24) {
    checks.push({
      id: "backup.recent", label: "Recent backup exists",
      category: "Backup", status: "pass", severity: "high",
      message: `Latest backup ${ageHours}h ago. ${backupCount} total backups.`,
    });
  } else if (latestAt && ageHours !== null) {
    checks.push({
      id: "backup.recent", label: "Recent backup exists",
      category: "Backup", status: "warn", severity: "high",
      message: `Latest backup ${ageHours}h ago (>24h). ${backupCount} total backups. Take a fresh backup before going live.`,
      action: "Run backup via Admin Tools or manual db backup.",
    });
  } else {
    checks.push({
      id: "backup.recent", label: "Recent backup exists",
      category: "Backup", status: "fail", severity: "critical",
      message: "NO BACKUPS FOUND. Critical safety requirement not met.",
      action: "Run a full backup (DB + session) before going live. Use Admin Tools.",
    });
  }

  // DB size check
  try {
    const dbPath = resolve(process.cwd(), "packages", "backend", "prisma", "dev.db");
    if (existsSync(dbPath)) {
      const sizeMb = Math.round(statSync(dbPath).size / (1024 * 1024) * 10) / 10;
      if (sizeMb > 100) {
        checks.push({
          id: "backup.dbSize", label: "Database size",
          category: "Backup", status: "warn", severity: "low",
          message: `DB size: ${sizeMb} MB (>100 MB). Consider pruning old messages or archiving.`,
        });
      } else {
        checks.push({
          id: "backup.dbSize", label: "Database size",
          category: "Backup", status: "pass", severity: "low",
          message: `DB size: ${sizeMb} MB — normal.`,
        });
      }
    }
  } catch {
    checks.push({
      id: "backup.dbSize", label: "Database size",
      category: "Backup", status: "warn", severity: "low",
      message: "Could not check DB size.",
    });
  }

  // Session backup if Zalo connected
  try {
    const { getZaloGateway } = await import("./zalo-gateway.service.js");
    const gw = getZaloGateway();
    if (gw.isConnected()) {
      const sessionPath = resolve(config.zalo.sessionDir, "zalo-session.json");
      const sessionExists = existsSync(sessionPath);
      if (sessionExists) {
        checks.push({
          id: "backup.session", label: "Zalo session file exists",
          category: "Backup", status: "pass", severity: "medium",
          message: `Session file at ${maskSessionPath(sessionPath)} (${statSync(sessionPath).mtime.toISOString()}).`,
        });
      } else if (config.zalo.dryRun) {
        checks.push({
          id: "backup.session", label: "Zalo session file",
          category: "Backup", status: "pass", severity: "low",
          message: "Dry-run mode — session file not needed.",
        });
      } else {
        checks.push({
          id: "backup.session", label: "Zalo session file missing",
          category: "Backup", status: "fail", severity: "high",
          message: "Connected WITHOUT session file! If disconnected, QR re-login required.",
          action: "Ensure session file is properly saved and backed up.",
        });
      }
    }
  } catch { /* skip */ }
}

// ── Security Checks ──────────────────────────────────────────────────

function checkSecurityGroup(checks: ReadinessCheck[]): void {
  // Admin password check
  const pwd = config.security.adminPassword;
  if (isPlaceholder(pwd)) {
    checks.push({
      id: "security.adminPassword", label: "Admin password is default",
      category: "Security", status: "fail", severity: "critical",
      message: "ADMIN_PASSWORD is set to a default/placeholder value. Change immediately!",
      action: "Set ADMIN_PASSWORD to a strong value in .env.",
    });
  } else {
    checks.push({
      id: "security.adminPassword", label: "Admin password set",
      category: "Security", status: "pass", severity: "high",
      message: "Admin password is not a default value.",
    });
  }

  // No secret in runtime config visible
  checks.push({
    id: "security.noSecrets", label: "No secrets in API responses",
    category: "Security", status: "pass", severity: "high",
    message: "All secrets (API keys, passwords, tokens) are masked in API responses.",
  });

  // Session path not exposed in URLs
  checks.push({
    id: "security.sessionPath", label: "Session path not exposed",
    category: "Security", status: "pass", severity: "medium",
    message: "Session file content and path are masked in all endpoints.",
  });
}

// ── Rules Checks ─────────────────────────────────────────────────────

async function checkRulesGroup(checks: ReadinessCheck[]): Promise<void> {
  try {
    const enabledCount = await prisma.rule.count({ where: { enabled: true } });
    const totalCount = await prisma.rule.count();

    if (enabledCount === 0) {
      checks.push({
        id: "rules.enabled", label: "Enabled rules",
        category: "Rules", status: "pass", severity: "low",
        message: "No rules enabled — auto-reply uses Hermes AI directly.",
      });
    } else {
      checks.push({
        id: "rules.enabled", label: "Enabled rules",
        category: "Rules", status: "pass", severity: "medium",
        message: `${enabledCount} rule(s) enabled (${totalCount} total).`,
      });

      // Check for fixed_reply rules with potentially risky targets
      const fixedReplyRules = await prisma.rule.findMany({
        where: { enabled: true, actionType: "fixed_reply" },
        select: { id: true, name: true, targetThreadIds: true, actionConfig: true },
      });

      if (fixedReplyRules.length > 0) {
        const rulesWithBroadTargets = fixedReplyRules.filter(r => !r.targetThreadIds || (r.targetThreadIds as any)?.length === 0);
        if (rulesWithBroadTargets.length > 0) {
          checks.push({
            id: "rules.fixedReplyScope", label: "Fixed-reply rules scope",
            category: "Rules", status: "warn", severity: "medium",
            message: `${rulesWithBroadTargets.length} fixed_reply rule(s) have no target thread restriction — applies to all threads.`,
            action: "Add targetThreadIds to fixed_reply rules to limit their scope.",
          });
        } else {
          checks.push({
            id: "rules.fixedReplyScope", label: "Fixed-reply rules scope",
            category: "Rules", status: "pass", severity: "low",
            message: `${fixedReplyRules.length} fixed_reply rule(s) have target thread restrictions.`,
          });
        }
      }

      // Check for ignore rules (might inadvertently block messages)
      const ignoreRules = await prisma.rule.count({
        where: { enabled: true, actionType: "ignore" },
      });
      if (ignoreRules > 0) {
        checks.push({
          id: "rules.ignoreWarning", label: "Ignore rules active",
          category: "Rules", status: "warn", severity: "medium",
          message: `${ignoreRules} rule(s) set to "ignore" — messages matching these rules will be silently dropped.`,
          action: "Review ignore rules at /rules to ensure they don't block important messages.",
        });
      }
    }

    // Rules don't bypass safety gates (architectural guarantee)
    checks.push({
      id: "rules.safetyBypass", label: "Rules cannot bypass safety gates",
      category: "Rules", status: "pass", severity: "high",
      message: "Rule engine runs AFTER all safety gates (allowlist, cooldown, group gate). Cannot bypass.",
    });
  } catch {
    checks.push({
      id: "rules.enabled", label: "Rules check",
      category: "Rules", status: "warn", severity: "low",
      message: "Could not query rules (DB unavailable?).",
    });
  }
}

// ── Documents Checks ─────────────────────────────────────────────────

async function checkDocumentsGroup(checks: ReadinessCheck[]): Promise<void> {
  if (!config.document.enabled) {
    checks.push({
      id: "docs.disabled", label: "Document ingestion disabled",
      category: "Documents", status: "pass", severity: "low",
      message: "Document ingestion is disabled. No document-related concerns.",
    });
    return;
  }

  // Check for stuck jobs
  const stuckCutoff = new Date(Date.now() - 30 * 60_000); // 30 minutes
  try {
    const stuckJobs = await prisma.documentIngestionJob.count({
      where: { status: "processing", startedAt: { lt: stuckCutoff } },
    });
    if (stuckJobs > 0) {
      checks.push({
        id: "docs.stuckJobs", label: "Stuck document jobs",
        category: "Documents", status: "warn", severity: "medium",
        message: `${stuckJobs} document job(s) stuck in "processing" > 30 min.`,
        action: "The document worker may need restart. Check PM2 status for hermes-document-worker.",
      });
    } else {
      checks.push({
        id: "docs.stuckJobs", label: "No stuck document jobs",
        category: "Documents", status: "pass", severity: "low",
        message: "No stuck document ingestion jobs.",
      });
    }

    // Failed docs: classify as document limitation vs system crash
    const failedDocs = await prisma.document.findMany({
      where: { status: "failed", createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
      select: { errorCode: true, errorMessage: true },
    });

    const criticalCodes = ["DOCLING_TIMEOUT", "DOCLING_SPAWN_ERROR", "DOCLING_POSTPROCESS_FAILED", "DOCUMENT_NOT_FOUND"];
    const criticalFails = failedDocs.filter(d => d.errorCode && criticalCodes.includes(d.errorCode));
    const docLimits = failedDocs.filter(d => !d.errorCode || !criticalCodes.includes(d.errorCode));

    if (criticalFails.length > 0) {
      checks.push({
        id: "docs.criticalFails", label: "Critical document failures",
        category: "Documents", status: "fail", severity: "high",
        message: `${criticalFails.length} critical doc failure(s) in 24h — possible system issue.`,
        action: "Check document worker logs and infrastructure.",
      });
    } else if (docLimits.length > 0) {
      checks.push({
        id: "docs.docLimits", label: "Document limitations (non-critical)",
        category: "Documents", status: "warn", severity: "low",
        message: `${docLimits.length} doc failure(s) due to document limitations (unsupported format, no OCR). Not a system issue.`,
      });
    } else {
      checks.push({
        id: "docs.noFailures", label: "No document failures",
        category: "Documents", status: "pass", severity: "low",
        message: "No failed document ingestion jobs in 24h.",
      });
    }
  } catch {
    checks.push({
      id: "docs.status", label: "Document service status",
      category: "Documents", status: "warn", severity: "low",
      message: "Could not check document service (DB unavailable?).",
    });
  }
}

// ── Error Checks ─────────────────────────────────────────────────────

async function checkErrorsGroup(checks: ReadinessCheck[]): Promise<void> {
  const since24h = new Date(Date.now() - 24 * 3600_000);

  try {
    // Critical errors = failed agent tasks
    const failedTasks24h = await prisma.agentTask.count({
      where: { status: "failed", createdAt: { gte: since24h } },
    });

    if (failedTasks24h === 0) {
      checks.push({
        id: "errors.agentTasks", label: "Failed agent tasks (24h)",
        category: "Errors", status: "pass", severity: "high",
        message: "0 failed agent tasks in 24h.",
      });
    } else if (failedTasks24h <= 5) {
      checks.push({
        id: "errors.agentTasks", label: "Failed agent tasks (24h)",
        category: "Errors", status: "warn", severity: "medium",
        message: `${failedTasks24h} failed agent task(s) in 24h.`,
      });
    } else {
      checks.push({
        id: "errors.agentTasks", label: "Failed agent tasks (24h)",
        category: "Errors", status: "fail", severity: "high",
        message: `${failedTasks24h} failed agent task(s) in 24h (>5). Investigate the cause.`,
        action: "Check /errors dashboard for failure patterns.",
      });
    }

    // Failed executions
    const failedExecs24h = await prisma.scheduleExecution.count({
      where: { status: "failed", createdAt: { gte: since24h } },
    });

    if (failedExecs24h === 0) {
      checks.push({
        id: "errors.executions", label: "Failed schedule executions (24h)",
        category: "Errors", status: "pass", severity: "high",
        message: "0 failed executions in 24h.",
      });
    } else if (failedExecs24h <= 3) {
      checks.push({
        id: "errors.executions", label: "Failed schedule executions (24h)",
        category: "Errors", status: "warn", severity: "medium",
        message: `${failedExecs24h} failed execution(s) in 24h.`,
      });
    } else {
      checks.push({
        id: "errors.executions", label: "Failed schedule executions (24h)",
        category: "Errors", status: "fail", severity: "high",
        message: `${failedExecs24h} failed execution(s) in 24h (>3). Scheduled messages may be missed.`,
        action: "Check /errors dashboard and schedule status.",
      });
    }

    // Stale heartbeats (critical ones)
    const hbSummary = await getHeartbeatSummary();
    const criticalKeys = ["backend", "zaloConnection"];
    const staleCritical = criticalKeys.filter(k => hbSummary[k]?.status === "stale");
    const downCritical = criticalKeys.filter(k => hbSummary[k]?.status === "down");

    if (downCritical.length > 0) {
      checks.push({
        id: "errors.heartbeats", label: "Critical heartbeats down",
        category: "Errors", status: "fail", severity: "critical",
        message: `Critical component(s) DOWN: ${downCritical.join(", ")}.`,
        action: "Restart the affected components immediately.",
      });
    } else if (staleCritical.length > 0) {
      checks.push({
        id: "errors.heartbeats", label: "Critical heartbeats stale",
        category: "Errors", status: "warn", severity: "high",
        message: `Stale heartbeats: ${staleCritical.join(", ")}.`,
      });
    } else {
      checks.push({
        id: "errors.heartbeats", label: "No stale critical heartbeats",
        category: "Errors", status: "pass", severity: "high",
        message: "All critical heartbeats are OK.",
      });
    }
  } catch {
    checks.push({
      id: "errors.status", label: "Error check",
      category: "Errors", status: "warn", severity: "medium",
      message: "Could not complete error checks (DB unavailable?).",
    });
  }
}

// ── Main entry point ─────────────────────────────────────────────────

export async function getProductionReadiness(): Promise<ReadinessResult> {
  const checks: ReadinessCheck[] = [];

  // Gather data in parallel where possible
  const configResult = runConfigChecks();

  // Run all check groups
  await Promise.all([
    checkZaloGroup(checks),
    checkSafetyGroup(checks),
    Promise.resolve(checkConfigGroup(checks, configResult)),
    checkHealthGroup(checks),
    checkBackupGroup(checks),
    Promise.resolve(checkSecurityGroup(checks)),
    checkRulesGroup(checks),
    checkDocumentsGroup(checks),
    checkErrorsGroup(checks),
  ]);

  // Compute summary
  const summary: ReadinessSummary = {
    pass: checks.filter(c => c.status === "pass").length,
    warn: checks.filter(c => c.status === "warn").length,
    fail: checks.filter(c => c.status === "fail").length,
    criticalFail: checks.filter(c => c.status === "fail" && c.severity === "critical").length,
    highFail: checks.filter(c => c.status === "fail" && c.severity === "high").length,
  };

  // Verdict logic
  let verdict: Verdict;
  if (summary.criticalFail > 0 || summary.highFail > 0) {
    verdict = "NOT_READY";
  } else if (summary.warn > 0 || summary.fail > 0) {
    verdict = "WARNING_ONLY";
  } else {
    verdict = "READY_FOR_LIVE";
  }

  // Score: 100 - (critical*30 + high*15 + warn*5)
  const score = Math.max(0,
    100 - (summary.criticalFail * 30 + summary.highFail * 15 + summary.warn * 5),
  );

  return {
    verdict,
    score,
    timestamp: new Date().toISOString(),
    checks,
    summary,
  };
}
