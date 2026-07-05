// =============================================================================
// Tool Gateway — tool permission matrix (Phase 1)
// =============================================================================
// SEPARATE from principal.service.ts ACTION_MIN_ROLE (which stays for the legacy
// runtime path). This matrix is tool-name based. Not unified in Phase 1.
//
// Role ladder mirrors principal.service.ts: form_only < basic_chat < advanced < admin.
// =============================================================================

import type { DataScope, ToolDefinition, ToolRole } from "./types.js";

export const TOOL_ROLE_LEVEL: Record<ToolRole, number> = {
  form_only: 0,
  basic_chat: 1,
  advanced: 2,
  admin: 3,
};

export function roleLevel(role: ToolRole): number {
  return TOOL_ROLE_LEVEL[role] ?? 0;
}

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
  requiredRole?: ToolRole;
  currentRole: ToolRole;
}

/**
 * Check whether a role may invoke a tool (min-role check).
 */
export function checkToolPermission(role: ToolRole, def: ToolDefinition): PermissionDecision {
  const current = roleLevel(role);
  const required = roleLevel(def.minRole);
  if (current < required) {
    return { allowed: false, reason: "permission_denied", requiredRole: def.minRole, currentRole: role };
  }
  return { allowed: true, currentRole: role };
}

/**
 * Generic dataScope gate (Phase 1). Tool implementations MUST still re-check at
 * query level (decision 5). Here we only enforce the coarse rule:
 *   - cross_thread / global read scope → admin only.
 * "own_thread" and "none" are always allowed at this layer (fine-grained checks
 * happen inside the tool).
 */
export function checkDataScope(role: ToolRole, scope: DataScope | undefined): PermissionDecision {
  if (!scope || scope === "own_thread" || scope === "none") {
    return { allowed: true, currentRole: role };
  }
  // cross_thread | global → admin only
  if (roleLevel(role) < roleLevel("admin")) {
    return { allowed: false, reason: "data_scope_denied", requiredRole: "admin", currentRole: role };
  }
  return { allowed: true, currentRole: role };
}

/**
 * Build the list of tool names a role is granted, given the registered tools.
 * The Bridge owns this — the agent never sets its own allowedTools.
 * (Thread/runtime nuances can be layered in later phases.)
 */
export function buildAllowedTools(role: ToolRole, defs: ToolDefinition[]): string[] {
  return defs
    .filter((d) => checkToolPermission(role, d).allowed && checkDataScope(role, d.dataScope).allowed)
    .map((d) => d.name);
}
