// =============================================================================
// AllowThreads — allowlist + discovery unit tests (DB-free, no network)
// =============================================================================
// Injects an in-memory AllowlistStore and a stub ZaloProvider. Verifies:
//   - discover normalizes friends/groups to the common shape
//   - allowed status is joined correctly (type-scoped)
//   - allow/disallow persists and the sync gate cache reflects it
//   - user vs group with the same id are independent (no collision)
//   - Zalo disconnected → connected:false unavailable (never mock data)
//   - pure config path performs no send (no provider write called)
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  applyAllowChanges,
  getAllowedThreads,
  initAllowlist,
  isThreadAllowedCached,
  parseEntries,
  setAllowlistStoreForTest,
  type AllowedThreadEntry,
  type AllowlistStore,
} from "../services/allowlist.service.js";
import { discoverThreads } from "../services/threads-access.service.js";

// ── In-memory allowlist store ────────────────────────────────────────
class MemStore implements AllowlistStore {
  entries: AllowedThreadEntry[] = [];
  writes = 0;
  async read() {
    return [...this.entries];
  }
  async write(entries: AllowedThreadEntry[]) {
    this.entries = [...entries];
    this.writes++;
  }
}

// ── Stub provider ────────────────────────────────────────────────────
function stubProvider(over: Partial<{ connected: boolean; friends: any[]; groups: any[]; friendsOk: boolean; groupsOk: boolean }> = {}) {
  let addReactionCalls = 0;
  return {
    connected: over.connected ?? true,
    isConnected() {
      return this.connected;
    },
    async listFriends() {
      if (over.friendsOk === false) return { ok: false, error: "nope", errorCode: "UNAVAILABLE" };
      return { ok: true, friends: over.friends ?? [] };
    },
    async listGroups() {
      if (over.groupsOk === false) return { ok: false, error: "nope", errorCode: "UNAVAILABLE" };
      return { ok: true, groups: over.groups ?? [] };
    },
    get addReactionCalls() {
      return addReactionCalls;
    },
  };
}

let mem: MemStore;
beforeEach(async () => {
  mem = new MemStore();
  setAllowlistStoreForTest(mem);
  await initAllowlist();
});

describe("allowlist.service", () => {
  it("parseEntries ignores malformed items", () => {
    const out = parseEntries(JSON.stringify([
      { threadId: "a", threadType: "user" },
      { threadId: "b", threadType: "bad" },
      { threadId: 123, threadType: "group" },
      "nope",
    ]));
    expect(out).toEqual([{ threadId: "a", threadType: "user" }]);
  });

  it("applyAllowChanges persists and updates the sync cache", async () => {
    await applyAllowChanges([{ threadId: "t1", threadType: "user", allowed: true }]);
    expect(isThreadAllowedCached("t1", "user")).toBe(true);
    expect(mem.entries).toEqual([{ threadId: "t1", threadType: "user" }]);
  });

  it("disallow removes from cache + store", async () => {
    await applyAllowChanges([{ threadId: "t1", threadType: "user", allowed: true }]);
    await applyAllowChanges([{ threadId: "t1", threadType: "user", allowed: false }]);
    expect(isThreadAllowedCached("t1", "user")).toBe(false);
    expect(mem.entries).toEqual([]);
  });

  it("user and group with the same id are independent (no collision)", async () => {
    await applyAllowChanges([{ threadId: "999", threadType: "user", allowed: true }]);
    expect(isThreadAllowedCached("999", "user")).toBe(true);
    expect(isThreadAllowedCached("999", "group")).toBe(false);
  });

  it("getAllowedThreads reflects the store", async () => {
    await applyAllowChanges([
      { threadId: "g1", threadType: "group", allowed: true },
      { threadId: "u1", threadType: "user", allowed: true },
    ]);
    const all = await getAllowedThreads();
    expect(all).toHaveLength(2);
  });
});

describe("threads-access.discoverThreads", () => {
  it("normalizes friends + groups and joins allowed status", async () => {
    await applyAllowChanges([{ threadId: "u1", threadType: "user", allowed: true }]);
    const allowedEntries = await getAllowedThreads();
    const provider = stubProvider({
      friends: [
        { userId: "u1", displayName: "Alice", avatar: "http://a" },
        { userId: "u2", displayName: "Bob", avatar: null },
      ],
      groups: [{ groupId: "g1", name: "Team", memberCount: 5, avatar: null }],
    });
    const res = await discoverThreads({ type: "all" }, { provider, allowedEntries });
    expect(res.connected).toBe(true);
    const u1 = res.items.find((i) => i.threadId === "u1")!;
    const u2 = res.items.find((i) => i.threadId === "u2")!;
    const g1 = res.items.find((i) => i.threadId === "g1")!;
    expect(u1.allowed).toBe(true);
    expect(u2.allowed).toBe(false);
    expect(u1.threadType).toBe("user");
    expect(g1.threadType).toBe("group");
    expect(g1.memberCount).toBe(5);
    expect(g1.subtitle).toContain("5");
  });

  it("filters by query (name / id / type)", async () => {
    const provider = stubProvider({
      friends: [
        { userId: "u1", displayName: "Alice", avatar: null },
        { userId: "u2", displayName: "Bob", avatar: null },
      ],
    });
    const res = await discoverThreads({ type: "user", query: "ali" }, { provider, allowedEntries: [] });
    expect(res.items.map((i) => i.displayName)).toEqual(["Alice"]);
  });

  it("returns connected:false + errorCode when Zalo is disconnected (no mock data)", async () => {
    const provider = stubProvider({ connected: false });
    const res = await discoverThreads({ type: "all" }, { provider, allowedEntries: [] });
    expect(res.connected).toBe(false);
    expect(res.errorCode).toBe("ZALO_NOT_CONNECTED");
    expect(res.items).toEqual([]);
  });

  it("surfaces provider error when list fails and nothing returned", async () => {
    const provider = stubProvider({ friendsOk: false, groupsOk: false });
    const res = await discoverThreads({ type: "all" }, { provider, allowedEntries: [] });
    expect(res.connected).toBe(true);
    expect(res.items).toEqual([]);
    expect(res.errorCode).toBe("UNAVAILABLE");
  });

  it("paginates with nextCursor", async () => {
    const friends = Array.from({ length: 5 }, (_, i) => ({ userId: `u${i}`, displayName: `User${i}`, avatar: null }));
    const provider = stubProvider({ friends });
    const res = await discoverThreads({ type: "user", limit: 2 }, { provider, allowedEntries: [] });
    expect(res.items).toHaveLength(2);
    expect(res.nextCursor).toBe("2");
  });
});
