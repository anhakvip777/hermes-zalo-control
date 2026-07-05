// =============================================================================
// Zalo read tools (Phase 3): getRuntimeStatus, listGroups, getThreadInfo,
// listFriends, getFriendInfo.
// =============================================================================
// Tools depend ONLY on ZaloProvider (never zca-js/getApi). Unsupported / provider
// missing → structured `unavailable`. Whitelisted fields only; gateway redaction
// masks phone-by-role as defense-in-depth.
// =============================================================================

import { z } from "zod";
import { toolErrors } from "../../tool-gateway/errors.js";
import type { ToolDefinition } from "../../tool-gateway/types.js";
import { defaultReadThreadFromDb, resolveProvider, type ZaloToolDeps } from "./deps.js";

const UNAVAILABLE_CODES = new Set(["ZALO_API_UNAVAILABLE", "UNSUPPORTED"]);

/** Map a provider errorCode to the right ToolError (unavailable vs provider_error). */
function providerError(errorCode: string | undefined, message: string | undefined): never {
  if (errorCode && UNAVAILABLE_CODES.has(errorCode)) {
    throw toolErrors.unavailable(message ?? "Zalo provider unavailable", { errorCode });
  }
  throw toolErrors.providerError(message ?? "Zalo provider error", { errorCode });
}

const groupSummarySchema = z.object({
  groupId: z.string(),
  name: z.string(),
  memberCount: z.number(),
  avatar: z.string().nullable(),
});
const userSummarySchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  avatar: z.string().nullable(),
});

export function createGetRuntimeStatusTool(deps: ZaloToolDeps = {}): ToolDefinition {
  return {
    name: "zalo.getRuntimeStatus",
    kind: "read",
    minRole: "admin",
    dataScope: "none",
    argsSchema: z.object({}).strip(),
    resultSchema: z.object({
      connected: z.boolean(),
      connectionStatus: z.string(),
      listenerActive: z.boolean().optional(),
      selfUserId: z.string().nullable(),
      selfDisplayName: z.string().nullable(),
      dryRun: z.boolean(),
    }),
    async execute() {
      const provider = await resolveProvider(deps);
      // Whitelisted status only — NO cookie/token/session/context.
      return { result: provider.getRuntimeStatus() };
    },
  };
}

export function createListGroupsTool(deps: ZaloToolDeps = {}): ToolDefinition {
  return {
    name: "zalo.listGroups",
    kind: "read",
    minRole: "advanced",
    dataScope: "none",
    argsSchema: z.object({}).strip(),
    resultSchema: z.object({ groups: z.array(groupSummarySchema) }),
    async execute() {
      const provider = await resolveProvider(deps);
      const r = await provider.listGroups();
      if (!r.ok) providerError(r.errorCode, r.error);
      return { result: { groups: r.groups ?? [] } };
    },
  };
}

export function createGetThreadInfoTool(deps: ZaloToolDeps = {}): ToolDefinition {
  const readDb = deps.readThreadFromDb ?? defaultReadThreadFromDb;
  return {
    name: "zalo.getThreadInfo",
    kind: "read",
    minRole: "basic_chat",
    dataScope: "own_thread",
    argsSchema: z.object({
      threadId: z.string().min(1),
      threadType: z.enum(["user", "group"]),
    }),
    resultSchema: z.object({
      source: z.enum(["provider", "db"]),
      thread: z.object({
        threadId: z.string(),
        threadType: z.enum(["user", "group"]),
        name: z.string().nullable(),
        memberCount: z.number().optional(),
        avatar: z.string().nullable().optional(),
      }),
    }),
    async execute({ args }) {
      const { threadId, threadType } = args as { threadId: string; threadType: "user" | "group" };
      const provider = await resolveProvider(deps);

      // 1. Provider (only when connected).
      if (provider.isConnected()) {
        if (threadType === "group") {
          const r = await provider.getGroupInfo(threadId);
          if (r.ok && r.group) {
            return {
              result: {
                source: "provider",
                thread: { threadId, threadType, name: r.group.name, memberCount: r.group.memberCount, avatar: r.group.avatar },
              },
            };
          }
        } else {
          const r = await provider.getUserInfo(threadId);
          if (r.ok && r.user) {
            return {
              result: { source: "provider", thread: { threadId, threadType, name: r.user.displayName, avatar: r.user.avatar } },
            };
          }
        }
      }

      // 2. DB fallback.
      const db = await readDb(threadId, threadType);
      if (db) {
        return { result: { source: "db", thread: { threadId, threadType, name: db.name } } };
      }

      // 3. Neither → unavailable (no faked answer).
      throw toolErrors.unavailable(`Thread info unavailable for ${threadId}`, { threadId, threadType });
    },
  };
}

export function createListFriendsTool(deps: ZaloToolDeps = {}): ToolDefinition {
  return {
    name: "zalo.listFriends",
    kind: "read",
    minRole: "admin",
    dataScope: "none",
    argsSchema: z.object({}).strip(),
    resultSchema: z.object({ friends: z.array(userSummarySchema) }),
    async execute() {
      const provider = await resolveProvider(deps);
      const r = await provider.listFriends();
      if (!r.ok) providerError(r.errorCode, r.error);
      return { result: { friends: r.friends ?? [] } };
    },
  };
}

export function createGetFriendInfoTool(deps: ZaloToolDeps = {}): ToolDefinition {
  return {
    name: "zalo.getFriendInfo",
    kind: "read",
    minRole: "advanced",
    dataScope: "own_thread",
    argsSchema: z.object({ userId: z.string().min(1) }),
    resultSchema: z.object({ user: userSummarySchema.nullable() }),
    async execute({ args }) {
      const { userId } = args as { userId: string };
      const provider = await resolveProvider(deps);
      const r = await provider.getUserInfo(userId);
      if (r.ok && r.user) return { result: { user: r.user } };
      if (r.errorCode === "USER_NOT_FOUND") return { result: { user: null } };
      providerError(r.errorCode, r.error);
    },
  };
}
