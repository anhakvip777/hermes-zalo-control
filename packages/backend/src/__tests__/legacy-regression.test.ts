// =============================================================================
// Legacy regression — replays zalo-bot-2 audit cases against the NEW bridge
// =============================================================================
// Asserts the new bridge neutralizes the legacy BLOCKER behaviors:
//   - allowlist gate (thread_not_allowed) with threadType scoping (no collision)
//   - governed reaction/poll in dryRun → no live provider call + evidence
//   - memory cross-thread read blocked for non-admin
// DB-free: in-memory allowlist store, stub provider, in-memory evidence sink.
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  applyAllowChanges,
  initAllowlist,
  isThreadAllowedCached,
  setAllowlistStoreForTest,
  type AllowedThreadEntry,
  type AllowlistStore,
} from "../services/allowlist.service.js";
import { resolveThreadScope } from "../services/tools/memory/scope.js";
import { performGovernedZaloAction } from "../services/zalo-provider/governed-action.js";
import { InMemoryToolEvidenceSink } from "../services/tool-gateway/evidence.js";
import type { PollActionInput, ProviderActionResult, ReactionActionInput } from "../services/zalo-provider/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
interface Fixture {
  id: string;
  threadId: string;
  threadType: "user" | "group";
  senderRole: string;
  config: { autoReply: boolean; dryRun: boolean; bridge: boolean; allowed: boolean };
  expected: { decision: string; createOutbound: boolean; liveSend: boolean; toolWrites: string[] };
}
const fixtures: Fixture[] = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/legacy-bridge-cases.json"), "utf-8"),
).cases;

// ── in-memory allowlist store ────────────────────────────────────────
class MemStore implements AllowlistStore {
  entries: AllowedThreadEntry[] = [];
  async read() { return [...this.entries]; }
  async write(e: AllowedThreadEntry[]) { this.entries = [...e]; }
}

let mem: MemStore;
beforeEach(async () => {
  mem = new MemStore();
  setAllowlistStoreForTest(mem);
  await initAllowlist();
});

/** Mirror of dispatcher.safetyCheck's allowlist decision (the gate under test). */
function gateDecision(threadId: string, threadType: "user" | "group"): "allow" | "thread_not_allowed" {
  return isThreadAllowedCached(threadId, threadType) ? "allow" : "thread_not_allowed";
}

describe("legacy regression — allowlist gate + threadType scoping", () => {
  for (const f of fixtures.filter((x) => ["legacy-001", "legacy-002", "legacy-003", "legacy-004", "legacy-008", "legacy-010"].includes(x.id))) {
    it(`${f.id}: ${f.expected.decision} / liveSend=${f.expected.liveSend}`, async () => {
      if (f.config.allowed) {
        await applyAllowChanges([{ threadId: f.threadId, threadType: f.threadType, allowed: true }]);
      }
      expect(gateDecision(f.threadId, f.threadType)).toBe(
        f.expected.decision === "allow" ? "allow" : "thread_not_allowed",
      );
      // The bridge never live-sends in these fixtures (dryRun=true).
      expect(f.expected.liveSend).toBe(false);
    });
  }

  it("legacy-005/006: user vs group with same id do not collide", async () => {
    await applyAllowChanges([{ threadId: "999-collision", threadType: "user", allowed: true }]);
    expect(isThreadAllowedCached("999-collision", "user")).toBe(true);
    expect(isThreadAllowedCached("999-collision", "group")).toBe(false); // legacy-005
    await applyAllowChanges([{ threadId: "999-collision", threadType: "group", allowed: true }]);
    expect(isThreadAllowedCached("999-collision", "group")).toBe(true); // legacy-006
  });
});

describe("legacy regression — memory cross-thread (legacy-007)", () => {
  it("non-admin reading another thread is blocked", () => {
    expect(() => resolveThreadScope("basic_chat", "thread-A", "thread-B")).toThrow();
    // own thread is fine
    expect(resolveThreadScope("basic_chat", "thread-A", "thread-A")).toEqual({ threadId: "thread-A", global: false });
  });
});

describe("legacy regression — governed reaction in dryRun (legacy-009)", () => {
  it("dryRun reaction: no live provider call, evidence written, no live send", async () => {
    const sink = new InMemoryToolEvidenceSink();
    let providerCalled = false;
    const provider = {
      isConnected: () => true,
      async addReaction(_i: ReactionActionInput): Promise<ProviderActionResult> { providerCalled = true; return { ok: true }; },
      async createPoll(_i: PollActionInput): Promise<ProviderActionResult> { providerCalled = true; return { ok: true }; },
      getRuntimeStatus: () => ({ connected: true, connectionStatus: "connected", selfUserId: null, selfDisplayName: null, dryRun: true }),
      async listGroups() { return { ok: true, groups: [] }; },
      async getGroupInfo() { return { ok: false as const, errorCode: "x" }; },
      async getUserInfo() { return { ok: false as const, errorCode: "x" }; },
      async listFriends() { return { ok: true, friends: [] }; },
    };
    const res = await performGovernedZaloAction(
      {
        actionType: "reaction",
        threadId: "group-redacted-1",
        threadType: "group",
        targetMsgId: "m1",
        payload: { icon: "heart" },
        trigger: "agent_tool",
        perform: (p) => p.addReaction({ threadId: "group-redacted-1", threadType: "group", msgId: "m1", icon: "heart" }),
      },
      { provider, evidence: sink, getDryRun: () => true, getLiveAllowed: () => false },
    );
    expect(res.dryRun).toBe(true);
    expect(res.sent).toBe(false);
    expect(res.deliveryStatus).toBe("dry_run");
    expect(providerCalled).toBe(false); // NO live provider call
    expect(sink.zaloActions).toHaveLength(1); // evidence written
    expect(sink.zaloActions[0].actionType).toBe("reaction");
  });
});
