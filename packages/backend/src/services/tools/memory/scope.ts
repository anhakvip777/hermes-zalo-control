// =============================================================================
// Memory tools — scope + limit helpers (Phase 4)
// =============================================================================
// Enforces: non-admin may only read their CURRENT thread (ctx.threadId). No
// cross-thread, no global. Admin may target any thread or go global.
// =============================================================================

import { toolErrors } from "../../tool-gateway/errors.js";
import { roleLevel } from "../../tool-gateway/permissions.js";
import type { ToolRole } from "../../tool-gateway/types.js";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export function clampLimit(limit: unknown): number {
  const n = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_LIMIT;
  if (n < 1) return 1;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

export function isAdmin(role: ToolRole): boolean {
  return roleLevel(role) >= roleLevel("admin");
}

export interface ThreadScope {
  /** Resolved threadId to query; undefined = global (admin only). */
  threadId?: string;
  global: boolean;
}

/**
 * Resolve the thread a memory read may target.
 * - admin: requestedThreadId (specific) or undefined → global.
 * - non-admin: MUST equal ctx.threadId. Any other threadId (or global) → blocked.
 *   Throws toolErrors.blocked on cross-thread/global attempts.
 */
export function resolveThreadScope(
  role: ToolRole,
  ctxThreadId: string,
  requestedThreadId?: string,
): ThreadScope {
  if (isAdmin(role)) {
    return requestedThreadId ? { threadId: requestedThreadId, global: false } : { global: true };
  }
  const effective = requestedThreadId ?? ctxThreadId;
  if (effective !== ctxThreadId) {
    throw toolErrors.blocked("Cross-thread access denied (non-admin may only read the current thread)", {
      requested: requestedThreadId,
      current: ctxThreadId,
    });
  }
  return { threadId: ctxThreadId, global: false };
}
