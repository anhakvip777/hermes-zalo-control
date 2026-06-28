// =============================================================================
// Group Safety Service — reply window TTL + mention gate helpers
// =============================================================================

import { config } from "../config.js";
import type { ThreadSettingData } from "./thread-settings.service.js";

// ── In-memory group reply window ─────────────────────────────────
// threadId → expiresAt (ms timestamp)
const groupReplyWindows = new Map<string, number>();

/**
 * Get the reply window expiry for a group thread.
 * Returns the window expiry timestamp (ms) or 0 if closed.
 */
export function getGroupReplyWindow(threadId: string): number {
  const expiresAt = groupReplyWindows.get(threadId);
  if (!expiresAt) return 0;
  if (Date.now() > expiresAt) {
    groupReplyWindows.delete(threadId);
    return 0;
  }
  return expiresAt;
}

/**
 * Open/refresh a reply window for a group thread after a mention.
 * Uses the thread's configured groupReplyWindowSeconds, or env fallback.
 */
export function touchGroupReplyWindow(
  threadId: string,
  settings: ThreadSettingData,
): void {
  const ttl =
    settings.groupReplyWindowSeconds > 0
      ? settings.groupReplyWindowSeconds
      : config.autoReply.groupReplyWindowSeconds;
  groupReplyWindows.set(threadId, Date.now() + ttl * 1000);
  // Prune stale windows (> 1 hour past expiry)
  const cutoff = Date.now() - 3600_000;
  for (const [k, v] of groupReplyWindows) {
    if (v < cutoff) groupReplyWindows.delete(k);
  }
}

/**
 * Close the reply window for a thread immediately.
 */
export function closeGroupReplyWindow(threadId: string): void {
  groupReplyWindows.delete(threadId);
}

/**
 * Reset all reply windows (for tests).
 */
export function resetGroupReplyWindows(): void {
  groupReplyWindows.clear();
}

/**
 * Get all active reply windows (for status endpoint).
 */
export function getActiveReplyWindows(): Array<{
  threadId: string;
  expiresAt: number;
  remainingSeconds: number;
}> {
  const now = Date.now();
  const result: Array<{ threadId: string; expiresAt: number; remainingSeconds: number }> = [];
  for (const [threadId, expiresAt] of groupReplyWindows) {
    const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1000));
    if (remaining > 0) {
      result.push({ threadId, expiresAt, remainingSeconds: remaining });
    } else {
      groupReplyWindows.delete(threadId);
    }
  }
  return result;
}

// ── Audit log helper ─────────────────────────────────────────────

export interface GroupGateAudit {
  threadId: string;
  threadType: "user" | "group";
  messageId: string | null;
  decision: "allow" | "skip";
  reason: string;
  mentioned?: boolean;
  replyWindowUntil?: string;
}

/**
 * Structured audit log for group gate decisions.
 * Logs to console (structured JSON for grep-friendly output).
 */
export function logGroupGateAudit(audit: GroupGateAudit): void {
  const entry = {
    ...audit,
    ts: new Date().toISOString(),
  };
  console.log(`[group-gate] ${JSON.stringify(entry)}`);
}
