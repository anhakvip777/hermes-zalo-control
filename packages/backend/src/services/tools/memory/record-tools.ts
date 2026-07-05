// =============================================================================
// Memory record tools (Phase 4): getOutboundRecords, getAgentTasks,
// rules.explainForMessage.
// =============================================================================

import { z } from "zod";
import type { ToolDefinition } from "../../tool-gateway/types.js";
import { clampLimit, resolveThreadScope } from "./scope.js";
import { resolveMemoryDeps, type MemoryDeps } from "./deps.js";

export function createGetOutboundRecordsTool(deps: MemoryDeps = {}): ToolDefinition {
  const d = resolveMemoryDeps(deps);
  return {
    name: "memory.getOutboundRecords",
    kind: "read",
    minRole: "advanced",
    dataScope: "own_thread",
    argsSchema: z.object({ threadId: z.string().optional(), limit: z.number().optional() }),
    resultSchema: z.object({
      records: z.array(
        z.object({
          threadId: z.string(),
          content: z.string(),
          source: z.string(),
          dryRun: z.boolean(),
          decision: z.string(),
          reason: z.string(),
          sentMessageId: z.string().nullable(),
          createdAt: z.string(),
        }),
      ),
      scope: z.enum(["thread", "global"]),
    }),
    async execute({ args, ctx, role }) {
      const a = args as { threadId?: string; limit?: number };
      const scope = resolveThreadScope(role, ctx.threadId, a.threadId);
      const records = await d.getOutboundRecords({ threadId: scope.threadId, limit: clampLimit(a.limit) });
      return { result: { records, scope: scope.global ? "global" : "thread" } };
    },
  };
}

export function createGetAgentTasksTool(deps: MemoryDeps = {}): ToolDefinition {
  const d = resolveMemoryDeps(deps);
  return {
    name: "memory.getAgentTasks",
    kind: "read",
    minRole: "advanced",
    dataScope: "none",
    argsSchema: z.object({ status: z.string().optional(), limit: z.number().optional() }),
    resultSchema: z.object({
      tasks: z.array(
        z.object({
          id: z.string(),
          agentName: z.string(),
          taskType: z.string(),
          status: z.string(),
          messageId: z.string().nullable(),
          scheduleId: z.string().nullable(),
          createdAt: z.string(),
        }),
      ),
    }),
    async execute({ args }) {
      const a = args as { status?: string; limit?: number };
      // No input/result returned (content-bearing). No thread content leaked.
      const tasks = await d.getAgentTasks({ limit: clampLimit(a.limit), status: a.status });
      return { result: { tasks } };
    },
  };
}

export function createRulesExplainForMessageTool(deps: MemoryDeps = {}): ToolDefinition {
  const d = resolveMemoryDeps(deps);
  return {
    name: "rules.explainForMessage",
    kind: "read",
    minRole: "advanced",
    dataScope: "own_thread",
    argsSchema: z.object({
      messageId: z.string().optional(),
      threadId: z.string().optional(),
      limit: z.number().optional(),
    }),
    resultSchema: z.object({
      executions: z.array(
        z.object({
          ruleId: z.string().nullable(),
          matched: z.boolean(),
          actionTaken: z.string().nullable(),
          result: z.string().nullable(),
          errorCode: z.string().nullable(),
          createdAt: z.string(),
        }),
      ),
      scope: z.enum(["thread", "global"]),
    }),
    async execute({ args, ctx, role }) {
      const a = args as { messageId?: string; threadId?: string; limit?: number };
      const scope = resolveThreadScope(role, ctx.threadId, a.threadId);
      const executions = await d.getRuleExecutions({
        threadId: scope.threadId,
        messageId: a.messageId,
        limit: clampLimit(a.limit),
      });
      return { result: { executions, scope: scope.global ? "global" : "thread" } };
    },
  };
}
