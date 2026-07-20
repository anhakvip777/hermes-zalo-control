// =============================================================================
// Production Readiness Service — fail-closed gate before controlled live tests
// =============================================================================

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { runConfigChecks } from "../config-consistency.js";
import { prisma } from "../db.js";
import { checkProcessLock, readLockFile } from "../process-lock.js";
import { getThreadReviewSummary } from "./allowed-thread-review.service.js";
import { getHeartbeatSummary } from "./heartbeat.service.js";
import { getAllRuntimeSettings, getCurrentEffectiveDryRun } from "./runtime-config.service.js";

// ── Types ────────────────────────────────────────────────────────────

export type CheckSeverity = "critical" | "high" | "medium" | "low";
export type CheckStatus = "pass" | "warn" | "fail" | "unknown";
export type Verdict = "READY_FOR_LIVE" | "WARNING_ONLY" | "NOT_READY";
export type DataQuality = "complete" | "incomplete";

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
  unknown: number;
  criticalFail: number;
  highFail: number;
}

export interface ReadinessResult {
  verdict: Verdict;
  score: number | null;
  dataQuality: DataQuality;
  timestamp: string;
  checks: ReadinessCheck[];
  summary: ReadinessSummary;
}

interface RequiredCheckDefinition {
  id: string;
  label: string;
  category: string;
  severity: CheckSeverity;
}

const CATEGORY_ORDER = [
  "Zalo",
  "Safety",
  "Config",
  "Health",
  "Backup",
  "Security",
  "Rules",
  "Documents",
  "Errors",
] as const;

export const REQUIRED_READINESS_CHECK_IDS = [
  "zalo.connected",
  "zalo.listener",
  "zalo.messagePipeline",
  "safety.dryRun",
  "safety.allowedThreads",
  "safety.groupRisk",
  "config.status",
  "config.strictErrors",
  "health.backend",
  "health.worker",
  "health.processLock",
  "health.db",
  "backup.recent",
  "backup.dbSize",
  "backup.session",
  "security.adminPassword",
  "rules.status",
  "docs.status",
  "errors.agentTasks",
  "errors.executions",
  "errors.heartbeats",
] as const;

const REQUIRED_CHECKS: RequiredCheckDefinition[] = [
  { id: REQUIRED_READINESS_CHECK_IDS[0], label: "Zalo connected", category: "Zalo", severity: "critical" },
  { id: REQUIRED_READINESS_CHECK_IDS[1], label: "Listener active", category: "Zalo", severity: "high" },
  { id: REQUIRED_READINESS_CHECK_IDS[2], label: "Message pipeline heartbeat", category: "Zalo", severity: "medium" },
  { id: REQUIRED_READINESS_CHECK_IDS[3], label: "Dry-run mode active", category: "Safety", severity: "critical" },
  { id: REQUIRED_READINESS_CHECK_IDS[4], label: "Allowed threads configured", category: "Safety", severity: "critical" },
  { id: REQUIRED_READINESS_CHECK_IDS[5], label: "Allowlist thread risk", category: "Safety", severity: "high" },
  { id: REQUIRED_READINESS_CHECK_IDS[6], label: "Configuration status", category: "Config", severity: "critical" },
  { id: REQUIRED_READINESS_CHECK_IDS[7], label: "Strict config errors", category: "Config", severity: "critical" },
  { id: REQUIRED_READINESS_CHECK_IDS[8], label: "Backend heartbeat", category: "Health", severity: "critical" },
  { id: REQUIRED_READINESS_CHECK_IDS[9], label: "Schedule worker heartbeat", category: "Health", severity: "high" },
  { id: REQUIRED_READINESS_CHECK_IDS[10], label: "Process lock", category: "Health", severity: "critical" },
  { id: REQUIRED_READINESS_CHECK_IDS[11], label: "Database accessible", category: "Health", severity: "critical" },
  { id: REQUIRED_READINESS_CHECK_IDS[12], label: "Recent backup exists", category: "Backup", severity: "high" },
  { id: REQUIRED_READINESS_CHECK_IDS[13], label: "Database size", category: "Backup", severity: "low" },
  { id: REQUIRED_READINESS_CHECK_IDS[14], label: "Zalo session persistence", category: "Backup", severity: "high" },
  { id: REQUIRED_READINESS_CHECK_IDS[15], label: "Admin password", category: "Security", severity: "critical" },
  { id: REQUIRED_READINESS_CHECK_IDS[16], label: "Rule configuration", category: "Rules", severity: "medium" },
  { id: REQUIRED_READINESS_CHECK_IDS[17], label: "Document service status", category: "Documents", severity: "medium" },
  { id: REQUIRED_READINESS_CHECK_IDS[18], label: "Failed agent tasks (24h)", category: "Errors", severity: "high" },
  { id: REQUIRED_READINESS_CHECK_IDS[19], label: "Failed schedule executions (24h)", category: "Errors", severity: "high" },
  { id: REQUIRED_READINESS_CHECK_IDS[20], label: "Critical heartbeat state", category: "Errors", severity: "critical" },
];

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = resolve(BACKEND_ROOT, "../..");

// ── Helpers ──────────────────────────────────────────────────────────

function addCheck(
  checks: ReadinessCheck[],
  check: ReadinessCheck,
): void {
  checks.push(check);
}

function addUnknown(
  checks: ReadinessCheck[],
  definition: RequiredCheckDefinition,
  message: string,
): void {
  addCheck(checks, {
    ...definition,
    status: "unknown",
    message,
    action: "Restore the missing dependency or evidence, then refresh readiness.",
  });
}

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const lower = value.toLowerCase();
  return lower.includes("changeme") || lower.includes("change-me") ||
    lower === "xxx" || lower === "test" || lower === "placeholder" || lower === "admin";
}

function hoursAgo(isoString: string | null): number | null {
  if (!isoString) return null;
  const then = new Date(isoString).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.round((Date.now() - then) / (3600 * 1000) * 10) / 10;
}

function maskSessionPath(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : `…/${parts.join("/")}`;
}

function resolveConfiguredDatabasePath(): string | null {
  const match = config.database.url.match(/^file:(.+)$/);
  if (!match?.[1]) return null;

  const configuredPath = decodeURIComponent(match[1]);
  if (configuredPath === ":memory:") return null;
  if (isAbsolute(configuredPath)) return resolve(configuredPath);

  // Prisma resolves relative SQLite URLs from the directory containing schema.prisma.
  return resolve(BACKEND_ROOT, "prisma", configuredPath);
}

function stableSortChecks(checks: ReadinessCheck[]): ReadinessCheck[] {
  const categoryRank = new Map(CATEGORY_ORDER.map((category, index) => [category, index]));
  return [...checks].sort((a, b) => {
    const categoryDiff = (categoryRank.get(a.category as typeof CATEGORY_ORDER[number]) ?? 999) -
      (categoryRank.get(b.category as typeof CATEGORY_ORDER[number]) ?? 999);
    return categoryDiff || a.id.localeCompare(b.id);
  });
}

function normalizeRequiredChecks(checks: ReadinessCheck[]): ReadinessCheck[] {
  const definitions = new Map(REQUIRED_CHECKS.map((definition) => [definition.id, definition]));
  const grouped = new Map<string, ReadinessCheck[]>();

  for (const check of checks) {
    const entries = grouped.get(check.id) ?? [];
    entries.push(check);
    grouped.set(check.id, entries);
  }

  const normalized: ReadinessCheck[] = [];
  for (const [id, entries] of grouped) {
    if (entries.length === 1) {
      normalized.push(entries[0]!);
      continue;
    }

    const first = entries[0]!;
    const definition = definitions.get(id) ?? first;
    normalized.push({
      id,
      label: definition.label,
      category: definition.category,
      severity: definition.severity,
      status: "unknown",
      message: `Readiness contract produced ${entries.length} conflicting results for this check.`,
      action: "Resolve the duplicate readiness evidence before any controlled live test.",
    });
  }

  const present = new Set(normalized.map((check) => check.id));
  for (const definition of REQUIRED_CHECKS) {
    if (!present.has(definition.id)) {
      addUnknown(normalized, definition, "Required readiness evidence was not produced.");
    }
  }

  return stableSortChecks(normalized);
}

function heartbeatCheck(
  id: string,
  label: string,
  category: string,
  severity: CheckSeverity,
  heartbeat: { status: string; ageSeconds: number | null; lastBeatAt?: string | null } | undefined,
): ReadinessCheck {
  if (!heartbeat || !heartbeat.lastBeatAt) {
    return { id, label, category, severity, status: "unknown", message: "No heartbeat evidence is available." };
  }
  if (heartbeat.status === "ok") {
    return { id, label, category, severity, status: "pass", message: `Heartbeat OK (${heartbeat.ageSeconds ?? "unknown"}s ago).` };
  }
  if (heartbeat.status === "stale") {
    return { id, label, category, severity, status: "warn", message: `Heartbeat is stale (${heartbeat.ageSeconds ?? "unknown"}s old).` };
  }
  if (heartbeat.status === "down") {
    return { id, label, category, severity, status: "fail", message: "Heartbeat reports the component is down." };
  }
  return { id, label, category, severity, status: "unknown", message: `Unrecognized heartbeat status: ${heartbeat.status}.` };
}

// ── Check groups ─────────────────────────────────────────────────────

async function checkZaloGroup(checks: ReadinessCheck[]): Promise<void> {
  try {
    const { getZaloGateway } = await import("./zalo-gateway.service.js");
    const gateway = getZaloGateway();
    const status = gateway.getStatus();

    addCheck(checks, {
      id: "zalo.connected",
      label: "Zalo connected",
      category: "Zalo",
      status: status.connected ? "pass" : "fail",
      severity: "critical",
      message: status.connected
        ? `Connected as ${status.selfDisplayName ?? status.selfUserId ?? "unidentified account"}.`
        : status.lastError ? `Disconnected: ${status.lastError}` : "Zalo is disconnected.",
      ...(!status.connected && { action: "Reconnect only in a separately approved operational scope." }),
    });

    const listenerActive = gateway.isListenerActive();
    addCheck(checks, {
      id: "zalo.listener",
      label: "Listener active",
      category: "Zalo",
      status: listenerActive ? "pass" : "fail",
      severity: "high",
      message: listenerActive
        ? "Listener reports active."
        : status.connected ? "Zalo is connected but the listener is inactive." : "Listener is inactive while Zalo is disconnected.",
    });
  } catch {
    addUnknown(checks, REQUIRED_CHECKS[0]!, "Zalo gateway status could not be read.");
    addUnknown(checks, REQUIRED_CHECKS[1]!, "Zalo listener status could not be read.");
  }

  try {
    const heartbeats = await getHeartbeatSummary();
    addCheck(checks, heartbeatCheck(
      "zalo.messagePipeline",
      "Message pipeline heartbeat",
      "Zalo",
      "medium",
      heartbeats.messagePipeline,
    ));
  } catch {
    addUnknown(checks, REQUIRED_CHECKS[2]!, "Message pipeline heartbeat could not be read.");
  }
}

async function checkSafetyGroup(checks: ReadinessCheck[]): Promise<void> {
  const dryRun = getCurrentEffectiveDryRun();
  addCheck(checks, {
    id: "safety.dryRun",
    label: "Dry-run mode active",
    category: "Safety",
    status: dryRun ? "pass" : "fail",
    severity: "critical",
    message: dryRun
      ? "Effective auto-reply dry-run is enabled."
      : "Effective auto-reply dry-run is disabled; global live is unsupported.",
    ...(!dryRun && { action: "Restore dry-run. Global live is disabled; only LiveTestSession may bypass it." }),
  });

  try {
    const settings = await getAllRuntimeSettings();
    const allowedSetting = settings.find((setting) => setting.key === "autoReply.allowedThreads");
    let allowedThreads = config.autoReply.allowedThreads;

    if (allowedSetting) {
      try {
        const parsed = JSON.parse(allowedSetting.value);
        if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
          throw new Error("invalid allowedThreads payload");
        }
        allowedThreads = parsed;
      } catch {
        addUnknown(checks, REQUIRED_CHECKS[4]!, "Runtime allowedThreads evidence is malformed.");
        allowedThreads = [];
      }
    }

    if (!checks.some((check) => check.id === "safety.allowedThreads")) {
      addCheck(checks, {
        id: "safety.allowedThreads",
        label: "Allowed threads configured",
        category: "Safety",
        status: allowedThreads.length > 0 ? "pass" : "fail",
        severity: "critical",
        message: allowedThreads.length > 0
          ? `${allowedThreads.length} thread(s) are allowlisted.`
          : "No thread is allowlisted for controlled replies.",
        ...(allowedThreads.length === 0 && { action: "Review and explicitly configure the allowlist before a controlled test." }),
      });
    }
  } catch {
    addUnknown(checks, REQUIRED_CHECKS[4]!, "Allowed-thread settings could not be read.");
  }

  try {
    const review = await getThreadReviewSummary();
    const status: CheckStatus = review.unknownCount > 0
      ? "unknown"
      : review.highRiskCount > 0
        ? "fail"
        : "pass";
    addCheck(checks, {
      id: "safety.groupRisk",
      label: "Allowlist thread risk",
      category: "Safety",
      status,
      severity: "high",
      message: review.unknownCount > 0
        ? `${review.unknownCount} allowlisted thread(s) have unknown type or risk evidence.`
        : review.highRiskCount > 0
          ? `${review.highRiskCount} high-risk allowlisted thread(s) were detected.`
          : `${review.totalThreads} allowlisted thread(s) reviewed; no high-risk thread detected.`,
    });
  } catch {
    addUnknown(checks, REQUIRED_CHECKS[5]!, "Allowlist risk review could not be completed.");
  }
}

async function checkConfigGroup(checks: ReadinessCheck[]): Promise<void> {
  try {
    const result = runConfigChecks();
    const status: CheckStatus = result.status === "CONFIG_OK"
      ? "pass"
      : result.status === "CONFIG_WARN" ? "warn" : "fail";
    addCheck(checks, {
      id: "config.status",
      label: "Configuration status",
      category: "Config",
      status,
      severity: "critical",
      message: `${result.status} — ${result.summary.pass} pass, ${result.summary.warn} warn, ${result.summary.error} error.`,
    });

    const strictErrors = result.checks.filter((check) => !check.safe && check.severity === "ERROR");
    addCheck(checks, {
      id: "config.strictErrors",
      label: "Strict config errors",
      category: "Config",
      status: strictErrors.length > 0 ? "fail" : "pass",
      severity: "critical",
      message: strictErrors.length > 0
        ? `${strictErrors.length} strict configuration error(s): ${strictErrors.map((check) => check.name).join(", ")}.`
        : "No strict configuration error was detected.",
    });
  } catch {
    addUnknown(checks, REQUIRED_CHECKS[6]!, "Configuration checks could not be executed.");
    addUnknown(checks, REQUIRED_CHECKS[7]!, "Strict configuration evidence is unavailable.");
  }
}

async function checkHealthGroup(checks: ReadinessCheck[]): Promise<void> {
  try {
    const heartbeats = await getHeartbeatSummary();
    addCheck(checks, heartbeatCheck("health.backend", "Backend heartbeat", "Health", "critical", heartbeats.backend));
    addCheck(checks, heartbeatCheck("health.worker", "Schedule worker heartbeat", "Health", "high", heartbeats.schedulerWorker));
  } catch {
    addUnknown(checks, REQUIRED_CHECKS[8]!, "Backend heartbeat could not be read.");
    addUnknown(checks, REQUIRED_CHECKS[9]!, "Schedule worker heartbeat could not be read.");
  }

  try {
    const lockCheck = checkProcessLock();
    const lockInfo = readLockFile();
    const isOwner = lockInfo !== null && lockInfo.pid === process.pid;

    if (lockCheck.locked && !lockCheck.stale && isOwner) {
      addCheck(checks, {
        id: "health.processLock", label: "Process lock", category: "Health",
        status: "pass", severity: "critical",
        message: `This process owns the lock (PID ${process.pid}).`,
      });
    } else if (lockCheck.locked && !lockCheck.stale) {
      addCheck(checks, {
        id: "health.processLock", label: "Process lock", category: "Health",
        status: "fail", severity: "critical",
        message: `Another process owns the lock (PID ${lockCheck.info?.pid ?? "unknown"}).`,
      });
    } else if (lockCheck.stale) {
      addCheck(checks, {
        id: "health.processLock", label: "Process lock", category: "Health",
        status: "warn", severity: "critical",
        message: "The process lock evidence is stale.",
      });
    } else {
      addUnknown(checks, REQUIRED_CHECKS[10]!, "No active process-lock ownership evidence is available.");
    }
  } catch {
    addUnknown(checks, REQUIRED_CHECKS[10]!, "Process-lock evidence could not be read.");
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    addCheck(checks, {
      id: "health.db", label: "Database accessible", category: "Health",
      status: "pass", severity: "critical", message: "Database query completed successfully.",
    });
  } catch {
    addUnknown(checks, REQUIRED_CHECKS[11]!, "Database accessibility could not be measured.");
  }
}

async function checkBackupGroup(checks: ReadinessCheck[]): Promise<void> {
  const backupDirectories = [
    resolve(BACKEND_ROOT, "backups", "system"),
    resolve(BACKEND_ROOT, "backups", "db"),
    resolve(REPO_ROOT, "backups", "system"),
    resolve(REPO_ROOT, "backups", "db"),
  ];
  let latestAt: string | null = null;
  let backupCount = 0;
  let scanFailed = false;

  for (const directory of backupDirectories) {
    try {
      if (!existsSync(directory)) continue;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = resolve(directory, entry.name);
        if (entry.isFile() && /\.(sqlite|sqlite3|db)$/i.test(entry.name)) {
          const modifiedAt = statSync(entryPath).mtime.toISOString();
          backupCount++;
          if (!latestAt || modifiedAt > latestAt) latestAt = modifiedAt;
          continue;
        }
        if (!entry.isDirectory()) continue;

        const nestedDatabaseFiles = readdirSync(entryPath, { withFileTypes: true })
          .filter((nested) => nested.isFile() && /\.(sqlite|sqlite3|db)$/i.test(nested.name));
        for (const nested of nestedDatabaseFiles) {
          const modifiedAt = statSync(resolve(entryPath, nested.name)).mtime.toISOString();
          backupCount++;
          if (!latestAt || modifiedAt > latestAt) latestAt = modifiedAt;
        }
      }
    } catch {
      scanFailed = true;
    }
  }

  const ageHours = hoursAgo(latestAt);
  if (scanFailed && backupCount === 0) {
    addUnknown(checks, REQUIRED_CHECKS[12]!, "Backup locations could not be scanned completely.");
  } else if (ageHours !== null && ageHours <= 24) {
    addCheck(checks, {
      id: "backup.recent", label: "Recent backup exists", category: "Backup",
      status: "pass", severity: "high", message: `Latest backup is ${ageHours}h old (${backupCount} found).`,
    });
  } else if (ageHours !== null) {
    addCheck(checks, {
      id: "backup.recent", label: "Recent backup exists", category: "Backup",
      status: "warn", severity: "high", message: `Latest backup is ${ageHours}h old (${backupCount} found).`,
    });
  } else {
    addCheck(checks, {
      id: "backup.recent", label: "Recent backup exists", category: "Backup",
      status: "fail", severity: "high", message: "No backup evidence was found in configured backup locations.",
    });
  }

  const databasePath = resolveConfiguredDatabasePath();
  if (!databasePath) {
    addUnknown(checks, REQUIRED_CHECKS[13]!, "Configured database is not a measurable SQLite file.");
  } else {
    try {
      if (!existsSync(databasePath)) {
        addUnknown(checks, REQUIRED_CHECKS[13]!, "The configured SQLite database file does not exist at the resolved path.");
      } else {
        const sizeMb = Math.round(statSync(databasePath).size / (1024 * 1024) * 10) / 10;
        addCheck(checks, {
          id: "backup.dbSize", label: "Database size", category: "Backup",
          status: sizeMb > 100 ? "warn" : "pass", severity: "low",
          message: `Configured database size is ${sizeMb} MB.`,
        });
      }
    } catch {
      addUnknown(checks, REQUIRED_CHECKS[13]!, "Configured database size could not be read.");
    }
  }

  try {
    const { getZaloGateway } = await import("./zalo-gateway.service.js");
    const connected = getZaloGateway().isConnected();
    const sessionPath = resolve(config.zalo.sessionDir, "zalo-session.json");
    if (!connected) {
      addUnknown(checks, REQUIRED_CHECKS[14]!, "Zalo is disconnected, so session persistence cannot be verified for a controlled live test.");
    } else if (!existsSync(sessionPath)) {
      addCheck(checks, {
        id: "backup.session", label: "Zalo session persistence", category: "Backup",
        status: "fail", severity: "high", message: "Zalo is connected but the persisted session file is missing.",
      });
    } else {
      addCheck(checks, {
        id: "backup.session", label: "Zalo session persistence", category: "Backup",
        status: "pass", severity: "high",
        message: `Persisted session evidence exists at ${maskSessionPath(sessionPath)} (${statSync(sessionPath).mtime.toISOString()}).`,
      });
    }
  } catch {
    addUnknown(checks, REQUIRED_CHECKS[14]!, "Zalo session persistence evidence could not be read.");
  }
}

function checkSecurityGroup(checks: ReadinessCheck[]): void {
  const placeholder = isPlaceholder(config.security.adminPassword);
  addCheck(checks, {
    id: "security.adminPassword",
    label: "Admin password",
    category: "Security",
    status: placeholder ? "fail" : "pass",
    severity: "critical",
    message: placeholder
      ? "ADMIN_PASSWORD is missing or uses a known placeholder value."
      : "ADMIN_PASSWORD is present and is not a known placeholder value.",
  });
}

async function checkRulesGroup(checks: ReadinessCheck[]): Promise<void> {
  try {
    const [enabledCount, fixedReplyRules] = await Promise.all([
      prisma.rule.count({ where: { enabled: true } }),
      prisma.rule.findMany({
        where: { enabled: true, actionType: "fixed_reply" },
        select: { targetThreadIds: true },
      }),
    ]);

    const broadFixedReplies = fixedReplyRules.filter((rule) => {
      if (!rule.targetThreadIds) return true;
      try {
        const parsed = JSON.parse(rule.targetThreadIds);
        return !Array.isArray(parsed) || parsed.length === 0;
      } catch {
        return true;
      }
    }).length;

    addCheck(checks, {
      id: "rules.status",
      label: "Rule configuration",
      category: "Rules",
      status: broadFixedReplies > 0 ? "warn" : "pass",
      severity: "medium",
      message: broadFixedReplies > 0
        ? `${broadFixedReplies} enabled fixed-reply rule(s) lack a valid thread scope.`
        : `${enabledCount} rule(s) enabled; no unscoped fixed-reply rule detected.`,
    });
  } catch {
    addUnknown(checks, REQUIRED_CHECKS[16]!, "Rule configuration could not be queried.");
  }
}

async function checkDocumentsGroup(checks: ReadinessCheck[]): Promise<void> {
  if (!config.document.enabled) {
    addCheck(checks, {
      id: "docs.status", label: "Document service status", category: "Documents",
      status: "pass", severity: "medium", message: "Document ingestion is disabled by configuration.",
    });
    return;
  }

  try {
    const since24h = new Date(Date.now() - 24 * 3600_000);
    const stuckCutoff = new Date(Date.now() - 30 * 60_000);
    const [stuckJobs, failedDocuments] = await Promise.all([
      prisma.documentIngestionJob.count({ where: { status: "processing", startedAt: { lt: stuckCutoff } } }),
      prisma.document.count({ where: { status: "failed", createdAt: { gte: since24h } } }),
    ]);
    const status: CheckStatus = stuckJobs > 0 ? "fail" : failedDocuments > 0 ? "warn" : "pass";
    addCheck(checks, {
      id: "docs.status", label: "Document service status", category: "Documents",
      status, severity: "medium",
      message: `${stuckJobs} stuck ingestion job(s); ${failedDocuments} failed document(s) in 24h.`,
    });
  } catch {
    addUnknown(checks, REQUIRED_CHECKS[17]!, "Document service evidence could not be queried.");
  }
}

async function checkErrorsGroup(checks: ReadinessCheck[]): Promise<void> {
  const since24h = new Date(Date.now() - 24 * 3600_000);
  try {
    const failedTasks = await prisma.agentTask.count({ where: { status: "failed", createdAt: { gte: since24h } } });
    addCheck(checks, {
      id: "errors.agentTasks", label: "Failed agent tasks (24h)", category: "Errors",
      status: failedTasks === 0 ? "pass" : failedTasks <= 5 ? "warn" : "fail",
      severity: "high", message: `${failedTasks} failed agent task(s) in 24h.`,
    });
  } catch {
    addUnknown(checks, REQUIRED_CHECKS[18]!, "Failed-agent-task evidence could not be queried.");
  }

  try {
    const failedExecutions = await prisma.scheduleExecution.count({ where: { status: "failed", createdAt: { gte: since24h } } });
    addCheck(checks, {
      id: "errors.executions", label: "Failed schedule executions (24h)", category: "Errors",
      status: failedExecutions === 0 ? "pass" : failedExecutions <= 3 ? "warn" : "fail",
      severity: "high", message: `${failedExecutions} failed schedule execution(s) in 24h.`,
    });
  } catch {
    addUnknown(checks, REQUIRED_CHECKS[19]!, "Failed-schedule evidence could not be queried.");
  }

  try {
    const heartbeats = await getHeartbeatSummary();
    const critical = [heartbeats.backend, heartbeats.zaloConnection];
    if (critical.some((heartbeat) => !heartbeat?.lastBeatAt)) {
      addUnknown(checks, REQUIRED_CHECKS[20]!, "One or more critical heartbeat records are missing.");
    } else if (critical.some((heartbeat) => heartbeat?.status === "down")) {
      addCheck(checks, {
        id: "errors.heartbeats", label: "Critical heartbeat state", category: "Errors",
        status: "fail", severity: "critical", message: "At least one critical heartbeat reports down.",
      });
    } else if (critical.some((heartbeat) => heartbeat?.status === "stale")) {
      addCheck(checks, {
        id: "errors.heartbeats", label: "Critical heartbeat state", category: "Errors",
        status: "warn", severity: "critical", message: "At least one critical heartbeat is stale.",
      });
    } else if (critical.every((heartbeat) => heartbeat?.status === "ok")) {
      addCheck(checks, {
        id: "errors.heartbeats", label: "Critical heartbeat state", category: "Errors",
        status: "pass", severity: "critical", message: "All critical heartbeats report OK.",
      });
    } else {
      addUnknown(checks, REQUIRED_CHECKS[20]!, "A critical heartbeat has an unrecognized state.");
    }
  } catch {
    addUnknown(checks, REQUIRED_CHECKS[20]!, "Critical heartbeat evidence could not be read.");
  }
}

// ── Main entry point ─────────────────────────────────────────────────

export async function getProductionReadiness(): Promise<ReadinessResult> {
  const checks: ReadinessCheck[] = [];

  await Promise.allSettled([
    checkZaloGroup(checks),
    checkSafetyGroup(checks),
    checkConfigGroup(checks),
    checkHealthGroup(checks),
    checkBackupGroup(checks),
    Promise.resolve(checkSecurityGroup(checks)),
    checkRulesGroup(checks),
    checkDocumentsGroup(checks),
    checkErrorsGroup(checks),
  ]);

  const normalizedChecks = normalizeRequiredChecks(checks);
  const summary: ReadinessSummary = {
    pass: normalizedChecks.filter((check) => check.status === "pass").length,
    warn: normalizedChecks.filter((check) => check.status === "warn").length,
    fail: normalizedChecks.filter((check) => check.status === "fail").length,
    unknown: normalizedChecks.filter((check) => check.status === "unknown").length,
    criticalFail: normalizedChecks.filter((check) =>
      (check.status === "fail" || check.status === "unknown") && check.severity === "critical"
    ).length,
    highFail: normalizedChecks.filter((check) =>
      (check.status === "fail" || check.status === "unknown") && check.severity === "high"
    ).length,
  };

  const dataQuality: DataQuality = summary.unknown === 0 ? "complete" : "incomplete";
  const verdict: Verdict = dataQuality === "incomplete" || summary.fail > 0
    ? "NOT_READY"
    : summary.warn > 0 ? "WARNING_ONLY" : "READY_FOR_LIVE";
  const score = dataQuality === "complete"
    ? Math.max(0, 100 - (summary.criticalFail * 30 + summary.highFail * 15 + summary.fail * 10 + summary.warn * 5))
    : null;

  return {
    verdict,
    score,
    dataQuality,
    timestamp: new Date().toISOString(),
    checks: normalizedChecks,
    summary,
  };
}
