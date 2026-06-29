// =============================================================================
// Worker — receives queue jobs and executes them safely
// =============================================================================

import type { QueueJobData } from "./queue.js";
import * as scheduleService from "../services/schedule.service.js";
import * as executionService from "../services/execution.service.js";
import * as jobService from "../services/job.service.js";
import * as settingsService from "../services/settings.service.js";
import { config } from "../config.js";
import { getCurrentEffectiveDryRun, getEffectiveDryRunInfo } from "../services/runtime-config.service.js";
import { prisma } from "../db.js";

// ── Outbound dispatch: via backend internal API (no Zalo sender in worker) ─

const BACKEND_URL = process.env.INTERNAL_API_BASE_URL || "http://127.0.0.1:3002";
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN || "";

interface BackendOutboundResult {
  ok: boolean;
  decision: "sent" | "dry_run" | "blocked" | "failed";
  outboundRecordId?: string;
  sentMessageId?: string;
  dryRun: boolean;
  reason?: string;
  error?: string;
}

async function sendOutboundViaBackend(opts: {
  threadId: string;
  threadType: "user" | "group";
  content: string;
  source: string;
  relatedMessageId?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ success: boolean; dryRun: boolean; decision: string; messageId?: string; error?: string }> {
  if (!INTERNAL_TOKEN) {
    console.error("[worker] INTERNAL_API_TOKEN not set — cannot send outbound. Set INTERNAL_API_TOKEN.");
    return { success: false, dryRun: true, decision: "failed", error: "MISSING_INTERNAL_TOKEN" };
  }

  try {
    const response = await fetch(`${BACKEND_URL}/api/internal/outbound/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({
        threadId: opts.threadId,
        threadType: opts.threadType,
        source: opts.source,
        content: opts.content,
        relatedMessageId: opts.relatedMessageId,
        metadata: opts.metadata,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(`[worker] backend outbound failed: HTTP ${response.status} ${text.slice(0, 200)}`);
      return { success: false, dryRun: true, decision: "failed", error: `BACKEND_HTTP_${response.status}` };
    }

    const result = (await response.json()) as BackendOutboundResult;
    return {
      success: result.ok && (result.decision === "sent" || result.decision === "dry_run"),
      dryRun: result.dryRun,
      decision: result.decision,
      messageId: result.sentMessageId,
      error: result.error || result.reason,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] backend outbound unreachable: ${msg}`);
    return { success: false, dryRun: true, decision: "failed", error: "BACKEND_UNREACHABLE" };
  }
}

// For tests: keep optional deps injection
export async function getSender(): Promise<import("../services/message-sender.js").MessageSender> {
  // This function is still used internally but in production the backend API path is preferred.
  // Tests inject via deps?.sender; production code goes through sendOutboundViaBackend.
  const { dryRun } = getEffectiveDryRunInfo();
  if (dryRun) {
    const { MockMessageSender } = await import("../services/message-sender.js");
    return new MockMessageSender();
  }
  // R3: Production path should use sendOutboundViaBackend, not this.
  // If we reach here with dryRun=false, it means deps weren't injected → use mock
  // to avoid creating a live Zalo sender in worker (removed in R3).
  console.warn("[worker] getSender called with dryRun=false but no deps — using mock (live sender removed in R3)");
  const { MockMessageSender } = await import("../services/message-sender.js");
  return new MockMessageSender();
}

// ── Role normalization: "ai" and "assistant" both mean AI/bot actor ────
function isCreatedByAI(schedule: { createdBy: string }): boolean {
  return schedule.createdBy === "ai" || schedule.createdBy === "assistant";
}

// =============================================================================
// Main worker function — called for every queued job
// =============================================================================

export async function executeJob(
  job: QueueJobData,
  deps?: { sender?: import("../services/message-sender.js").MessageSender },
): Promise<void> {
  // ── 1. Reload latest schedule from DB ──────────────────────────────
  const schedule = await scheduleService.getScheduleById(job.scheduleId);
  if (!schedule) {
    // Schedule deleted — nothing to do
    return;
  }

  // ── 2. Version guard (R4) ──────────────────────────────────────────
  if (job.scheduleVersion < schedule.version) {
    const exec = await executionService.createExecution({
      scheduleId: schedule.id,
      scheduleVersion: schedule.version,
      scheduleJobId: undefined,
      mode: "scheduled",
      plannedRunAt: new Date(),
      targetId: schedule.targetId,
      targetName: schedule.targetName,
      messageContent: schedule.messageContent,
      maxRetries: 0,
    });

    await executionService.updateExecutionResult({
      id: exec.id,
      status: "skipped",
      actualRunAt: new Date(),
      finishedAt: new Date(),
      errorMessage: `Outdated job version: job had v${job.scheduleVersion}, schedule is v${schedule.version}`,
      errorCode: "outdated_job_version",
    });
    return;
  }

  // ── 3. Status guard (R5) ───────────────────────────────────────────
  if (!isRunnableStatus(schedule.status)) {
    await createSkippedExecution(schedule, "schedule_not_active", {
      reason: `Schedule status is '${schedule.status}', not runnable`,
    });
    return;
  }

  // ── 4. Global guard (R8) ───────────────────────────────────────────
  if (await settingsService.isEmergencyStop()) {
    await createSkippedExecution(schedule, "emergency_stop", {
      reason: "Emergency stop is active",
    });
    return;
  }

  if (!(await settingsService.areSchedulesActive())) {
    await createSkippedExecution(schedule, "schedules_inactive", {
      reason: "Schedules are globally paused",
    });
    return;
  }

  // ── 5. Execute ─────────────────────────────────────────────────────
  const canSend = await settingsService.isSendingEnabled();

  const execution = await executionService.createExecution({
    scheduleId: schedule.id,
    scheduleVersion: schedule.version,
    scheduleJobId: undefined,
    mode: "scheduled",
    plannedRunAt: new Date(),
    targetId: schedule.targetId,
    targetName: schedule.targetName,
    messageContent: schedule.messageContent,
    maxRetries: configurableMaxRetries(),
  });

  if (!canSend) {
    await executionService.updateExecutionResult({
      id: execution.id,
      status: "failed",
      actualRunAt: new Date(),
      finishedAt: new Date(),
      errorMessage: "Global sending is disabled",
      errorCode: "sending_disabled",
    });
    return;
  }

  // ── 5a. Auto-reply dry-run guard (R13) ─────────────────────────
  // Schedules created by AI (create-reminder flow) must respect
  // ZALO_AUTO_REPLY_DRY_RUN. When active, create a dry-run success
  // execution without actually sending to Zalo.
  if (isCreatedByAI(schedule) && getCurrentEffectiveDryRun()) {
    await executionService.updateExecutionResult({
      id: execution.id,
      status: "success",
      mode: "dry_run",
      dryRun: true,
      actualRunAt: new Date(),
      finishedAt: new Date(),
      zaloMessageId: null,
      errorMessage: null,
    });
    console.log(`[worker] dry-run skip (autoReply.dryRun): schedule=${schedule.id} ` +
      `createdBy=ai content="${schedule.messageContent.slice(0, 40)}"`);
    return;
  }

  // ── 6. Resolve thread type ──────────────────────────────────────────
  // DO NOT guess threadType from targetId length.
  // Resolve via: metadata.threadType → DB ZaloThread.type → fail-safe block.
  const threadType = await resolveThreadType(schedule);

  if (threadType === null) {
    await executionService.updateExecutionResult({
      id: execution.id,
      status: "blocked",
      actualRunAt: new Date(),
      finishedAt: new Date(),
      errorMessage: "Cannot determine thread type — metadata.threadType missing and thread not in DB",
      errorCode: "UNKNOWN_THREAD_TYPE",
      zaloMessageId: null,
    });
    console.log(`[worker] blocked: unknown thread type (schedule=${schedule.id} targetId=${schedule.targetId})`);
    return;
  }

  // ── 7. Group outbound gate ──────────────────────────────────────────
  if (threadType === "group") {
    const { getGroupReplyWindow, logGroupGateAudit } = await import("../services/group-safety.service.js");
    const windowExpires = getGroupReplyWindow(schedule.targetId);
    if (windowExpires === 0) {
      await executionService.updateExecutionResult({
        id: execution.id,
        status: "blocked",
        actualRunAt: new Date(),
        finishedAt: new Date(),
        errorMessage: "Group reply window closed — no recent mention",
        errorCode: "GROUP_REPLY_WINDOW_CLOSED",
        zaloMessageId: null,
      });
      logGroupGateAudit({
        threadId: schedule.targetId,
        threadType: "group",
        messageId: null,
        decision: "skip",
        reason: "group_reply_window_closed",
      });
      console.log(`[worker] blocked: group reply window closed (schedule=${schedule.id} targetId=${schedule.targetId})`);
      return;
    }
    // Window open — allow
    logGroupGateAudit({
      threadId: schedule.targetId,
      threadType: "group",
      messageId: null,
      decision: "allow",
      reason: "reply_window_open",
      replyWindowUntil: new Date(windowExpires).toISOString(),
    });
  }

  // ── 8. Send ────────────────────────────────────────────────────────
  const { dryRun: effectiveDryRun, source: dryRunSource } = getEffectiveDryRunInfo();

  let result: { success: boolean; messageId?: string; error?: string; errorCode?: string };
  if (deps?.sender) {
    // Test path: use injected sender directly
    result = await deps.sender.sendMessage(
      schedule.messageContent,
      schedule.targetId,
      threadType,
    );
  } else {
    // Production path: via backend internal API
    if (!deps?.sender) {
      console.log(`[worker] runtime dryRun decision dryRun=${effectiveDryRun} source=${dryRunSource} jobType=schedule threadId=${schedule.targetId}`);
    }
    const backendResult = await sendOutboundViaBackend({
      threadId: schedule.targetId,
      threadType,
      content: schedule.messageContent,
      source: "schedule",
      metadata: { scheduleId: schedule.id, createdBy: schedule.createdBy },
    });
    result = {
      success: backendResult.success,
      messageId: backendResult.messageId,
      error: backendResult.error,
      errorCode: backendResult.error,
    };
  }

  if (result.success) {
    await executionService.updateExecutionResult({
      id: execution.id,
      status: "success",
      actualRunAt: new Date(),
      finishedAt: new Date(),
      zaloMessageId: result.messageId ?? null,
    });
  } else {
    // Retry logic — treat all failures as final for now
    // Phase 3 retry: one attempt, mark failed if not successful
    await executionService.updateExecutionResult({
      id: execution.id,
      status: "failed",
      actualRunAt: new Date(),
      finishedAt: new Date(),
      errorMessage: result.error ?? null,
      errorCode: result.errorCode ?? null,
      retryCount: 0,
    });
  }
}

// =============================================================================
// Dry-run execution (R9)
// =============================================================================

export async function executeDryRun(
  scheduleId: string,
  deps?: { sender?: import("../services/message-sender.js").MessageSender },
): Promise<{ executionId: string; wouldSend: boolean; reason?: string }> {
  const schedule = await scheduleService.getScheduleById(scheduleId);
  if (!schedule) {
    return { executionId: "", wouldSend: false, reason: "Schedule not found" };
  }

  // Run all guards
  if (!isRunnableStatus(schedule.status)) {
    const exec = await executionService.createExecution({
      scheduleId: schedule.id,
      scheduleVersion: schedule.version,
      mode: "dry_run",
      plannedRunAt: new Date(),
      targetId: schedule.targetId,
      targetName: schedule.targetName,
      messageContent: schedule.messageContent,
      dryRun: true,
    });
    await executionService.updateExecutionResult({
      id: exec.id,
      status: "skipped",
      actualRunAt: new Date(),
      finishedAt: new Date(),
      errorMessage: `Schedule status is '${schedule.status}'`,
      errorCode: "schedule_not_active",
      metadata: JSON.stringify({
        wouldSend: false,
        reason: `Schedule status is '${schedule.status}'`,
      }),
    });
    return {
      executionId: exec.id,
      wouldSend: false,
      reason: `Schedule status is '${schedule.status}'`,
    };
  }

  if (await settingsService.isEmergencyStop()) {
    const exec = await executionService.createExecution({
      scheduleId: schedule.id,
      scheduleVersion: schedule.version,
      mode: "dry_run",
      plannedRunAt: new Date(),
      targetId: schedule.targetId,
      targetName: schedule.targetName,
      messageContent: schedule.messageContent,
      dryRun: true,
    });
    await executionService.updateExecutionResult({
      id: exec.id,
      status: "skipped",
      actualRunAt: new Date(),
      finishedAt: new Date(),
      errorMessage: "Emergency stop active",
      errorCode: "emergency_stop",
      metadata: JSON.stringify({ wouldSend: false, reason: "Emergency stop active" }),
    });
    return { executionId: exec.id, wouldSend: false, reason: "Emergency stop active" };
  }

  const canSend = await settingsService.isSendingEnabled();

  // Create dry-run execution — do NOT actually send
  const execution = await executionService.createExecution({
    scheduleId: schedule.id,
    scheduleVersion: schedule.version,
    mode: "dry_run",
    plannedRunAt: new Date(),
    targetId: schedule.targetId,
    targetName: schedule.targetName,
    messageContent: schedule.messageContent,
    dryRun: true,
  });

  await executionService.updateExecutionResult({
    id: execution.id,
    status: canSend ? "success" : "failed",
    actualRunAt: new Date(),
    finishedAt: new Date(),
    errorMessage: canSend ? undefined : "Global sending is disabled",
    errorCode: canSend ? undefined : "sending_disabled",
    metadata: JSON.stringify({
      wouldSend: canSend,
      messageContent: schedule.messageContent,
      targetId: schedule.targetId,
      targetName: schedule.targetName,
      reason: canSend ? "Would send successfully" : "Global sending disabled",
    }),
  });

  return {
    executionId: execution.id,
    wouldSend: canSend,
    reason: canSend ? "Would send successfully" : "Global sending disabled",
  };
}

// =============================================================================
// Run-now execution (R10)
// =============================================================================

export async function executeRunNow(
  scheduleId: string,
  deps?: { sender?: import("../services/message-sender.js").MessageSender },
): Promise<{ executionId: string; success: boolean; error?: string }> {
  const schedule = await scheduleService.getScheduleById(scheduleId);
  if (!schedule) {
    return { executionId: "", success: false, error: "Schedule not found" };
  }

  // Global guard still applies
  if (await settingsService.isEmergencyStop()) {
    return { executionId: "", success: false, error: "Emergency stop active" };
  }

  if (!(await settingsService.isSendingEnabled())) {
    return { executionId: "", success: false, error: "Global sending disabled" };
  }

  // Create execution
  const execution = await executionService.createExecution({
    scheduleId: schedule.id,
    scheduleVersion: schedule.version,
    mode: "run_now",
    plannedRunAt: new Date(),
    targetId: schedule.targetId,
    targetName: schedule.targetName,
    messageContent: schedule.messageContent,
    maxRetries: configurableMaxRetries(),
  });

  // ── AI auto-reply dry-run guard (R13) ─────────────────────────
  // Schedules created by AI (create-reminder flow) must respect
  // ZALO_AUTO_REPLY_DRY_RUN. When active, create a dry-run success
  // execution without actually sending to Zalo.
  if (isCreatedByAI(schedule) && getCurrentEffectiveDryRun()) {
    await executionService.updateExecutionResult({
      id: execution.id,
      status: "success",
      mode: "dry_run",
      dryRun: true,
      actualRunAt: new Date(),
      finishedAt: new Date(),
      zaloMessageId: null,
      errorMessage: null,
    });
    console.log(`[worker] dry-run skip (autoReply.dryRun): schedule=${schedule.id} ` +
      `createdBy=ai content="${schedule.messageContent.slice(0, 40)}"`);
    return { executionId: execution.id, success: true };
  }

  // ── Resolve thread type ──────────────────────────────────────
  // DO NOT guess threadType from targetId length.
  // Resolve via: metadata.threadType → DB ZaloThread.type → fail-safe block.
  const threadType = await resolveThreadType(schedule);

  if (threadType === null) {
    await executionService.updateExecutionResult({
      id: execution.id,
      status: "blocked",
      actualRunAt: new Date(),
      finishedAt: new Date(),
      errorMessage: "Cannot determine thread type — metadata.threadType missing and thread not in DB",
      errorCode: "UNKNOWN_THREAD_TYPE",
      zaloMessageId: null,
    });
    return { executionId: execution.id, success: false, error: "Cannot determine thread type" };
  }

  // Send immediately — evaluate runtime config at send time
  let result: { success: boolean; messageId?: string; error?: string; errorCode?: string };
  if (deps?.sender) {
    // Test path
    result = await deps.sender.sendMessage(schedule.messageContent, schedule.targetId, threadType);
  } else {
    // Production path: via backend internal API
    const { dryRun: effectiveDryRun, source: dryRunSource } = getEffectiveDryRunInfo();
    console.log(`[worker] runtime dryRun decision dryRun=${effectiveDryRun} source=${dryRunSource} jobType=runNow threadId=${schedule.targetId}`);
    const backendResult = await sendOutboundViaBackend({
      threadId: schedule.targetId,
      threadType,
      content: schedule.messageContent,
      source: "schedule",
      metadata: { scheduleId: schedule.id, createdBy: schedule.createdBy, runNow: true },
    });
    result = {
      success: backendResult.success,
      messageId: backendResult.messageId,
      error: backendResult.error,
      errorCode: backendResult.error,
    };
  }

  if (result.success) {
    await executionService.updateExecutionResult({
      id: execution.id,
      status: "success",
      actualRunAt: new Date(),
      finishedAt: new Date(),
      zaloMessageId: result.messageId ?? null,
    });
    return { executionId: execution.id, success: true };
  } else {
    await executionService.updateExecutionResult({
      id: execution.id,
      status: "failed",
      actualRunAt: new Date(),
      finishedAt: new Date(),
      errorMessage: result.error,
      errorCode: result.errorCode,
    });
    return { executionId: execution.id, success: false, error: result.error };
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Resolve threadType for a schedule target.
 * Priority: metadata.threadType → DB ZaloThread.type → null (fail-safe).
 * NEVER guess from targetId length/format.
 */
async function resolveThreadType(schedule: {
  targetId: string;
  metadata?: string | null;
}): Promise<"user" | "group" | null> {
  // 1. metadata.threadType
  if (schedule.metadata) {
    try {
      const md = JSON.parse(schedule.metadata);
      if (md.threadType === "user" || md.threadType === "group") {
        return md.threadType;
      }
    } catch { /* metadata not valid JSON — ignore */ }
  }

  // 2. DB lookup
  try {
    const thread = await prisma.zaloThread.findUnique({
      where: { id: schedule.targetId },
      select: { type: true },
    });
    if (thread) {
      return thread.type as "user" | "group";
    }
  } catch { /* DB unavailable — fall through */ }

  // 3. Unknown — fail-safe: block execution
  return null;
}

function isRunnableStatus(status: string): boolean {
  return status === "scheduled" || status === "active";
}

function configurableMaxRetries(): number {
  const fromEnv = parseInt(process.env.MAX_RETRY_ATTEMPTS ?? "3", 10);
  return isNaN(fromEnv) ? 3 : fromEnv;
}

function computeRetryAt(retryCount: number): Date {
  const baseMs = parseInt(process.env.RETRY_BASE_DELAY_MS ?? "1000", 10);
  const delayMs = Math.min(baseMs * Math.pow(2, retryCount - 1), 60_000);
  return new Date(Date.now() + delayMs);
}

async function createSkippedExecution(
  schedule: {
    id: string;
    version: number;
    targetId: string;
    targetName: string | null;
    messageContent: string;
  },
  errorCode: string,
  metadata: Record<string, unknown>,
) {
  const exec = await executionService.createExecution({
    scheduleId: schedule.id,
    scheduleVersion: schedule.version,
    mode: "scheduled",
    plannedRunAt: new Date(),
    targetId: schedule.targetId,
    targetName: schedule.targetName,
    messageContent: schedule.messageContent,
    maxRetries: 0,
  });
  await executionService.updateExecutionResult({
    id: exec.id,
    status: "skipped",
    actualRunAt: new Date(),
    finishedAt: new Date(),
    errorCode,
    metadata: JSON.stringify(metadata),
  });
}
