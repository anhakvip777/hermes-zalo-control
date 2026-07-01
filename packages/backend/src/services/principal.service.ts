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

// ═══════════════════════════════════════════════════════════════════
// P1.2 — CRUD + audit
// ═══════════════════════════════════════════════════════════════════

export const VALID_ROLES: PrincipalRole[] = ["form_only", "basic_chat", "advanced", "admin"];
export const VALID_STATUSES: PrincipalStatus[] = ["active", "blocked"];
export const VALID_TYPES = ["user", "group", "thread"] as const;
export type PrincipalType = (typeof VALID_TYPES)[number];

export const VALID_AUDIT_ACTIONS = [
  "created",
  "role_changed",
  "status_changed",
  "updated",
  "deleted",
] as const;

export interface CreatePrincipalInput {
  principalId: string;
  type: PrincipalType;
  role: PrincipalRole;
  status?: PrincipalStatus;
  threadId?: string | null;
  displayName?: string | null;
  notes?: string | null;
  createdBy?: string;
}

export interface UpdatePrincipalRoleInput {
  role: PrincipalRole;
  actor?: string;
  reason?: string;
}

export interface UpdatePrincipalStatusInput {
  status: PrincipalStatus;
  actor?: string;
  reason?: string;
}

export interface UpdatePrincipalInput {
  displayName?: string | null;
  notes?: string | null;
  threadId?: string | null;
  actor?: string;
  reason?: string;
}

export interface ListPrincipalsQuery {
  q?: string;
  role?: PrincipalRole;
  status?: PrincipalStatus;
  type?: PrincipalType;
  threadId?: string;
}

/**
 * List principals with optional filters.
 */
export async function listPrincipals(query: ListPrincipalsQuery = {}) {
  const where: Record<string, unknown> = {};

  if (query.role) where.role = query.role;
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;
  if (query.threadId !== undefined) where.threadId = query.threadId ?? null;

  if (query.q) {
    where.OR = [
      { principalId: { contains: query.q } },
      { displayName: { contains: query.q } },
      { notes: { contains: query.q } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.zaloPrincipal.findMany({
      where: where as any,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.zaloPrincipal.count({ where: where as any }),
  ]);

  return { items, total };
}

/**
 * Get a single principal by ID.
 */
export async function getPrincipalById(id: string) {
  return prisma.zaloPrincipal.findUnique({ where: { id } });
}

/**
 * Create a new principal.
 */
export async function createPrincipal(input: CreatePrincipalInput) {
  // Check for duplicate (same principalId + same scope)
  const threadIdValue = input.threadId ?? null;
  const existing = await prisma.zaloPrincipal.findFirst({
    where: { principalId: input.principalId, threadId: threadIdValue },
  });

  if (existing) {
    throw Object.assign(
      new Error(`Principal already exists: ${input.principalId}${input.threadId ? ` in thread ${input.threadId}` : ""}`),
      { code: "DUPLICATE_PRINCIPAL" },
    );
  }

  const principal = await prisma.zaloPrincipal.create({
    data: {
      principalId: input.principalId,
      type: input.type,
      role: input.role,
      status: input.status ?? "active",
      threadId: threadIdValue,
      displayName: input.displayName ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
    },
  });

  // Audit: created
  await createAuditEntry({
    principalId: input.principalId,
    threadId: input.threadId ?? null,
    action: "created",
    newValue: JSON.stringify({ type: input.type, role: input.role, status: input.status ?? "active" }),
    actor: input.createdBy ?? null,
  });

  return principal;
}

/**
 * Update a principal's role.
 */
export async function updatePrincipalRole(id: string, input: UpdatePrincipalRoleInput) {
  const principal = await prisma.zaloPrincipal.findUnique({ where: { id } });
  if (!principal) {
    throw Object.assign(new Error(`Principal not found: ${id}`), { code: "NOT_FOUND" });
  }

  const oldRole = principal.role;

  const updated = await prisma.zaloPrincipal.update({
    where: { id },
    data: { role: input.role },
  });

  // Audit: role_changed
  await createAuditEntry({
    principalId: principal.principalId,
    threadId: principal.threadId,
    action: "role_changed",
    oldValue: oldRole,
    newValue: input.role,
    actor: input.actor ?? null,
    reason: input.reason ?? null,
  });

  return updated;
}

/**
 * Update a principal's status.
 */
export async function updatePrincipalStatus(id: string, input: UpdatePrincipalStatusInput) {
  const principal = await prisma.zaloPrincipal.findUnique({ where: { id } });
  if (!principal) {
    throw Object.assign(new Error(`Principal not found: ${id}`), { code: "NOT_FOUND" });
  }

  const oldStatus = principal.status;

  const updated = await prisma.zaloPrincipal.update({
    where: { id },
    data: { status: input.status },
  });

  // Audit: status_changed
  await createAuditEntry({
    principalId: principal.principalId,
    threadId: principal.threadId,
    action: "status_changed",
    oldValue: oldStatus,
    newValue: input.status,
    actor: input.actor ?? null,
    reason: input.reason ?? null,
  });

  return updated;
}

/**
 * Update general principal fields (displayName, notes, threadId).
 * Role and status changes go through their dedicated endpoints.
 */
export async function updatePrincipal(id: string, input: UpdatePrincipalInput) {
  const principal = await prisma.zaloPrincipal.findUnique({ where: { id } });
  if (!principal) {
    throw Object.assign(new Error(`Principal not found: ${id}`), { code: "NOT_FOUND" });
  }

  const data: Record<string, unknown> = {};
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.threadId !== undefined) data.threadId = input.threadId;

  if (Object.keys(data).length === 0) return principal;

  const updated = await prisma.zaloPrincipal.update({ where: { id }, data });

  // Audit: updated
  await createAuditEntry({
    principalId: principal.principalId,
    threadId: principal.threadId,
    action: "updated",
    oldValue: JSON.stringify({ displayName: principal.displayName, notes: principal.notes, threadId: principal.threadId }),
    newValue: JSON.stringify({ displayName: updated.displayName, notes: updated.notes, threadId: updated.threadId }),
    actor: input.actor ?? null,
    reason: input.reason ?? null,
  });

  return updated;
}

// ═══════════════════════════════════════════════════════════════════
// Audit
// ═══════════════════════════════════════════════════════════════════

export interface CreateAuditInput {
  principalId: string;
  threadId: string | null;
  action: string;
  oldValue?: string | null;
  newValue?: string | null;
  actor?: string | null;
  reason?: string | null;
}

/**
 * Create an audit entry for ZaloPrincipal changes.
 */
export async function createAuditEntry(input: CreateAuditInput) {
  return prisma.zaloPrincipalAudit.create({
    data: {
      principalId: input.principalId,
      threadId: input.threadId,
      action: input.action,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      actor: input.actor ?? null,
      reason: input.reason ?? null,
    },
  });
}

/**
 * List audit entries, optionally filtered by principalId or action.
 */
export async function listAudit(principalId?: string, limit = 100) {
  const where: Record<string, unknown> = {};
  if (principalId) where.principalId = principalId;

  const [items, total] = await Promise.all([
    prisma.zaloPrincipalAudit.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.zaloPrincipalAudit.count({ where: where as any }),
  ]);

  return { items, total };
}
