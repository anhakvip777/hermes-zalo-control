// =============================================================================
// Phase 3 — Zalo tools tests (DB-free: stub provider + in-memory sink +
// injected sendOutbound + injected DB reader + injected gateway deciders)
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";

import { ToolGateway } from "../services/tool-gateway/gateway.js";
import { ToolRegistry } from "../services/tool-gateway/registry.js";
import { InMemoryToolEvidenceSink } from "../services/tool-gateway/evidence.js";
import { registerZaloTools } from "../services/tools/zalo/index.js";
import type { ZaloToolDeps } from "../services/tools/zalo/deps.js";
import type { ToolContext } from "../services/tool-gateway/types.js";
import type {
  GroupInfoResult,
  ListFriendsResult,
  ListGroupsResult,
  PollActionInput,
  PollProviderResult,
  ProviderActionResult,
  ProviderRuntimeStatus,
  ReactionActionInput,
  UserInfoResult,
  ZaloProvider,
} from "../services/zalo-provider/types.js";
import type { OutboundIntent, OutboundResult } from "../services/outbound-dispatcher.service.js";

// ── Stub provider (read + write) ─────────────────────────────────────
class StubProvider implements ZaloProvider {
  connected = true;
  isConnected() { return this.connected; }
  async addReaction(_i: ReactionActionInput): Promise<ProviderActionResult> { return { ok: true }; }
  async createPoll(_i: PollActionInput): Promise<PollProviderResult> { return { ok: true }; }
  getRuntimeStatus(): ProviderRuntimeStatus {
    return {
      connected: true,
      connectionStatus: "connected",
      listenerActive: true,
      selfUserId: "self-1",
      selfDisplayName: "Bot",
      dryRun: true,
    };
  }
  async listGroups(): Promise<ListGroupsResult> {
    return { ok: true, groups: [{ groupId: "g1", name: "Group One", memberCount: 3, avatar: null }] };
  }
  async getGroupInfo(groupId: string): Promise<GroupInfoResult> {
    if (groupId === "g1") return { ok: true, group: { groupId: "g1", name: "Group One", memberCount: 3, avatar: null } };
    return { ok: false, errorCode: "GROUP_NOT_FOUND" };
  }
  async getUserInfo(userId: string): Promise<UserInfoResult> {
    if (userId === "u1") return { ok: true, user: { userId: "u1", displayName: "Alice", avatar: null } };
    return { ok: false, errorCode: "USER_NOT_FOUND" };
  }
  async listFriends(): Promise<ListFriendsResult> {
    return { ok: true, friends: [{ userId: "u1", displayName: "Alice", avatar: null }] };
  }
}

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { agentName: "hermes", threadId: "t1", threadType: "user", role: "admin", principalId: "p1", ...overrides };
}

function makeGateway(registry: ToolRegistry, sink: InMemoryToolEvidenceSink, over: Record<string, unknown> = {}) {
  return new ToolGateway({
    registry,
    evidence: sink,
    getDryRun: () => true,
    getLiveAllowed: () => false,
    resolveRole: async () => ({ role: "form_only", principalId: null, blocked: false }),
    ...over,
  });
}

describe("Phase 3 — Zalo tools", () => {
  let registry: ToolRegistry;
  let sink: InMemoryToolEvidenceSink;
  let provider: StubProvider;
  let outboundCalls: OutboundIntent[];
  let outboundResult: OutboundResult;

  const deps = (): ZaloToolDeps => ({
    getProvider: () => provider,
    sendOutbound: async (intent: OutboundIntent) => {
      outboundCalls.push(intent);
      return outboundResult;
    },
    readThreadFromDb: async (threadId, threadType) =>
      threadId === "in-db" ? { source: "db", threadId, threadType, name: "DB Thread" } : null,
  });

  beforeEach(() => {
    registry = new ToolRegistry();
    sink = new InMemoryToolEvidenceSink();
    provider = new StubProvider();
    outboundCalls = [];
    outboundResult = { success: true, dryRun: true, decision: "allow", reason: "dry_run", sentMessageId: "dry-1" };
    registerZaloTools(registry, deps());
  });

  it("getRuntimeStatus → connected/self info, NO secrets", async () => {
    const gw = makeGateway(registry, sink);
    const res = await gw.execute({ name: "zalo.getRuntimeStatus", arguments: {} }, ctx());
    expect(res.executionStatus).toBe("success");
    const r = res.result as Record<string, unknown>;
    expect(r.connected).toBe(true);
    expect(r.selfUserId).toBe("self-1");
    // No secret-shaped keys leaked.
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/cookie|token|session|imei|password/i);
  });

  it("listGroups → provider data; role-gated (basic_chat blocked, advanced ok)", async () => {
    const gw = makeGateway(registry, sink);

    const denied = await gw.execute({ name: "zalo.listGroups", arguments: {} }, ctx({ role: "basic_chat" }));
    expect(denied.executionStatus).toBe("blocked");

    const ok = await gw.execute({ name: "zalo.listGroups", arguments: {} }, ctx({ role: "advanced" }));
    expect(ok.executionStatus).toBe("success");
    expect((ok.result as any).groups).toHaveLength(1);
  });

  it("getThreadInfo → provider (group), provider (user), DB fallback, unavailable", async () => {
    const gw = makeGateway(registry, sink);

    const grp = await gw.execute({ name: "zalo.getThreadInfo", arguments: { threadId: "g1", threadType: "group" } }, ctx({ role: "advanced" }));
    expect(grp.executionStatus).toBe("success");
    expect((grp.result as any).source).toBe("provider");
    expect((grp.result as any).thread.name).toBe("Group One");

    const usr = await gw.execute({ name: "zalo.getThreadInfo", arguments: { threadId: "u1", threadType: "user" } }, ctx({ role: "advanced" }));
    expect((usr.result as any).thread.name).toBe("Alice");

    // Not in provider but in DB → fallback.
    const db = await gw.execute({ name: "zalo.getThreadInfo", arguments: { threadId: "in-db", threadType: "user" } }, ctx({ role: "advanced" }));
    expect((db.result as any).source).toBe("db");

    // Neither provider nor DB → unavailable.
    const none = await gw.execute({ name: "zalo.getThreadInfo", arguments: { threadId: "nope", threadType: "user" } }, ctx({ role: "advanced" }));
    expect(none.executionStatus).toBe("unavailable");
  });

  it("getThreadInfo provider-disconnected → DB fallback", async () => {
    provider.connected = false;
    const gw = makeGateway(registry, sink);
    const db = await gw.execute({ name: "zalo.getThreadInfo", arguments: { threadId: "in-db", threadType: "group" } }, ctx({ role: "advanced" }));
    expect(db.executionStatus).toBe("success");
    expect((db.result as any).source).toBe("db");
  });

  it("listFriends (admin) + getFriendInfo (advanced)", async () => {
    const gw = makeGateway(registry, sink);

    const friends = await gw.execute({ name: "zalo.listFriends", arguments: {} }, ctx({ role: "admin" }));
    expect(friends.executionStatus).toBe("success");
    expect((friends.result as any).friends).toHaveLength(1);

    // listFriends is admin-only.
    const deniedFriends = await gw.execute({ name: "zalo.listFriends", arguments: {} }, ctx({ role: "advanced" }));
    expect(deniedFriends.executionStatus).toBe("blocked");

    const info = await gw.execute({ name: "zalo.getFriendInfo", arguments: { userId: "u1" } }, ctx({ role: "advanced" }));
    expect((info.result as any).user.displayName).toBe("Alice");

    const notFound = await gw.execute({ name: "zalo.getFriendInfo", arguments: { userId: "ghost" } }, ctx({ role: "advanced" }));
    expect(notFound.executionStatus).toBe("success");
    expect((notFound.result as any).user).toBeNull();
  });

  it("sendText → routes through sendOutbound (dryRun) + ToolCallRecord, no provider send", async () => {
    const gw = makeGateway(registry, sink);
    const res = await gw.execute(
      { name: "zalo.sendText", arguments: { threadId: "t1", threadType: "user", content: "hi" } },
      ctx({ role: "basic_chat" }),
    );
    expect(res.executionStatus).toBe("success");
    expect(res.deliveryStatus).toBe("dry_run");
    expect(outboundCalls).toHaveLength(1);
    expect(outboundCalls[0]!.source).toBe("agent_tool"); // not auto_reply, not provider
    expect((res.result as any).sentMessageId).toBe("dry-1");
    // Evidence written for the outbound tool.
    const rec = sink.toolCalls.find((t) => t.toolName === "zalo.sendText");
    expect(rec?.kind).toBe("outbound");
    expect(rec?.deliveryStatus).toBe("dry_run");
  });

  it("sendText live send → deliveryStatus live_sent", async () => {
    outboundResult = { success: true, dryRun: false, decision: "allow", reason: "single_send", sentMessageId: "real-1" };
    const gw = makeGateway(registry, sink, { getDryRun: () => false });
    const res = await gw.execute(
      { name: "zalo.sendText", arguments: { threadId: "t1", threadType: "user", content: "hi live" } },
      ctx({ role: "basic_chat" }),
    );
    expect(res.deliveryStatus).toBe("live_sent");
    expect(outboundCalls).toHaveLength(1);
  });

  it("sendText cooldown → deliveryStatus cooldown_blocked", async () => {
    outboundResult = { success: false, dryRun: true, decision: "skip", reason: "cooldown" };
    const gw = makeGateway(registry, sink);
    const res = await gw.execute(
      { name: "zalo.sendText", arguments: { threadId: "t1", threadType: "user", content: "hi cd" } },
      ctx({ role: "basic_chat" }),
    );
    expect(res.deliveryStatus).toBe("cooldown_blocked");
  });
});
