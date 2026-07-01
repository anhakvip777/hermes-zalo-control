// =============================================================================
// Live Test Service — controlled live Zalo send with quota + TTL
// =============================================================================

import { prisma } from "../db.js";
import { getProductionReadiness } from "./production-readiness.service.js";
import { getCurrentEffectiveDryRun } from "./runtime-config.service.js";
import { config } from "../config.js";
import { normalizeThreadId } from "./thread-id.js";
import type { LiveTestSession } from "@prisma/client";

// ── Types ────────────────────────────────────────────────────────────

export interface StartLiveTestInput {
  threadId: string;
  maxMessages: number;
  ttlSeconds: number;
  confirmText: string;
  reason: string;
  createdBy?: string;
}

export interface StartLiveTestResult {
  success: boolean;
  sessionId?: string;
  error?: string;
  errorCode?: string;
  expiresAt?: string;
}

export interface LiveTestStatusResult {
  active: boolean;
  session: {
    id: string;
    threadId: string;
    maxMessages: number;
    sentCount: number;
    ttlSeconds: number;
    expiresAt: string;
    status: string;
    reason: string | null;
    createdBy: string | null;
    createdAt: string;
    remainingMs: number;
  } | null;
  dryRun: boolean;
}

export interface StopLiveTestResult {
  success: boolean;
  error?: string;
}

// ── Constants ─────────────────────────────────────────────────────────

const CONFIRM_TEXT = "START LIVE TEST";
const MIN_REASON_LENGTH = 10;
const MAX_MAX_MESSAGES = 3;
const MAX_TTL_SECONDS = 3600;

// ── Start live test ───────────────────────────────────────────────────

export async function startLiveTest(input: StartLiveTestInput): Promise<StartLiveTestResult> {
  const threadId = normalizeThreadId(input.threadId);
  const { maxMessages, ttlSeconds, confirmText, reason, createdBy } = input;

  // Guard: confirm text
  if (confirmText !== CONFIRM_TEXT) {
    return { success: false, error: "Confirm text must be exactly 'START LIVE TEST'", errorCode: "BAD_CONFIRM" };
  }

  // Guard: reason length
  if (!reason || reason.length < MIN_REASON_LENGTH) {
    return { success: false, error: `Reason must be at least ${MIN_REASON_LENGTH} characters`, errorCode: "REASON_TOO_SHORT" };
  }

  // Guard: maxMessages
  if (maxMessages < 1 || maxMessages > MAX_MAX_MESSAGES) {
    return { success: false, error: `maxMessages must be 1-${MAX_MAX_MESSAGES}`, errorCode: "INVALID_MAX_MESSAGES" };
  }

  // Guard: ttlSeconds
  if (ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
    return { success: false, error: `ttlSeconds must be 1-${MAX_TTL_SECONDS}`, errorCode: "INVALID_TTL" };
  }

  // Guard: must be in dry-run mode
  if (!getCurrentEffectiveDryRun()) {
    return { success: false, error: "Already in live mode (global dryRun=false). Live test not needed.", errorCode: "ALREADY_LIVE" };
  }

  // Guard: production readiness
  try {
    const readiness = await getProductionReadiness();
    if (readiness.verdict === "NOT_READY") {
      return { success: false, error: `Production readiness: NOT_READY. Fix ${readiness.summary.criticalFail + readiness.summary.highFail} critical/high issues first.`, errorCode: "NOT_READY" };
    }
  } catch {
    return { success: false, error: "Could not check production readiness", errorCode: "READINESS_CHECK_FAILED" };
  }

  // Guard: threadId must be in allowedThreads
  const { getAllRuntimeSettings } = await import("./runtime-config.service.js");
  const settingsArr = await getAllRuntimeSettings();
  const allowedSetting = settingsArr.find((s: any) => s.key === "autoReply.allowedThreads");
  const allowedThreads: string[] = allowedSetting?.value
    ? (() => { try { const v = JSON.parse(allowedSetting.value); return Array.isArray(v) ? v : []; } catch { return []; } })()
    : config.autoReply.allowedThreads;

  if (allowedThreads.length > 0 && !allowedThreads.includes(threadId)) {
    return { success: false, error: `Thread ${threadId} is not in allowedThreads`, errorCode: "THREAD_NOT_ALLOWED" };
  }

  // Guard: thread must be DM (user type) — check DB
  try {
    const thread = await prisma.zaloThread.findUnique({ where: { id: threadId } });
    if (thread && thread.type === "group") {
      return { success: false, error: "Live test is only allowed for DM threads, not groups", errorCode: "GROUP_NOT_ALLOWED" };
    }
  } catch { /* if no ZaloThread record, check messages */ }

  // Check if thread has group messages
  try {
    const groupMsg = await prisma.message.findFirst({ where: { threadId, threadType: "group" } });
    if (groupMsg) {
      return { success: false, error: "Thread appears to be a group. Live test only for DM threads.", errorCode: "GROUP_NOT_ALLOWED" };
    }
  } catch { /* fall through */ }

  // Guard: no existing active session for this thread
  const existing = await prisma.liveTestSession.findFirst({
    where: { threadId, status: "active" },
  });
  if (existing) {
    return { success: false, error: `Active live test session already exists for thread ${threadId} (${existing.id}). Stop it first.`, errorCode: "SESSION_EXISTS" };
  }

  // Create session
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  const session = await prisma.liveTestSession.create({
    data: {
      threadId,
      maxMessages,
      sentCount: 0,
      ttlSeconds,
      expiresAt,
      status: "active",
      createdBy: createdBy ?? "admin",
      reason,
    },
  });

  // Audit
  await prisma.auditLog.create({
    data: {
      action: "live_test_started",
      entityType: "LiveTestSession",
      entityId: session.id,
      actor: createdBy ?? "admin",
      details: JSON.stringify({ threadId, maxMessages, ttlSeconds, reason }),
    },
  });

  return {
    success: true,
    sessionId: session.id,
    expiresAt: expiresAt.toISOString(),
  };
}

// ── Stop live test ────────────────────────────────────────────────────

export async function stopLiveTest(createdBy?: string): Promise<StopLiveTestResult> {
  // Find and cancel all active sessions
  const sessions = await prisma.liveTestSession.findMany({
    where: { status: "active" },
  });

  if (sessions.length === 0) {
    return { success: false, error: "No active live test session found" };
  }

  const now = new Date();
  for (const s of sessions) {
    await prisma.liveTestSession.update({
      where: { id: s.id },
      data: { status: "cancelled", completedAt: now },
    });

    await prisma.auditLog.create({
      data: {
        action: "live_test_cancelled",
        entityType: "LiveTestSession",
        entityId: s.id,
        actor: createdBy ?? "admin",
        details: JSON.stringify({ threadId: s.threadId, sentCount: s.sentCount }),
      },
    });
  }

  return { success: true };
}

// ── Get status ────────────────────────────────────────────────────────

export async function getLiveTestStatus(): Promise<LiveTestStatusResult> {
  const session = await prisma.liveTestSession.findFirst({
    where: { status: "active" },
    orderBy: { createdAt: "desc" },
  });

  // Auto-expire if TTL passed
  if (session && new Date() > session.expiresAt) {
    await prisma.liveTestSession.update({
      where: { id: session.id },
      data: { status: "expired", completedAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        action: "live_test_expired",
        entityType: "LiveTestSession",
        entityId: session.id,
        actor: "system",
        details: JSON.stringify({ threadId: session.threadId, sentCount: session.sentCount }),
      },
    });

    return { active: false, session: null, dryRun: getCurrentEffectiveDryRun() };
  }

  if (session) {
    const remainingMs = Math.max(0, session.expiresAt.getTime() - Date.now());
    return {
      active: true,
      session: {
        id: session.id,
        threadId: session.threadId,
        maxMessages: session.maxMessages,
        sentCount: session.sentCount,
        ttlSeconds: session.ttlSeconds,
        expiresAt: session.expiresAt.toISOString(),
        status: session.status,
        reason: session.reason,
        createdBy: session.createdBy,
        createdAt: session.createdAt.toISOString(),
        remainingMs,
      },
      dryRun: getCurrentEffectiveDryRun(),
    };
  }

  return { active: false, session: null, dryRun: getCurrentEffectiveDryRun() };
}

// ── Should send live for thread? ──────────────────────────────────────

/**
 * Check if a message to this thread should be sent live (bypass dry-run).
 *
 * Logic:
 * 1. If global dryRun=false → live everywhere (Safety Mode handles this)
 * 2. Else if active liveTestSession for this thread with quota remaining → live
 * 3. Else → dryRun
 */
export async function shouldSendLiveForThread(threadId: string): Promise<{
  live: boolean;
  sessionId?: string;
  reason?: string;
}> {
  const tid = normalizeThreadId(threadId);
  const globalDryRun = getCurrentEffectiveDryRun();

  // Safety Mode: global live
  if (!globalDryRun) {
    return { live: true, reason: "global_live" };
  }

  // Check for active live test session
  const session = await prisma.liveTestSession.findFirst({
    where: { threadId: tid, status: "active" },
  });

  if (!session) {
    return { live: false, reason: "dry_run" };
  }

  // Auto-expire if TTL passed
  if (new Date() > session.expiresAt) {
    await prisma.liveTestSession.update({
      where: { id: session.id },
      data: { status: "expired", completedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: {
        action: "live_test_expired",
        entityType: "LiveTestSession",
        entityId: session.id,
        actor: "system",
        details: JSON.stringify({ threadId, sentCount: session.sentCount }),
      },
    }).catch(() => {});
    return { live: false, reason: "live_test_expired" };
  }

  // Quota check
  if (session.sentCount >= session.maxMessages) {
    // Complete the session (quota exhausted)
    await prisma.liveTestSession.update({
      where: { id: session.id },
      data: { status: "completed", completedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: {
        action: "live_test_completed",
        entityType: "LiveTestSession",
        entityId: session.id,
        actor: "system",
        details: JSON.stringify({ threadId, sentCount: session.sentCount, maxMessages: session.maxMessages }),
      },
    }).catch(() => {});
    return { live: false, reason: "live_test_quota_exhausted" };
  }

  return { live: true, sessionId: session.id, reason: "live_test" };
}

/**
 * Record a live test message sent. Call AFTER successful Zalo send.
 */
export async function recordLiveTestSent(sessionId: string, threadId: string, messageId: string): Promise<void> {
  try {
    // Increment sentCount
    const session = await prisma.liveTestSession.update({
      where: { id: sessionId },
      data: { sentCount: { increment: 1 } },
    });

    // Audit
    await prisma.auditLog.create({
      data: {
        action: "live_test_message_sent",
        entityType: "LiveTestSession",
        entityId: sessionId,
        actor: "system",
        details: JSON.stringify({ threadId, messageId, sentCount: session.sentCount }),
      },
    });

    // Auto-complete if quota exhausted
    if (session.sentCount >= session.maxMessages) {
      await prisma.liveTestSession.update({
        where: { id: sessionId },
        data: { status: "completed", completedAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          action: "live_test_completed",
          entityType: "LiveTestSession",
          entityId: sessionId,
          actor: "system",
          details: JSON.stringify({ threadId, sentCount: session.sentCount, maxMessages: session.maxMessages }),
        },
      }).catch(() => {});
    }
  } catch {
    // Non-fatal: don't crash the send if audit fails
  }
}

/**
 * Clean up expired sessions (for periodic cleanup).
 */
export async function cleanupExpiredSessions(): Promise<number> {
  try {
    const result = await prisma.liveTestSession.updateMany({
      where: {
        status: "active",
        expiresAt: { lt: new Date() },
      },
      data: {
        status: "expired",
        completedAt: new Date(),
      },
    });
    return result.count;
  } catch {
    return 0;
  }
}
