// =============================================================================
// Unsupported System Claim Guard (shared)
// =============================================================================
// Extracted so BOTH the incoming dispatcher (text-only path) and the AgentBridge
// (structured path) use the SAME claim patterns + evidence check — no duplication.
//
// A "claim" = the bot says it did/will do a system action ("đã gửi", "đã tạo
// lịch", "sẽ nhắc", ...). Such a claim is only allowed when backed by real
// evidence (a successful schedule execution / recently created schedule, or a
// successful tool write/outbound this turn).
// =============================================================================

import { prisma } from "../db.js";

/** Keywords that signal a fabricated system claim when no evidence exists. */
export const UNSUPPORTED_CLAIM_PATTERNS: RegExp[] = [
  // Past-tense fabricated system claims
  /đã gửi/i,
  /đã nhắc/i,
  /đã đặt lịch/i,
  /bị lỗi gửi/i,
  /không gửi được/i,
  /lỗi hệ thống nhắc/i,
  /đã lên lịch/i,
  /đã thực hiện/i,
  // Future-tense schedule creation claims (bot claims it will do something)
  /đã ghi nhận/i,
  /sẽ nhắc/i,
  /sẽ gửi/i,
  /đã tạo lịch/i,
  /sẽ báo/i,
];

/** True if the reply text contains an unsupported system-claim phrase. */
export function hasUnsupportedSystemClaim(reply: string): boolean {
  return UNSUPPORTED_CLAIM_PATTERNS.some((p) => p.test(reply));
}

/**
 * Check if there is real DB evidence that a system action occurred for this thread.
 * DB unavailable → false (safe default: block the claim).
 */
export async function hasScheduleEvidence(threadId: string): Promise<boolean> {
  try {
    const recentExec = await prisma.scheduleExecution.findFirst({
      where: {
        targetId: threadId,
        status: "success",
        actualRunAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) },
      },
      select: { id: true },
    });
    if (recentExec) return true;

    const recentSchedule = await prisma.schedule.findFirst({
      where: {
        targetId: threadId,
        createdAt: { gte: new Date(Date.now() - 60_000) }, // last 60 seconds
      },
      select: { id: true },
    });
    if (recentSchedule) return true;

    return false;
  } catch {
    return false;
  }
}
