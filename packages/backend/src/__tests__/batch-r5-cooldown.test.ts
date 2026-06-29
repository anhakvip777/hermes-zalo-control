// =============================================================================
// R5 — Cooldown Single-Store Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma client (hoisted-safe via inline factory) ──────────
// Store mock refs in hoisted scope so tests can configure behavior.

const { mockTcd } = vi.hoisted(() => {
  const tcd = {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    findMany: vi.fn().mockResolvedValue([]),
  };
  return { mockTcd: tcd };
});

vi.mock("../db.js", () => ({
  prisma: {
    threadCooldown: mockTcd,
    $transaction: vi.fn((fn: any) => fn({ threadCooldown: mockTcd })),
  },
}));

// ── Mock runtime config for cooldown seconds ──────────────────────

vi.mock("../services/runtime-config.service.js", async () => {
  const actual = await vi.importActual("../services/runtime-config.service.js") as any;
  return {
    ...actual,
    getEffectiveCooldownSeconds: vi.fn(() => 10),
    getCurrentEffectiveDryRun: vi.fn(() => true),
  };
});

// ── Imports after mocks ────────────────────────────────────────────

import {
  acquireCooldown,
  setCooldown,
  clearCooldown,
  clearAllCooldowns,
  getActiveCooldowns,
  isInCooldown,
  pruneExpiredCooldowns,
} from "../services/cooldown.service.js";

// =============================================================================
// CooldownService unit tests
// =============================================================================

describe("CooldownService — acquireCooldown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no row → returns true (acquired)", async () => {
    mockTcd.findUnique.mockResolvedValue(null);
    mockTcd.upsert.mockResolvedValue({});

    const result = await acquireCooldown("thread-1");

    expect(result).toBe(true);
    expect(mockTcd.upsert).toHaveBeenCalledTimes(1);
  });

  it("active row (not expired) → returns false (blocked)", async () => {
    const futureDate = new Date(Date.now() + 30_000);
    mockTcd.findUnique.mockResolvedValue({
      id: "c1", threadId: "thread-1", lastReplyAt: new Date(), expiresAt: futureDate,
    });

    const result = await acquireCooldown("thread-2");

    expect(result).toBe(false);
    expect(mockTcd.upsert).not.toHaveBeenCalled();
  });

  it("expired row → returns true (re-acquired)", async () => {
    const pastDate = new Date(Date.now() - 30_000);
    mockTcd.findUnique.mockResolvedValue({
      id: "c1", threadId: "thread-1", lastReplyAt: pastDate, expiresAt: pastDate,
    });
    mockTcd.upsert.mockResolvedValue({});

    const result = await acquireCooldown("thread-3");

    expect(result).toBe(true);
    expect(mockTcd.upsert).toHaveBeenCalledTimes(1);
  });

  it("first acquire → true, second (same thread, unexpired) → false", async () => {
    mockTcd.findUnique.mockResolvedValueOnce(null);
    mockTcd.upsert.mockResolvedValue({});

    const r1 = await acquireCooldown("thread-4");
    expect(r1).toBe(true);

    const futureDate = new Date(Date.now() + 30_000);
    mockTcd.findUnique.mockResolvedValueOnce({
      id: "c1", threadId: "thread-4", lastReplyAt: new Date(), expiresAt: futureDate,
    });

    const r2 = await acquireCooldown("thread-4");
    expect(r2).toBe(false);
  });
});

// =============================================================================

describe("CooldownService — setCooldown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts cooldown row", async () => {
    mockTcd.upsert.mockResolvedValue({});

    await setCooldown("thread-1");

    expect(mockTcd.upsert).toHaveBeenCalledTimes(1);
    const call = mockTcd.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ threadId: "thread-1" });
  });
});

// =============================================================================

describe("CooldownService — clear / reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clearCooldown deletes specific thread", async () => {
    mockTcd.deleteMany.mockResolvedValue({ count: 1 });

    await clearCooldown("thread-1");

    expect(mockTcd.deleteMany).toHaveBeenCalledWith({
      where: { threadId: "thread-1" },
    });
  });

  it("clearAllCooldowns deletes all rows", async () => {
    mockTcd.deleteMany.mockResolvedValue({ count: 5 });

    await clearAllCooldowns();

    expect(mockTcd.deleteMany).toHaveBeenCalledWith();
  });
});

// =============================================================================

describe("CooldownService — isInCooldown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no row → false", async () => {
    mockTcd.findUnique.mockResolvedValue(null);
    expect(await isInCooldown("t1")).toBe(false);
  });

  it("active row → true", async () => {
    mockTcd.findUnique.mockResolvedValue({
      id: "c1", threadId: "t1", lastReplyAt: new Date(),
      expiresAt: new Date(Date.now() + 30_000),
    });
    expect(await isInCooldown("t1")).toBe(true);
  });

  it("expired row → false", async () => {
    const past = new Date(Date.now() - 30_000);
    mockTcd.findUnique.mockResolvedValue({
      id: "c1", threadId: "t1", lastReplyAt: past, expiresAt: past,
    });
    expect(await isInCooldown("t1")).toBe(false);
  });
});

// =============================================================================

describe("CooldownService — getActiveCooldowns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only unexpired rows", async () => {
    mockTcd.findMany.mockResolvedValue([
      { threadId: "t1", lastReplyAt: new Date(), expiresAt: new Date(Date.now() + 5000) },
    ]);

    const result = await getActiveCooldowns();
    expect(result).toHaveLength(1);
    expect(result[0].threadId).toBe("t1");
  });
});

// =============================================================================

describe("CooldownService — pruneExpiredCooldowns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes expired rows", async () => {
    mockTcd.deleteMany.mockResolvedValue({ count: 3 });
    expect(await pruneExpiredCooldowns()).toBe(3);
  });
});
