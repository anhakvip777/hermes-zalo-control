// =============================================================================
// T1 — Thread Display Name / ThreadProfile Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma client ──────────────────────────────────────────────

const { mockThreadProfile } = vi.hoisted(() => {
  const tp = {
    upsert: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  };
  return { mockThreadProfile: tp };
});

vi.mock("../db.js", () => ({
  prisma: {
    threadProfile: mockThreadProfile,
  },
}));

// ── Imports after mocks ────────────────────────────────────────────

import {
  upsertThreadProfileFromMessage,
  getThreadProfile,
  getThreadProfiles,
  resolveDisplayName,
} from "../services/thread-profile.service.js";

// =============================================================================
// upsertThreadProfileFromMessage — display name resolution rules
// =============================================================================

describe("ThreadProfile — upsertThreadProfileFromMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockThreadProfile.upsert.mockResolvedValue({});
  });

  // ── DM: senderName → displayName ──────────────────────────────

  it("DM inbound có senderName → ThreadProfile.displayName = senderName", async () => {
    mockThreadProfile.upsert.mockResolvedValue({});

    await upsertThreadProfileFromMessage({
      threadId: "dm-123",
      threadType: "user",
      senderName: "Anh Việt",
      threadName: null,
    });

    expect(mockThreadProfile.upsert).toHaveBeenCalledTimes(1);
    const [callArgs] = mockThreadProfile.upsert.mock.calls[0] as any[];
    expect(callArgs.create.displayName).toBe("Anh Việt");
    expect(callArgs.create.source).toBe("zalo_event_user");
  });

  // ── DM: fallback to threadName if no senderName ─────────────────

  it("DM không có senderName → fallback to threadName", async () => {
    await upsertThreadProfileFromMessage({
      threadId: "dm-456",
      threadType: "user",
      senderName: null,
      threadName: "User Display",
    });

    const [callArgs] = mockThreadProfile.upsert.mock.calls[0] as any[];
    expect(callArgs.create.displayName).toBe("User Display");
  });

  // ── DM: null if neither present ────────────────────────────────

  it("DM không có cả senderName lẫn threadName → displayName = null, không crash", async () => {
    await upsertThreadProfileFromMessage({
      threadId: "dm-789",
      threadType: "user",
      senderName: null,
      threadName: null,
    });

    const [callArgs] = mockThreadProfile.upsert.mock.calls[0] as any[];
    expect(callArgs.create.displayName).toBeNull();
  });

  // ── Group: threadName → displayName ───────────────────────────

  it("group inbound có threadName → ThreadProfile.displayName = threadName", async () => {
    await upsertThreadProfileFromMessage({
      threadId: "grp-123",
      threadType: "group",
      senderName: "Member A",
      threadName: "Nhà Chung Nam",
    });

    const [callArgs] = mockThreadProfile.upsert.mock.calls[0] as any[];
    expect(callArgs.create.displayName).toBe("Nhà Chung Nam");
    expect(callArgs.create.source).toBe("zalo_event_group");
  });

  // ── Group: NEVER use senderName as group name ─────────────────

  it("group chỉ có senderName, không có threadName → KHÔNG lấy senderName làm group name", async () => {
    await upsertThreadProfileFromMessage({
      threadId: "grp-456",
      threadType: "group",
      senderName: "Member B",
      threadName: null,
    });

    const [callArgs] = mockThreadProfile.upsert.mock.calls[0] as any[];
    // SenderName must NOT be used as group display name
    expect(callArgs.create.displayName).toBeNull();
  });

  // ── Empty/whitespace strings treated as missing ──────────────

  it("senderName là chuỗi rỗng → treated as missing (displayName = null)", async () => {
    await upsertThreadProfileFromMessage({
      threadId: "dm-empty",
      threadType: "user",
      senderName: "   ",
      threadName: null,
    });

    const [callArgs] = mockThreadProfile.upsert.mock.calls[0] as any[];
    expect(callArgs.create.displayName).toBeNull();
  });

  // ── Prisma error does not throw (non-blocking) ───────────────

  it("Prisma upsert throws → không crash (non-blocking)", async () => {
    mockThreadProfile.upsert.mockRejectedValue(new Error("DB down"));

    // Must not throw
    await expect(
      upsertThreadProfileFromMessage({
        threadId: "any",
        threadType: "user",
        senderName: "Test",
        threadName: null,
      }),
    ).resolves.toBeUndefined();
  });
});

// =============================================================================
// getThreadProfile / resolveDisplayName
// =============================================================================

describe("ThreadProfile — getThreadProfile / resolveDisplayName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getThreadProfile returns profile when found", async () => {
    mockThreadProfile.findUnique.mockResolvedValue({
      threadId: "dm-1",
      displayName: "Anh Việt",
      threadType: "user",
      avatarUrl: null,
    });

    const profile = await getThreadProfile("dm-1");
    expect(profile).not.toBeNull();
    expect(profile!.displayName).toBe("Anh Việt");
  });

  it("getThreadProfile returns null when not found", async () => {
    mockThreadProfile.findUnique.mockResolvedValue(null);

    const profile = await getThreadProfile("unknown");
    expect(profile).toBeNull();
  });

  it("getThreadProfile returns null on DB error (non-blocking)", async () => {
    mockThreadProfile.findUnique.mockRejectedValue(new Error("DB down"));

    const profile = await getThreadProfile("any");
    expect(profile).toBeNull();
  });

  it("resolveDisplayName returns display name string", async () => {
    mockThreadProfile.findUnique.mockResolvedValue({
      threadId: "dm-1",
      displayName: "Anh Việt",
    });

    const name = await resolveDisplayName("dm-1");
    expect(name).toBe("Anh Việt");
  });

  it("resolveDisplayName returns null when no profile", async () => {
    mockThreadProfile.findUnique.mockResolvedValue(null);

    const name = await resolveDisplayName("unknown");
    expect(name).toBeNull();
  });

  it("resolveDisplayName returns null on DB error", async () => {
    mockThreadProfile.findUnique.mockRejectedValue(new Error("DB down"));

    const name = await resolveDisplayName("any");
    expect(name).toBeNull();
  });
});

// =============================================================================
// getThreadProfiles — batch fetch
// =============================================================================

describe("ThreadProfile — getThreadProfiles (batch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty Map for empty input", async () => {
    const map = await getThreadProfiles([]);
    expect(map.size).toBe(0);
    expect(mockThreadProfile.findMany).not.toHaveBeenCalled();
  });

  it("returns Map<threadId, {displayName, threadType, avatarUrl}>", async () => {
    mockThreadProfile.findMany.mockResolvedValue([
      { threadId: "dm-1", displayName: "Alice", threadType: "user", avatarUrl: null },
      { threadId: "grp-2", displayName: "Team A", threadType: "group", avatarUrl: "https://..." },
    ]);

    const map = await getThreadProfiles(["dm-1", "grp-2"]);
    expect(map.size).toBe(2);
    expect(map.get("dm-1")!.displayName).toBe("Alice");
    expect(map.get("grp-2")!.displayName).toBe("Team A");
    expect(map.get("grp-2")!.avatarUrl).toBe("https://...");
  });

  it("missing threadId → not in map", async () => {
    mockThreadProfile.findMany.mockResolvedValue([
      { threadId: "dm-1", displayName: "Alice", threadType: "user", avatarUrl: null },
    ]);

    const map = await getThreadProfiles(["dm-1", "grp-unknown"]);
    expect(map.size).toBe(1);
    expect(map.has("dm-1")).toBe(true);
    expect(map.has("grp-unknown")).toBe(false);
  });

  it("returns empty Map on DB error", async () => {
    mockThreadProfile.findMany.mockRejectedValue(new Error("DB down"));

    const map = await getThreadProfiles(["dm-1"]);
    expect(map.size).toBe(0);
  });

  it("deduplicates input threadIds", async () => {
    mockThreadProfile.findMany.mockResolvedValue([
      { threadId: "dm-1", displayName: "Alice", threadType: "user", avatarUrl: null },
    ]);

    await getThreadProfiles(["dm-1", "dm-1", "dm-1"]);
    // Unique IDs passed to findMany
    const callArgs = mockThreadProfile.findMany.mock.calls[0][0] as any;
    expect(callArgs.where.threadId.in).toEqual(["dm-1"]);
  });
});
