// =============================================================================
// Legacy MEMORY regression — replays zalo-bot-2 memory-era patterns against the
// NEW bridge primitives. DB-free (in-memory allowlist store, stub provider,
// in-memory evidence sink). Asserts the bridge neutralizes the legacy risks and
// that NO memory-era case can produce a live send under bridge defaults.
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
import { discoverThreads } from "../services/threads-access.service.js";
import { redact } from "../services/tool-gateway/redaction.js";
import { performGovernedZaloAction } from "../services/zalo-provider/governed-action.js";
import { InMemoryToolEvidenceSink } from "../services/tool-gateway/evidence.js";
import type { PollActionInput, ProviderActionResult, ReactionActionInput } from "../services/zalo-provider/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
interface MemCase {
  id: string;
  title: string;
  threadType: "user" | "group";
  expectedDecision: string;
  expectedOutbound: boolean;
  expectedLiveSend: boolean;
  severity: string;
  covered: string;
}
const cases: MemCase[] = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/legacy-memory-cases.json"), "utf-8"),
).cases;

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

describe("legacy-memory regression — invariant", () => {
  it("no memory-era case expects a live send under bridge defaults", () => {
    expect(cases.length).toBeGreaterThanOrEqual(16);
    for (const c of cases) expect(c.expectedLiveSend).toBe(false);
  });
});

describe("legacy-memory regression — inbound secret redaction (memory-017, KI-B4)", () => {
  it("masks user-pasted sk-... API key body (hex-body, real raw-inbound shape)", () => {
    // Synthetic key shaped like the leaked ones (sk- + 64 hex). Value is fabricated, not the real one.
    const inbound = "sk-" + "a".repeat(64) + " here are my keys";
    const out = redact(inbound) as string;
    expect(out).not.toContain("a".repeat(64)); // 64-hex secret body masked
    expect(out).toContain("[REDACTED]");
  });

  it("masks an ALPHANUMERIC sk-proj key (NOT pure hex — would slip past LONG_HEX)", () => {
    // Real OpenAI keys are base64url-ish (mixed case + digits + _-), not hex.
    // Fabricated value; the point is the sk- prefix pattern, not a hex body.
    const key = "sk-proj-Ab3dEf6GhiJkLmNoPqRsTuVwXyZ012345_-6789Abcd";
    const out = redact(`my key is ${key} thanks`) as string;
    expect(out).not.toContain(key);
    expect(out).toContain("[REDACTED]");
    // Non-secret words around it are preserved.
    expect(out).toContain("my key is");
    expect(out).toContain("thanks");
  });

  it("masks a JWT (eyJ… . … . …)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQabcdef123456";
    const out = redact(`token ${jwt}`) as string;
    expect(out).not.toContain(jwt);
    expect(out).toContain("[REDACTED]");
  });

  it("masks a Bearer token", () => {
    const out = redact("Authorization: Bearer abcdef1234567890XYZ") as string;
    expect(out).not.toContain("abcdef1234567890XYZ");
    expect(out).toContain("[REDACTED]");
  });

  it("masks label:value secret assignments (api_key / password / token)", () => {
    const out1 = redact("api_key: mysupersecretvalue123") as string;
    expect(out1).not.toContain("mysupersecretvalue123");
    expect(out1).toContain("api_key");
    expect(out1).toContain("[REDACTED]");

    const out2 = redact("password=hunter2secretpw") as string;
    expect(out2).not.toContain("hunter2secretpw");
    expect(out2).toContain("[REDACTED]");
  });

  it("masks a long high-entropy alphanumeric blob (base64-ish token)", () => {
    const blob = "Zm9vYmFyMTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6QUJD";
    const out = redact(`ctx ${blob}`) as string;
    expect(out).not.toContain(blob);
    expect(out).toContain("[REDACTED]");
  });

  it("masks a phone number in inbound content", () => {
    const out = redact("gọi mình số 0912345678 nhé") as string;
    expect(out).not.toContain("0912345678");
  });

  it("preserves normal Vietnamese text (no over-redaction)", () => {
    const text = "Tỷ ơi nhắc em 9h họp ở phòng A nhé, cảm ơn Muội";
    const out = redact(text) as string;
    expect(out).toBe(text);
  });

  it("is idempotent: redact(redact(x)) === redact(x)", () => {
    const samples = [
      "sk-proj-Ab3dEf6GhiJkLmNoPqRsTuVwXyZ012345_-6789Abcd here",
      "gọi 0912345678",
      "api_key: mysupersecretvalue123",
      "Tỷ ơi nhắc em 9h họp",
    ];
    for (const s of samples) {
      const once = redact(s) as string;
      const twice = redact(once) as string;
      expect(twice).toBe(once);
    }
  });
});

describe("legacy-memory regression — allowlist gate", () => {
  // Gate cases: allowed DM (allow) vs everything else (thread_not_allowed).
  const gateCases = cases.filter((c) =>
    ["memory-001", "memory-002", "memory-003", "memory-007", "memory-014", "memory-015", "memory-016"].includes(c.id),
  );
  for (const c of gateCases) {
    it(`${c.id}: ${c.expectedDecision}`, async () => {
      const threadId = `mem-${c.id}`;
      if (c.expectedDecision === "allow") {
        await applyAllowChanges([{ threadId, threadType: c.threadType, allowed: true }]);
        expect(isThreadAllowedCached(threadId, c.threadType)).toBe(true);
      } else {
        // not allow-listed → gate denies
        expect(isThreadAllowedCached(threadId, c.threadType)).toBe(false);
      }
    });
  }

  it("memory-015: user allowed does NOT allow same-id group (no collision)", async () => {
    await applyAllowChanges([{ threadId: "77-collide", threadType: "user", allowed: true }]);
    expect(isThreadAllowedCached("77-collide", "user")).toBe(true);
    expect(isThreadAllowedCached("77-collide", "group")).toBe(false);
  });
});

describe("legacy-memory regression — cross-thread memory (memory-008)", () => {
  it("non-admin cannot read another thread", () => {
    expect(() => resolveThreadScope("basic_chat", "thread-A", "thread-B")).toThrow();
    expect(resolveThreadScope("advanced", "thread-A", "thread-A")).toEqual({ threadId: "thread-A", global: false });
  });
});

describe("legacy-memory regression — provider/session unavailable (memory-009)", () => {
  it("discover while disconnected → unavailable, no data, no live", async () => {
    const provider = {
      isConnected: () => false,
      async listFriends() { return { ok: true, friends: [] }; },
      async listGroups() { return { ok: true, groups: [] }; },
    };
    const res = await discoverThreads({ type: "all" }, { provider, allowedEntries: [] });
    expect(res.connected).toBe(false);
    expect(res.errorCode).toBe("ZALO_NOT_CONNECTED");
    expect(res.items).toEqual([]);
  });
});

describe("legacy-memory regression — governed reaction dryRun (memory-010)", () => {
  it("dryRun reaction: no live provider call + evidence written", async () => {
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
        threadId: "mem-group-1",
        threadType: "group",
        targetMsgId: "m1",
        payload: { icon: "heart" },
        trigger: "agent_tool",
        perform: (p) => p.addReaction({ threadId: "mem-group-1", threadType: "group", msgId: "m1", icon: "heart" }),
      },
      { provider, evidence: sink, getDryRun: () => true, getLiveAllowed: () => false },
    );
    expect(res.dryRun).toBe(true);
    expect(res.sent).toBe(false);
    expect(res.deliveryStatus).toBe("dry_run");
    expect(providerCalled).toBe(false);
    expect(sink.zaloActions).toHaveLength(1);
  });
});
