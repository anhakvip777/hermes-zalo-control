// =============================================================================
// Memory access/system tools (Phase 4): access.getUserRole, system.getRuntimeStatus
// =============================================================================

import { z } from "zod";
import { toolErrors } from "../../tool-gateway/errors.js";
import type { ToolDefinition } from "../../tool-gateway/types.js";
import { isAdmin } from "./scope.js";
import { resolveMemoryDeps, type MemoryDeps } from "./deps.js";

export function createAccessGetUserRoleTool(deps: MemoryDeps = {}): ToolDefinition {
  const d = resolveMemoryDeps(deps);
  return {
    name: "access.getUserRole",
    kind: "read",
    minRole: "basic_chat",
    dataScope: "none",
    argsSchema: z.object({ principalId: z.string().optional(), threadId: z.string().optional() }),
    resultSchema: z.object({
      principalId: z.string(),
      role: z.string(),
      status: z.string(),
      fromDb: z.boolean(),
    }),
    async execute({ args, ctx, role, principalId }) {
      const a = args as { principalId?: string; threadId?: string };
      const requested = a.principalId ?? principalId ?? ctx.senderId ?? "";
      // Non-admin may only query THEIR OWN role.
      if (!isAdmin(role)) {
        const self = principalId ?? ctx.senderId ?? null;
        if (!self || requested !== self) {
          throw toolErrors.blocked("access.getUserRole: non-admin may only query their own role", {
            requested,
            self,
          });
        }
      }
      if (!requested) {
        throw toolErrors.invalidArgs("principalId is required (no self identity available)");
      }
      const info = await d.getUserRole(requested, a.threadId);
      return { result: info };
    },
  };
}

export function createSystemGetRuntimeStatusTool(deps: MemoryDeps = {}): ToolDefinition {
  const d = resolveMemoryDeps(deps);
  return {
    name: "system.getRuntimeStatus",
    kind: "read",
    minRole: "admin",
    dataScope: "none",
    argsSchema: z.object({}).strip(),
    resultSchema: z.object({
      dryRun: z.boolean(),
      cooldownSeconds: z.number(),
      batchingEnabled: z.boolean(),
      zalo: z.object({ connected: z.boolean(), listenerActive: z.boolean().optional() }),
    }),
    async execute() {
      // Admin-only (minRole). No secrets — safe booleans/counts only.
      const status = await d.getRuntimeStatus();
      return { result: status };
    },
  };
}
