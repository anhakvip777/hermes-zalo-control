// =============================================================================
// Phase 2 — governed Zalo write-actions (reaction/poll) tests (DB-free)
// =============================================================================
// Uses a stub ZaloProvider + in-memory evidence sink + injected dryRun/live
// deciders. No zca-js, no DB, no live send.
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";

import { performGovernedZaloAction } from "../services/zalo-provider/governed-action.js";
import { createPollInGroup } from "../services/zalo-poll.service.js";
import { InMemoryToolEvidenceSink } from "../services/tool-gateway/evidence.js";
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

// ── Stub provider with call counters ─────────────────────────────────
class StubProvider implements ZaloProvider {
  connected = true;
  reactionCalls: ReactionActionInput[] = [];
  pollCalls: PollActionInput[] = [];
  reactionResult: ProviderActionResult = { ok: true, providerResultId: "react-ok" };
  pollResult: PollProviderResult = { ok: true, providerResultId: "poll_1", optionsCount: 2 };

  isConnected(): boolean {
    return this.connected;
  }
  async addReaction(input: ReactionActionInput): Promise<ProviderActionResult> {
    this.reactionCalls.push(input);
    return this.reactionResult;
  }
  async createPoll(input: PollActionInput): Promise<PollProviderResult> {
    this.pollCalls.push(input);
    return this.pollResult;
  }
  // Read methods (unused in these Phase 2 tests) — minimal stubs.
  getRuntimeStatus(): ProviderRuntimeStatus {
    return { connected: this.connected, connectionStatus: "connected", selfUserId: null, selfDisplayName: null, dryRun: true };
  }
  async listGroups(): Promise<ListGroupsResult> {
    return { ok: true, groups: [] };
  }
  async getGroupInfo(): Promise<GroupInfoResult> {
    return { ok: false, errorCode: "GROUP_NOT_FOUND" };
  }
  async getUserInfo(): Promise<UserInfoResult> {
    return { ok: false, errorCode: "USER_NOT_FOUND" };
  }
  async listFriends(): Promise<ListFriendsResult> {
    return { ok: true, friends: [] };
  }
}

describe("Phase 2 — governed Zalo write-actions", () => {
  let sink: InMemoryToolEvidenceSink;
  let provider: StubProvider;

  beforeEach(() => {
    sink = new InMemoryToolEvidenceSink();
    provider = new StubProvider();
  });

  it("reaction dryRun → no provider live call + ZaloActionRecord(dry_run)", async () => {
    const res = await performGovernedZaloAction(
      {
        actionType: "reaction",
        threadId: "t1",
        threadType: "group",
        targetMsgId: "m1",
        payload: { icon: "/-heart" },
        trigger: "listener",
        perform: (p) => p.addReaction({ threadId: "t1", threadType: "group", msgId: "m1", icon: "heart" }),
      },
      { provider, evidence: sink, getDryRun: () => true, getLiveAllowed: () => false },
    );

    expect(res.dryRun).toBe(true);
    expect(res.deliveryStatus).toBe("dry_run");
    expect(res.executionStatus).toBe("success");
    expect(provider.reactionCalls).toHaveLength(0); // NO live call
    expect(sink.zaloActions).toHaveLength(1);
    expect(sink.zaloActions[0]!.actionType).toBe("reaction");
    expect(sink.zaloActions[0]!.deliveryStatus).toBe("dry_run");
    expect(sink.zaloActions[0]!.trigger).toBe("listener");
  });

  it("reaction liveTest → provider called once + ZaloActionRecord(live_sent)", async () => {
    const res = await performGovernedZaloAction(
      {
        actionType: "reaction",
        threadId: "t1",
        threadType: "group",
        targetMsgId: "m1",
        payload: { icon: "/-heart" },
        perform: (p) => p.addReaction({ threadId: "t1", threadType: "group", msgId: "m1", icon: "heart" }),
      },
      // global dryRun ON, but live-test authorizes this thread
      { provider, evidence: sink, getDryRun: () => true, getLiveAllowed: () => true },
    );

    expect(res.dryRun).toBe(false);
    expect(res.sent).toBe(true);
    expect(res.deliveryStatus).toBe("live_sent");
    expect(provider.reactionCalls).toHaveLength(1); // provider called only when allowed
    expect(sink.zaloActions[0]!.deliveryStatus).toBe("live_sent");
  });

  it("poll dryRun → no provider live call + ZaloActionRecord + DRY_RUN_ACTIVE", async () => {
    const res = await createPollInGroup(
      { groupId: "g1", question: "Q?", options: ["A", "B"] },
      { provider, evidence: sink, getDryRun: () => true, getLiveAllowed: () => false },
    );

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("DRY_RUN_ACTIVE");
    expect(provider.pollCalls).toHaveLength(0); // NO live call
    expect(sink.zaloActions).toHaveLength(1);
    expect(sink.zaloActions[0]!.actionType).toBe("poll");
    expect(sink.zaloActions[0]!.deliveryStatus).toBe("dry_run");
  });

  it("poll liveTest → provider called only when allowed + evidence(live_sent)", async () => {
    const res = await createPollInGroup(
      { groupId: "g1", question: "Q?", options: ["A", "B"] },
      { provider, evidence: sink, getDryRun: () => true, getLiveAllowed: () => true },
    );

    expect(res.success).toBe(true);
    expect(res.pollId).toBe("poll_1");
    expect(provider.pollCalls).toHaveLength(1);
    expect(sink.zaloActions[0]!.deliveryStatus).toBe("live_sent");
    expect(sink.zaloActions[0]!.providerResultId).toBe("poll_1");
  });

  it("not connected → blocked, no provider call, evidence(blocked)", async () => {
    provider.connected = false;
    const res = await performGovernedZaloAction(
      {
        actionType: "reaction",
        threadId: "t1",
        threadType: "user",
        targetMsgId: "m1",
        payload: { icon: "/-heart" },
        perform: (p) => p.addReaction({ threadId: "t1", threadType: "user", msgId: "m1", icon: "heart" }),
      },
      { provider, evidence: sink, getDryRun: () => false, getLiveAllowed: () => false },
    );

    expect(res.executionStatus).toBe("blocked");
    expect(res.errorCode).toBe("ZALO_NOT_CONNECTED");
    expect(provider.reactionCalls).toHaveLength(0);
    expect(sink.zaloActions[0]!.executionStatus).toBe("blocked");
  });

  it("payload persisted redacted (no raw token/cookie/session/phone)", async () => {
    await performGovernedZaloAction(
      {
        actionType: "poll",
        threadId: "g1",
        threadType: "group",
        payload: {
          question: "Vote?",
          token: "super-secret-token",
          meta: { sessionId: "sess-abc-123", cookie: "c=1", contact: "+84 912 345 678" },
        },
        perform: (p) => p.createPoll({ groupId: "g1", question: "Vote?", options: ["A", "B"] }),
      },
      { provider, evidence: sink, getDryRun: () => true, getLiveAllowed: () => false },
    );

    const stored = sink.zaloActions[0]!.payloadRedacted ?? "";
    expect(stored).not.toContain("super-secret-token");
    expect(stored).not.toContain("sess-abc-123");
    expect(stored).not.toContain("c=1");
    expect(stored).not.toContain("912 345 678");
    expect(stored).toContain("[REDACTED]");
  });

  it("provider failure → failed + evidence(failed), return error preserved (poll)", async () => {
    provider.pollResult = { ok: false, error: "boom", errorCode: "CREATE_POLL_FAILED" };
    const res = await createPollInGroup(
      { groupId: "g1", question: "Q?", options: ["A", "B"] },
      { provider, evidence: sink, getDryRun: () => false, getLiveAllowed: () => false },
    );
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("CREATE_POLL_FAILED");
    expect(sink.zaloActions[0]!.executionStatus).toBe("failed");
  });
});
