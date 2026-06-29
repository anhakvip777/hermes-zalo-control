// =============================================================================
// Cooldown Service (R5) — Unified per-thread cooldown backed by ThreadCooldown DB
//
// Replaces:
//   - incoming-dispatcher.service.ts: lastReplyAt Map (line 27) + 4 functions
//   - outbound-dispatcher.service.ts: lastReplyAt Map (line 97) + 3 functions
//
// Design decision (Option A): dispatcher is sole cooldown authority.
// safetyCheck() no longer checks cooldown — cooldown is enforced only in
// sendOutbound(). This is a trade-off: cooldown-blocked messages still reach
// Hermes for processing, but the architecture is clean with a single
// decision point and no dual-policy risk. The 10s cooldown window makes the
// compute waste acceptable.
// =============================================================================

import { prisma } from "../db.js";
import { getEffectiveCooldownSeconds } from "./runtime-config.service.js";

// ── Core operations ──────────────────────────────────────────────────

/**
 * Atomically acquire cooldown for a thread.
 *
 * Uses a Prisma transaction (SELECT → UPSERT) to guarantee correctness
 * across all three cases:
 *
 *   No row            → creates row → returns true  (acquired)
 *   Expired row       → updates row → returns true  (re-acquired)
 *   Active row        → returns false                (blocked)
 *
 * Returns true if the cooldown was acquired (thread is NOT currently in
 * cooldown). Returns false if the thread IS in an active cooldown.
 */
export async function acquireCooldown(threadId: string): Promise<boolean> {
  const now = new Date();
  const cooldownMs = getEffectiveCooldownSeconds() * 1000;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.threadCooldown.findUnique({
      where: { threadId },
    });

    if (!existing || existing.expiresAt < now) {
      // No row or expired — acquire (upsert)
      await tx.threadCooldown.upsert({
        where: { threadId },
        create: {
          threadId,
          lastReplyAt: now,
          expiresAt: new Date(now.getTime() + cooldownMs),
        },
        update: {
          lastReplyAt: now,
          expiresAt: new Date(now.getTime() + cooldownMs),
        },
      });
      return true;
    }

    // Active cooldown — reject
    return false;
  });
}

/**
 * Check if a thread is currently in cooldown (read-only).
 * Used for health reporting / status display.
 */
export async function isInCooldown(threadId: string): Promise<boolean> {
  const now = new Date();
  const row = await prisma.threadCooldown.findUnique({
    where: { threadId },
  });
  if (!row) return false;
  return row.expiresAt >= now;
}

/**
 * Refresh cooldown after a successful outbound send.
 * Called by sendOutbound() after message delivery.
 */
export async function setCooldown(threadId: string): Promise<void> {
  const now = new Date();
  const cooldownMs = getEffectiveCooldownSeconds() * 1000;

  await prisma.threadCooldown.upsert({
    where: { threadId },
    create: {
      threadId,
      lastReplyAt: now,
      expiresAt: new Date(now.getTime() + cooldownMs),
    },
    update: {
      lastReplyAt: now,
      expiresAt: new Date(now.getTime() + cooldownMs),
    },
  });
}

// ── Reset / management ───────────────────────────────────────────────

/**
 * Clear cooldown for a specific thread.
 */
export async function clearCooldown(threadId: string): Promise<void> {
  await prisma.threadCooldown.deleteMany({ where: { threadId } });
}

/**
 * Clear all cooldowns. Replaces resetAutoReplyCooldowns() + resetOutboundCooldowns().
 */
export async function clearAllCooldowns(): Promise<void> {
  await prisma.threadCooldown.deleteMany();
}

/**
 * Get all active (unexpired) cooldowns for health reporting.
 */
export async function getActiveCooldowns(): Promise<
  Array<{ threadId: string; lastReplyAt: Date; expiresAt: Date }>
> {
  const now = new Date();
  const rows = await prisma.threadCooldown.findMany({
    where: { expiresAt: { gte: now } },
    orderBy: { lastReplyAt: "desc" },
  });
  return rows.map((r) => ({
    threadId: r.threadId,
    lastReplyAt: r.lastReplyAt,
    expiresAt: r.expiresAt,
  }));
}

// ── Periodic cleanup (optional — call from worker or on-access) ──────

/**
 * Remove expired cooldown rows. Call periodically to keep the table small.
 */
export async function pruneExpiredCooldowns(): Promise<number> {
  const now = new Date();
  const result = await prisma.threadCooldown.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return result.count;
}
