// =============================================================================
// P1.1 — Zalo Principal Service (permission / RBAC)
// =============================================================================
// Manages ZaloPrincipal records: role lookup, default policy, audit.
// Permission is matched by senderId (canonical Zalo user ID).
// displayName is NEVER used for permission matching.
// =============================================================================

import { prisma } from "../db.js";
import type { ZaloPrincipal } from "@prisma/client";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type PrincipalRole = "form_only" | "basic_chat" | "advanced" | "admin";
export type PrincipalStatus = "active" | "blocked";

export interface PrincipalContext {
  /** The resolved principal (null = no DB record → default policy). */
  principal: ZaloPrincipal | null;
  /** Effective role after applying default policy. */
  role: PrincipalRole;
  /** Effective status. */
  status: PrincipalStatus;
  /** Whether this was resolved from DB (false = default policy). */
  fromDb: boolean;
}

export interface PermissionCheck {
  allowed: boolean;
  reason?: string;
  currentRole: PrincipalRole;
  requiredRole?: PrincipalRole;
  action?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Default policy (applied when no DB record exists)
// ═══════════════════════════════════════════════════════════════════

/**
 * Default role for a principal with NO explicit ZaloPrincipal record.
 *
 * P1.1 safe default: form_only for everyone.
 * Known users can be upgraded later via P1.2 API.
 */
const DEFAULT_ROLE: PrincipalRole = "form_only";
const DEFAULT_STATUS: PrincipalStatus = "active";

// ═══════════════════════════════════════════════════════════════════
// Principal lookup
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve the effective principal for (senderId, threadId).
 *
 * Lookup order:
 * 1. Exact match: (senderId, threadId) → thread-scoped role
 * 2. Global fallback: (senderId, null) → global role
 * 3. Default policy → form_only, active
 *
 * displayName is NOT used for matching — only principalId (senderId).
 */
export async function resolvePrincipal(
  senderId: string,
  threadId?: string | null,
): Promise<PrincipalContext> {
  if (!senderId) {
    // No senderId → cannot identify → safest default
    return {
      principal: null,
      role: DEFAULT_ROLE,
      status: DEFAULT_STATUS,
      fromDb: false,
    };
  }

  try {
    // 1. Thread-scoped match
    if (threadId) {
      const scoped = await prisma.zaloPrincipal.findFirst({
        where: { principalId: senderId, threadId },
      });
      if (scoped) {
        return {
          principal: scoped,
          role: scoped.role as PrincipalRole,
          status: scoped.status as PrincipalStatus,
          fromDb: true,
        };
      }
    }

    // 2. Global match (threadId = null)
    const global = await prisma.zaloPrincipal.findFirst({
      where: { principalId: senderId, threadId: null },
    });
    if (global) {
      return {
        principal: global,
        role: global.role as PrincipalRole,
        status: global.status as PrincipalStatus,
        fromDb: true,
      };
    }
  } catch {
    // DB error → fail safe with default policy
    console.error(`[principal] DB lookup failed for senderId=${senderId} threadId=${threadId}`);
  }

  // 3. Default policy
  return {
    principal: null,
    role: DEFAULT_ROLE,
    status: DEFAULT_STATUS,
    fromDb: false,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Permission matrix
// ═══════════════════════════════════════════════════════════════════

/**
 * Actions that require specific role levels.
 *
 * Role hierarchy: form_only < basic_chat < advanced < admin
 */
const ROLE_LEVEL: Record<PrincipalRole, number> = {
  form_only: 0,
  basic_chat: 1,
  advanced: 2,
  admin: 3,
};

/** Action → minimum required role. */
const ACTION_MIN_ROLE: Record<string, PrincipalRole> = {
  fixed_reply: "form_only",
  rule_match: "form_only",
  faq: "form_only",
  hermes_chat: "basic_chat",
  hermes_basic: "basic_chat",
  ocr_followup: "basic_chat",
  document_ask: "advanced",
  create_reminder: "advanced",
  context_memory: "advanced",
  manage_rules: "admin",
  manage_principals: "admin",
  runtime_settings: "admin",
  live_test: "admin",
  view_errors: "admin",
  document_ingest: "admin",
};

/**
 * Check if a principal with a given role is allowed to perform an action.
 *
 * @returns PermissionCheck with allowed=false + reason if denied.
 */
export function checkPermission(
  role: PrincipalRole,
  action: string,
): PermissionCheck {
  const requiredRole = ACTION_MIN_ROLE[action];
  if (!requiredRole) {
    // Unknown action → allow (worst case: downstream gates catch it)
    return { allowed: true, currentRole: role };
  }

  const currentLevel = ROLE_LEVEL[role] ?? 0;
  const requiredLevel = ROLE_LEVEL[requiredRole] ?? 0;

  if (currentLevel < requiredLevel) {
    return {
      allowed: false,
      reason: "permission_denied",
      currentRole: role,
      requiredRole,
      action,
    };
  }

  return { allowed: true, currentRole: role };
}

/**
 * Check if a blocked principal should be silently skipped.
 */
export function isBlocked(status: PrincipalStatus): boolean {
  return status === "blocked";
}

// ═══════════════════════════════════════════════════════════════════
// Audit
// ═══════════════════════════════════════════════════════════════════

/**
 * Log a permission decision for audit/traceability.
 *
 * In P1.1 this writes a structured console log.
 * P1.2+ may persist to an AuditLog table.
 */
export function logPermissionDecision(result: PermissionCheck & {
  senderId: string;
  threadId: string;
  threadType?: string;
}): void {
  if (result.allowed) return; // only log denials

  const entry = {
    ts: new Date().toISOString(),
    senderId: result.senderId,
    threadId: result.threadId,
    threadType: result.threadType ?? "unknown",
    decision: "skip",
    reason: result.reason ?? "permission_denied",
    currentRole: result.currentRole,
    requiredRole: result.requiredRole ?? "unknown",
    action: result.action ?? "unknown",
  };

  console.log(`[permission] ${JSON.stringify(entry)}`);
}
