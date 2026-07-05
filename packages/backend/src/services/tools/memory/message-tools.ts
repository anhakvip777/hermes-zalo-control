// =============================================================================
// Memory message tools (Phase 4): getRecentMessages, searchMessages,
// getThreadHistory. Non-admin: own thread only. Admin: any/global (search).
// =============================================================================

import { z } from "zod";
import type { ToolDefinition } from "../../tool-gateway/types.js";
import { clampLimit, resolveThreadScope } from "./scope.js";
import { resolveMemoryDeps, type MemoryDeps } from "./deps.js";

const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  role: z.string(),
  senderId: z.string().nullable(),
  content: z.string(),
  messageType: z.string().nullable(),
  createdAt: z.string(),
});
const messageListSchema = z.object({ messages: z.array(messageSchema), scope: z.enum(["thread", "global"]) });

export function createGetRecentMessagesTool(deps: MemoryDeps = {}): ToolDefinition {
  const d = resolveMemoryDeps(deps);
  return {
    name: "memory.getRecentMessages",
    kind: "read",
    minRole: "basic_chat",
    dataScope: "own_thread",
    argsSchema: z.object({ threadId: z.string().optional(), limit: z.number().optional() }),
    resultSchema: messageListSchema,
    async execute({ args, ctx, role }) {
      const a = args as { threadId?: string; limit?: number };
      const scope = resolveThreadScope(role, ctx.threadId, a.threadId);
      const messages = await d.getMessages({ threadId: scope.threadId, limit: clampLimit(a.limit) });
      return { result: { messages, scope: scope.global ? "global" : "thread" } };
    },
  };
}

export function createSearchMessagesTool(deps: MemoryDeps = {}): ToolDefinition {
  const d = resolveMemoryDeps(deps);
  return {
    name: "memory.searchMessages",
    kind: "read",
    minRole: "basic_chat",
    dataScope: "own_thread",
    argsSchema: z.object({
      query: z.string().min(1),
      threadId: z.string().optional(),
      limit: z.number().optional(),
    }),
    resultSchema: messageListSchema,
    async execute({ args, ctx, role }) {
      const a = args as { query: string; threadId?: string; limit?: number };
      // Non-admin: forced to own thread. Admin: threadId or global.
      const scope = resolveThreadScope(role, ctx.threadId, a.threadId);
      const messages = await d.getMessages({ threadId: scope.threadId, search: a.query, limit: clampLimit(a.limit) });
      return { result: { messages, scope: scope.global ? "global" : "thread" } };
    },
  };
}

export function createGetThreadHistoryTool(deps: MemoryDeps = {}): ToolDefinition {
  const d = resolveMemoryDeps(deps);
  return {
    name: "memory.getThreadHistory",
    kind: "read",
    minRole: "basic_chat",
    dataScope: "own_thread",
    argsSchema: z.object({ threadId: z.string().optional(), limit: z.number().optional() }),
    resultSchema: messageListSchema,
    async execute({ args, ctx, role }) {
      const a = args as { threadId?: string; limit?: number };
      // History is always a specific thread — non-admin own thread, admin any (no global).
      const scope = resolveThreadScope(role, ctx.threadId, a.threadId);
      const threadId = scope.threadId ?? ctx.threadId; // admin-global not meaningful for history → current
      const messages = await d.getMessages({ threadId, limit: clampLimit(a.limit) });
      return { result: { messages, scope: "thread" } };
    },
  };
}
