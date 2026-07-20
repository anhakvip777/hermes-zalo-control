// =============================================================================
// Live Test Service — controlled live Zalo send with quota + TTL
// =============================================================================

import { prisma } from "../db.js";
import {
  getProductionReadiness,
  REQUIRED_READINESS_CHECK_IDS,
} from "./production-readiness.service.js";
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

async function expireActiveSessions(): Promise<number> {
  const now = new Date();
  const result = await prisma.liveTestSession.updateMany({
    where: {
      status: "active",
      expiresAt: { lt: now },
    },
    data: {
      status: "expired",
      completedAt: now,
    },
  });
  return result.count;
}

let liveTestStartTail: Promise<void> = Promise.resolve();

async function withLiveTestStartLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = liveTestStartTail;
  let release = () => {};
  liveTestStartTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

// ── Start live test ───────────────────────────────────────────────────

export async function startLiveTest(input: StartLiveTestInput): Promise<StartLiveTestResult> {
  const { maxMessages, ttlSeconds, confirmText, createdBy } = input;

  if (typeof input.threadId !== "string" || input.threadId.trim().length === 0) {
    return { success: false, error: "threadId must be a non-empty string", errorCode: "INVALID_THREAD_ID" };
  }
  const threadId = normalizeThreadId(input.threadId);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";

  // Guard: confirm text
  if (confirmText !== CONFIRM_TEXT) {
    return { success: false, error: "Confirm text must be exactly 'START LIVE TEST'", errorCode: "BAD_CONFIRM" };
  }

  // Guard: reason length
  if (reason.length < MIN_REASON_LENGTH) {
    return { success: false, error: `Reason must be at least ${MIN_REASON_LENGTH} characters`, errorCode: "REASON_TOO_SHORT" };
  }

  // Guard: maxMessages
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 1 || maxMessages > MAX_MAX_MESSAGES) {
    return { success: false, error: `maxMessages must be 1-${MAX_MAX_MESSAGES}`, errorCode: "INVALID_MAX_MESSAGES" };
  }

  // Guard: ttlSeconds
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
    return { success: false, error: `ttlSeconds must be 1-${MAX_TTL_SECONDS}`, errorCode: "INVALID_TTL" };
  }

  // Guard: must be in dry-run mode
  if (!getCurrentEffectiveDryRun()) {
    return { success: false, error: "Already in live mode (global dryRun=false). Live test not needed.", errorCode: "ALREADY_LIVE" };
  }

  // Guard: production readiness must be complete and explicitly ready.
  try {
    const readiness = await getProductionReadiness();
    const summary = readiness.summary;
    const checkIds = Array.isArray(readiness.checks) ? readiness.checks.map((check) => check.id) : [];
    const expectedIds = new Set<string>(REQUIRED_READINESS_CHECK_IDS);
    const actualIds = new Set(checkIds);
    const checksValid = Array.isArray(readiness.checks) &&
      checkIds.length === REQUIRED_READINESS_CHECK_IDS.length &&
      actualIds.size === checkIds.length &&
      REQUIRED_READINESS_CHECK_IDS.every((id) => actualIds.has(id)) &&
      readiness.checks.every((check) => expectedIds.has(check.id) && ["pass", "warn", "fail", "unknown"].includes(check.status));
    const derivedSummary = checksValid ? {
      pass: readiness.checks.filter((check) => check.status === "pass").length,
      warn: readiness.checks.filter((check) => check.status === "warn").length,
      fail: readiness.checks.filter((check) => check.status === "fail").length,
      unknown: readiness.checks.filter((check) => check.status === "unknown").length,
      criticalFail: readiness.checks.filter((check) =>
        (check.status === "fail" || check.status === "unknown") && check.severity === "critical"
      ).length,
      highFail: readiness.checks.filter((check) =>
        (check.status === "fail" || check.status === "unknown") && check.severity === "high"
      ).length,
    } : null;
    const summaryValid = Boolean(summary && derivedSummary) &&
      summary.pass === derivedSummary?.pass &&
      summary.warn === derivedSummary.warn &&
      summary.fail === derivedSummary.fail &&
      summary.unknown === derivedSummary.unknown &&
      summary.criticalFail === derivedSummary.criticalFail &&
      summary.highFail === derivedSummary.highFail;
    const ready = readiness.verdict === "READY_FOR_LIVE" &&
      readiness.dataQuality === "complete" &&
      readiness.score !== null &&
      summaryValid &&
      summary.unknown === 0 &&
      summary.fail === 0 &&
      checksValid;
    if (!ready) {
      return { success: false, error: "Production readiness is incomplete or not explicitly READY_FOR_LIVE", errorCode: "NOT_READY" };
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

  if (allowedThreads.length === 0 || !allowedThreads.includes(threadId)) {
    return { success: false, error: `Thread ${threadId} is not in allowedThreads`, errorCode: "THREAD_NOT_ALLOWED" };
  }

  // Guard: live tests require explicit, non-conflicting DM evidence.
  try {
    const [thread, messageTypes] = await Promise.all([
      prisma.zaloThread.findUnique({
        where: { id: threadId },
        select: { type: true },
      }),
      prisma.message.findMany({
        where: { threadId },
        distinct: ["threadType"],
        select: { threadType: true },
      }),
    ]);
    const knownTypes = new Set(messageTypes.map((message) => message.threadType));

    if (!thread) {
      return { success: false, error: "Live test requires a verified ZaloThread record", errorCode: "THREAD_UNVERIFIED" };
    }
    if (thread.type !== "user" && thread.type !== "group") {
      return { success: false, error: "Thread type evidence is invalid", errorCode: "THREAD_UNVERIFIED" };
    }
    if (thread.type === "group" || knownTypes.has("group")) {
      return { success: false, error: "Live test is only allowed for verified DM threads", errorCode: "GROUP_NOT_ALLOWED" };
    }
    if ([...knownTypes].some((type) => type !== "user" && type !== "group")) {
      return { success: false, error: "Thread message evidence contains an unknown type", errorCode: "THREAD_UNVERIFIED" };
    }
    if (knownTypes.size > 0 && (!knownTypes.has("user") || knownTypes.size !== 1)) {
      return { success: false, error: "Thread type evidence conflicts", errorCode: "THREAD_TYPE_CONFLICT" };
    }
  } catch {
    return { success: false, error: "Could not verify thread type evidence", errorCode: "THREAD_VERIFICATION_FAILED" };
  }

  return withLiveTestStartLock(async () => {
    try {
      await expireActiveSessions();
    } catch {
      return { success: false, error: "Could not persist expired live test session cleanup", errorCode: "SESSION_CLEANUP_FAILED" };
    }

    // System-wide invariant: at most one controlled live-test session is active.
    const existing = await prisma.liveTestSession.findFirst({
      where: { status: "active" },
    });
    if (existing) {
      return {
        success: false,
        error: `Active live test session already exists for thread ${existing.threadId} (${existing.id}). Stop it first.`,
        errorCode: "SESSION_EXISTS",
      };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.liveTestSession.create({
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

      await tx.auditLog.create({
        data: {
          action: "live_test_started",
          entityType: "LiveTestSession",
          entityId: created.id,
          actor: createdBy ?? "admin",
          details: JSON.stringify({ threadId, maxMessages, ttlSeconds, reason }),
        },
      });

      return created;
    });

    return {
      success: true,
      sessionId: session.id,
      expiresAt: expiresAt.toISOString(),
    };
  });
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

  // Status reads are observational. Expiry persistence remains in the
  // outbound decision/cleanup paths, not in dashboard polling.
  if (session && new Date() > session.expiresAt) {
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
 * 1. If global dryRun=false → fail closed (global live is unsupported)
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

  // Global live is unsupported. A false dryRun value must fail closed rather
  // than creating an unscoped bypass; LiveTestSession is the only live path.
  if (!globalDryRun) {
    return { live: false, reason: "global_live_disabled" };
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
    return await expireActiveSessions();
  } catch {
    return 0;
  }
}
