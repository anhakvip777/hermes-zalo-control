// =============================================================================
// Error Summary Service — aggregate errors across all system modules
// =============================================================================

import { prisma } from "../db.js";
import { config } from "../config.js";
import { getHeartbeatSummary } from "./heartbeat.service.js";
import { runConfigChecks } from "../config-consistency.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface ErrorGroup {
  source: "AgentTask" | "ScheduleExecution" | "OutboundRecord" | "Heartbeat" | "Config";
  errorCode: string;
  count: number;
  lastSeenAt: string;
  sampleMessage?: string;
  severity: "low" | "medium" | "high";
}

export interface ErrorSummary {
  windowHours: number;
  status: "ok" | "warn" | "error";
  totals: {
    errors: number;
    warnings: number;
    failedAgentTasks: number;
    failedExecutions: number;
    blockedOutbound: number;
    staleHeartbeats: number;
  };
  groups: ErrorGroup[];
  recent: RecentError[];
}

export interface RecentError {
  source: string;
  errorCode: string;
  message: string;
  seenAt: string;
  severity: "low" | "medium" | "high";
}

export interface ErrorAlertPayload {
  summary: ErrorSummary;
  dryRun: boolean;
  channel: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function since(hours: number): Date {
  return new Date(Date.now() - hours * 3600_000);
}

function iso(d: Date | null | undefined): string {
  if (!d) return new Date().toISOString();
  if (typeof d === "string") return d;
  return d.toISOString();
}

// ── Severity heuristics ───────────────────────────────────────────────────

function classifySeverity(source: string, errorCode: string): "low" | "medium" | "high" {
  // High: connectivity failures, auth errors, critical system failures
  if (
    errorCode.includes("ZALO_NOT_CONNECTED") ||
    errorCode.includes("zaloConnection:down") ||
    errorCode.includes("zaloConnection:stale") ||
    errorCode.includes("HERMES_CLI_FAILED") ||
    errorCode.includes("HERMES_CLI_MISSING") ||
    errorCode.includes("WORKER_LOCK_LOST") ||
    errorCode.includes("DB_CORRUPTION")
  ) return "high";

  // Medium: API failures, timeouts, guardrail blocks
  if (
    errorCode.includes("FAILED") ||
    errorCode.includes("TIMEOUT") ||
    errorCode.includes("BLOCKED") ||
    errorCode.includes("DUPLICATE") ||
    errorCode.includes("CONFIG_WARN") ||
    errorCode.includes("stale")
  ) return "medium";

  // Low: anything else
  return "low";
}

// ── Collectors ────────────────────────────────────────────────────────────

async function collectFailedAgentTasks(windowHours: number): Promise<ErrorGroup[]> {
  const cutoff = since(windowHours);
  const rows = await prisma.agentTask.findMany({
    where: { status: "failed", createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
    select: { taskType: true, errorMessage: true, createdAt: true },
  });

  const groups = new Map<string, ErrorGroup>();
  for (const r of rows) {
    const code = r.errorMessage?.slice(0, 40) ?? "UNKNOWN";
    const key = `AgentTask:${code}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      if (new Date(r.createdAt) > new Date(existing.lastSeenAt)) {
        existing.lastSeenAt = iso(r.createdAt);
      }
    } else {
      groups.set(key, {
        source: "AgentTask",
        errorCode: code,
        count: 1,
        lastSeenAt: iso(r.createdAt),
        sampleMessage: r.errorMessage ?? undefined,
        severity: classifySeverity("AgentTask", code),
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

async function collectFailedExecutions(windowHours: number): Promise<ErrorGroup[]> {
  const cutoff = since(windowHours);
  const rows = await prisma.scheduleExecution.findMany({
    where: { status: "failed", createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
    select: { errorMessage: true, errorCode: true, createdAt: true },
  });

  const groups = new Map<string, ErrorGroup>();
  for (const r of rows) {
    const code = r.errorCode || r.errorMessage?.slice(0, 40) || "UNKNOWN";
    const key = `ScheduleExecution:${code}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      if (new Date(r.createdAt) > new Date(existing.lastSeenAt)) {
        existing.lastSeenAt = iso(r.createdAt);
      }
    } else {
      groups.set(key, {
        source: "ScheduleExecution",
        errorCode: code,
        count: 1,
        lastSeenAt: iso(r.createdAt),
        sampleMessage: r.errorMessage ?? r.errorCode ?? undefined,
        severity: classifySeverity("ScheduleExecution", code),
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

async function collectBlockedOutbound(windowHours: number): Promise<ErrorGroup[]> {
  const cutoff = since(windowHours);
  const rows = await prisma.outboundRecord.findMany({
    where: {
      decision: { in: ["block", "skip"] },
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: "desc" },
    select: { decision: true, reason: true, createdAt: true, errorCode: true },
  });

  const groups = new Map<string, ErrorGroup>();
  for (const r of rows) {
    const code = r.errorCode || r.reason || r.decision;
    const key = `OutboundRecord:${code}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      if (new Date(r.createdAt) > new Date(existing.lastSeenAt)) {
        existing.lastSeenAt = iso(r.createdAt);
      }
    } else {
      groups.set(key, {
        source: "OutboundRecord",
        errorCode: code,
        count: 1,
        lastSeenAt: iso(r.createdAt),
        sampleMessage: r.reason,
        severity: classifySeverity("OutboundRecord", code),
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

async function collectHeartbeatErrors(): Promise<ErrorGroup[]> {
  const hb = await getHeartbeatSummary();
  const groups: ErrorGroup[] = [];

  for (const [name, entry] of Object.entries(hb)) {
    if (entry.status === "stale" || entry.status === "down") {
      groups.push({
        source: "Heartbeat",
        errorCode: `${name}:${entry.status}`,
        count: 1,
        lastSeenAt: entry.lastErrorAt || entry.lastBeatAt || new Date().toISOString(),
        sampleMessage: entry.lastError ?? `Heartbeat ${entry.status}`,
        severity: entry.status === "down" ? "high" : "medium",
      });
    }
  }
  return groups.sort((a, b) => b.count - a.count);
}

function collectConfigErrors(): ErrorGroup[] {
  const result = runConfigChecks();
  const groups: ErrorGroup[] = [];

  for (const check of result.checks) {
    if (check.severity === "WARN" || check.severity === "ERROR") {
      groups.push({
        source: "Config",
        errorCode: check.name,
        count: 1,
        lastSeenAt: new Date().toISOString(),
        sampleMessage: check.message,
        severity: check.severity === "ERROR" ? "high" : "medium",
      });
    }
  }
  return groups;
}

// ── Recent errors ──────────────────────────────────────────────────────────

async function collectRecentErrors(limit: number): Promise<RecentError[]> {
  const cutoff = new Date(Date.now() - 72 * 3600_000); // up to 72h
  const recent: RecentError[] = [];

  // AgentTasks
  const failedTasks = await prisma.agentTask.findMany({
    where: { status: "failed", createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { taskType: true, errorMessage: true, createdAt: true },
  });
  for (const r of failedTasks) {
    recent.push({
      source: "AgentTask",
      errorCode: r.errorMessage?.slice(0, 60) ?? "UNKNOWN",
      message: r.errorMessage ?? "Agent task failed",
      seenAt: iso(r.createdAt),
      severity: classifySeverity("AgentTask", r.errorMessage ?? ""),
    });
  }

  // ScheduleExecutions
  const failedExecs = await prisma.scheduleExecution.findMany({
    where: { status: "failed", createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { errorMessage: true, errorCode: true, createdAt: true },
  });
  for (const r of failedExecs) {
    recent.push({
      source: "ScheduleExecution",
      errorCode: r.errorCode ?? "UNKNOWN",
      message: r.errorMessage ?? "Execution failed",
      seenAt: iso(r.createdAt),
      severity: classifySeverity("ScheduleExecution", r.errorCode ?? ""),
    });
  }

  // Outbound blocked/skipped
  const blocked = await prisma.outboundRecord.findMany({
    where: { decision: { in: ["block", "skip"] }, createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { decision: true, reason: true, errorCode: true, createdAt: true },
  });
  for (const r of blocked) {
    recent.push({
      source: "OutboundRecord",
      errorCode: r.errorCode || r.reason || r.decision,
      message: r.reason || `Outbound ${r.decision}`,
      seenAt: iso(r.createdAt),
      severity: "medium",
    });
  }

  // Sort by most recent first, take top N
  recent.sort((a, b) => new Date(b.seenAt).getTime() - new Date(a.seenAt).getTime());
  return recent.slice(0, limit);
}

// ── Public API ────────────────────────────────────────────────────────────

export async function getErrorSummary(windowHours = 24): Promise<ErrorSummary> {
  const hours = Math.max(1, Math.min(168, windowHours)); // clamp 1-168

  const [agentGroups, execGroups, outboundGroups, heartbeatGroups, configGroups] =
    await Promise.all([
      collectFailedAgentTasks(hours),
      collectFailedExecutions(hours),
      collectBlockedOutbound(hours),
      collectHeartbeatErrors(),
      Promise.resolve(collectConfigErrors()),
    ]);

  const allGroups = [
    ...agentGroups,
    ...execGroups,
    ...outboundGroups,
    ...heartbeatGroups,
    ...configGroups,
  ].sort((a, b) => b.count - a.count);

  const failedAgentTasks = agentGroups.reduce((sum, g) => sum + g.count, 0);
  const failedExecutions = execGroups.reduce((sum, g) => sum + g.count, 0);
  const blockedOutbound = outboundGroups.reduce((sum, g) => sum + g.count, 0);
  const staleHeartbeats = heartbeatGroups.length;

  const errors = allGroups.filter((g) => g.severity === "high").reduce((s, g) => s + g.count, 0);
  const warnings = allGroups.filter((g) => g.severity !== "high").reduce((s, g) => s + g.count, 0);

  let status: ErrorSummary["status"] = "ok";
  if (allGroups.some((g) => g.severity === "high")) status = "error";
  else if (allGroups.length > 0) status = "warn";

  const recent = await collectRecentErrors(20);

  return {
    windowHours: hours,
    status,
    totals: {
      errors,
      warnings,
      failedAgentTasks,
      failedExecutions,
      blockedOutbound,
      staleHeartbeats,
    },
    groups: allGroups,
    recent,
  };
}

// ── Alert adapter —──────────────────────────────────────────────────────

export interface AlertAdapter {
  send(message: string): Promise<{ success: boolean; dryRun: boolean; messageId?: string }>;
}

/**
 * DryRunAlertAdapter — logs alert to console, never sends.
 */
export class DryRunAlertAdapter implements AlertAdapter {
  async send(message: string) {
    console.log(`[alert:dry-run] ${message.slice(0, 200)}...`);
    return { success: true, dryRun: true };
  }
}

/**
 * TelegramAlertAdapter — sends via Telegram Bot API if config is provided.
 * Never logs the bot token in output.
 */
export class TelegramAlertAdapter implements AlertAdapter {
  private token: string;
  private chatId: string;

  constructor() {
    this.token = config.errorAlert.telegramBotToken;
    this.chatId = config.errorAlert.telegramChatId;
  }

  async send(message: string) {
    if (!this.token || !this.chatId) {
      return { success: false, dryRun: true, messageId: undefined };
    }
    if (config.errorAlert.dryRun) {
      console.log(`[alert:telegram:dry-run] would send to ${this.chatId}: ${message.slice(0, 200)}...`);
      return { success: true, dryRun: true };
    }

    try {
      const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
      const body = JSON.stringify({
        chat_id: this.chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const data = (await res.json()) as { ok?: boolean; result?: { message_id?: number } };
      if (data.ok) {
        return { success: true, dryRun: false, messageId: String(data.result?.message_id ?? "") };
      }
      return { success: false, dryRun: false };
    } catch (err) {
      console.error("[alert:telegram] send failed:", (err as Error).message);
      return { success: false, dryRun: false };
    }
  }
}

/**
 * Create the appropriate alert adapter based on config.
 */
export function createAlertAdapter(): AlertAdapter {
  if (config.errorAlert.channel === "telegram" && config.errorAlert.telegramBotToken) {
    return new TelegramAlertAdapter();
  }
  return new DryRunAlertAdapter();
}

// ── Alert formatting ──────────────────────────────────────────────────────

export function formatErrorSummaryAlert(summary: ErrorSummary): string {
  const statusEmoji = summary.status === "error" ? "🚨" : summary.status === "warn" ? "⚠️" : "✅";
  const modeTag = config.errorAlert.dryRun ? "DRY RUN" : "LIVE";

  const lines = [
    `${statusEmoji} Hermes Admin Center Error Summary`,
    ``,
    `Window: last ${summary.windowHours}h`,
    `Status: ${summary.status.toUpperCase()}`,
    ``,
    `Errors: ${summary.totals.errors}`,
    `Warnings: ${summary.totals.warnings}`,
    `Failed AgentTasks: ${summary.totals.failedAgentTasks}`,
    `Failed Executions: ${summary.totals.failedExecutions}`,
    `Blocked Outbound: ${summary.totals.blockedOutbound}`,
    `Stale Heartbeats: ${summary.totals.staleHeartbeats}`,
  ];

  if (summary.groups.length > 0) {
    lines.push(``);
    lines.push(`Top issues:`);
    for (let i = 0; i < Math.min(5, summary.groups.length); i++) {
      const g = summary.groups[i]!;
      const sev = g.severity === "high" ? "🔴" : g.severity === "medium" ? "🟡" : "🟢";
      lines.push(`${i + 1}. ${sev} ${g.source} — ${g.errorCode} (${g.count}x)`);
    }
  }

  if (summary.recent.length > 0) {
    const last = summary.recent[0]!;
    lines.push(``);
    lines.push(`Last error:`);
    lines.push(`${last.seenAt} — ${last.source} — ${last.errorCode}`);
  }

  lines.push(``);
  lines.push(`Mode: ${modeTag}`);

  return lines.join("\n");
}

// ── Alert dedup ──────────────────────────────────────────────────────────

/**
 * Check if an alert with the same fingerprint was sent within the dedup window.
 */
export async function isAlertDuplicate(fingerprint: string, windowMinutes: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - windowMinutes * 60_000);
  const existing = await prisma.systemAlert.findFirst({
    where: {
      fingerprint,
      sentAt: { gte: cutoff },
    },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Record an alert in the database for audit/dedup.
 */
export async function recordAlert(params: {
  alertType: string;
  fingerprint: string;
  severity: string;
  dryRun: boolean;
  message: string;
  source?: string;
  errorCode?: string;
  errorCount: number;
  windowHours: number;
  metadata?: Record<string, unknown>;
}) {
  return prisma.systemAlert.create({
    data: {
      alertType: params.alertType,
      fingerprint: params.fingerprint,
      severity: params.severity,
      dryRun: params.dryRun,
      message: params.message,
      source: params.source ?? null,
      errorCode: params.errorCode ?? null,
      errorCount: params.errorCount,
      windowHours: params.windowHours,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  });
}

// ── Test alert (dry-run by default) ──────────────────────────────────────

export async function triggerTestAlert(): Promise<{
  success: boolean;
  dryRun: boolean;
  messagePreview: string;
  fingerprint: string;
}> {
  const summary = await getErrorSummary(24);
  const message = formatErrorSummaryAlert(summary);
  const adapter = createAlertAdapter();
  const fingerprint = `test_alert:${Math.floor(Date.now() / 3600_000)}`;

  // Always record the alert for audit
  await recordAlert({
    alertType: "test_alert",
    fingerprint,
    severity: summary.status === "ok" ? "low" : summary.status === "warn" ? "medium" : "high",
    dryRun: config.errorAlert.dryRun,
    message,
    source: "system",
    errorCode: "TEST_ALERT",
    errorCount: summary.totals.errors + summary.totals.warnings,
    windowHours: 24,
  });

  const result = await adapter.send(message);

  return {
    success: result.success,
    dryRun: result.dryRun,
    messagePreview: message.slice(0, 300),
    fingerprint,
  };
}
