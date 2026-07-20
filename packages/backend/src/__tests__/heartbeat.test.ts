import { describe, it, expect, afterAll } from "vitest";
import {
  heartbeat,
  heartbeatOk,
  heartbeatError,
  getAllHeartbeats,
  getHeartbeatSummary,
  checkAndMarkStale,
  HEARTBEAT_KEYS,
} from "../services/heartbeat.service.js";
import { prisma } from "../db.js";

describe("Heartbeat — record", () => {
  afterAll(async () => {
    await prisma.systemHeartbeat.deleteMany();
  });

  it("heartbeatOk creates a record", async () => {
    await heartbeatOk("test-worker", { version: "1.0" });
    const row = await prisma.systemHeartbeat.findUnique({
      where: { name: "test-worker" },
    });
    expect(row).not.toBeNull();
    expect(row!.status).toBe("ok");
    expect(row!.lastBeatAt).not.toBeNull();
  });

  it("heartbeatError records error status", async () => {
    await heartbeatError("test-broken", "Connection refused", { code: "ECONNREFUSED" });
    const row = await prisma.systemHeartbeat.findUnique({
      where: { name: "test-broken" },
    });
    expect(row).not.toBeNull();
    expect(row!.status).toBe("down");
    expect(row!.lastError).toContain("Connection refused");
  });

  it("heartbeat updates existing record", async () => {
    await heartbeatOk("test-worker", { version: "2.0" });
    const row = await prisma.systemHeartbeat.findUnique({
      where: { name: "test-worker" },
    });
    expect(row!.metadata).toContain("2.0");
    expect(row!.status).toBe("ok");
  });

  it("heartbeat with status 'stale' records correctly", async () => {
    await heartbeat("test-stale", "stale", { error: "Timed out" });
    const row = await prisma.systemHeartbeat.findUnique({
      where: { name: "test-stale" },
    });
    expect(row!.status).toBe("stale");
  });
});

describe("Heartbeat — getAllHeartbeats", () => {
  afterAll(async () => {
    await prisma.systemHeartbeat.deleteMany();
  });

  it("returns all known keys (defaults to 'down' if missing)", async () => {
    const result = await getAllHeartbeats();
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("items");
    expect(result.items.length).toBeGreaterThanOrEqual(HEARTBEAT_KEYS.length);
  });

  it("returns ok status when all critical heartbeats present", async () => {
    // Set ALL known keys to ok
    await heartbeatOk("backend", { pid: 9999 });
    await heartbeatOk("zaloConnection", { connected: true });
    await heartbeatOk("zaloListener", { listenerStarted: true });
    await heartbeatOk("schedulerWorker", { provider: "test" });
    await heartbeatOk("messagePipeline", { lastMessageAt: new Date().toISOString() });
    const result = await getAllHeartbeats();
    expect(result.status).toBe("ok");
    const backend = result.items.find((i) => i.name === "backend");
    expect(backend).toBeDefined();
    expect(backend!.status).toBe("ok");
  });

  it("missing heartbeats return as 'No heartbeat recorded yet'", async () => {
    // Note: previous tests may have set heartbeats, so we check
    // that keys not explicitly set have proper defaults
    await prisma.systemHeartbeat.deleteMany();
    const result = await getAllHeartbeats();
    // All keys should be "down" since nothing was recorded
    const allDown = result.items.every((i) => i.status === "down");
    expect(allDown).toBe(true);
  });
});

describe("Heartbeat — getHeartbeatSummary", () => {
  afterAll(async () => {
    await prisma.systemHeartbeat.deleteMany();
  });

  it("returns all keys with status", async () => {
    await heartbeatOk("backend", { pid: 1 });
    const summary = await getHeartbeatSummary();
    expect(summary).toHaveProperty("backend");
    expect(summary.backend!.status).toBe("ok");
    expect(summary).toHaveProperty("zaloListener");
    expect(summary).toHaveProperty("schedulerWorker");
    expect(summary).toHaveProperty("messagePipeline");
  });

  it("ageSeconds is calculated", async () => {
    await heartbeatOk("backend", { pid: 2 });
    const summary = await getHeartbeatSummary();
    expect(typeof summary.backend!.ageSeconds).toBe("number");
    expect(summary.backend!.ageSeconds!).toBeGreaterThanOrEqual(0);
  });

  it("metadata is parsed from JSON", async () => {
    await heartbeatOk("backend", { pid: 42, env: "test" });
    const summary = await getHeartbeatSummary();
    expect(summary.backend!.metadata).toEqual({ pid: 42, env: "test" });
  });
});

describe("Heartbeat — stale detection", () => {
  afterAll(async () => {
    await prisma.systemHeartbeat.deleteMany();
  });

  it("checkAndMarkStale marks old heartbeats as stale", async () => {
    // Create a fake old heartbeat using a known key
    const oldDate = new Date(Date.now() - 120 * 1000); // 120s ago
    await prisma.systemHeartbeat.create({
      data: {
        name: "schedulerWorker",
        status: "ok",
        lastBeatAt: oldDate,
      },
    });

    const marked = await checkAndMarkStale();
    expect(marked).toBeGreaterThanOrEqual(1);

    const row = await prisma.systemHeartbeat.findUnique({
      where: { name: "schedulerWorker" },
    });
    expect(row!.status).toBe("stale");
  });

  it("getAllHeartbeats derives stale status without mutating the stored row", async () => {
    const oldDate = new Date(Date.now() - 120 * 1000);
    await prisma.systemHeartbeat.upsert({
      where: { name: "schedulerWorker" },
      create: { name: "schedulerWorker", status: "ok", lastBeatAt: oldDate },
      update: { status: "ok", lastBeatAt: oldDate },
    });

    const result = await getAllHeartbeats();
    const stale = result.items.find((i) => i.name === "schedulerWorker");
    expect(stale).toBeDefined();
    expect(stale!.status).toBe("stale");

    const persisted = await prisma.systemHeartbeat.findUnique({ where: { name: "schedulerWorker" } });
    expect(persisted!.status).toBe("ok");
  });
});

describe("Heartbeat — no secrets leaked", () => {
  afterAll(async () => {
    await prisma.systemHeartbeat.deleteMany();
  });

  it("heartbeat metadata is stored and retrievable", async () => {
    // Metadata is developer-controlled — api keys shouldn't be passed here
    await heartbeatOk("backend", { env: "test", version: "1.0" });
    const summary = await getHeartbeatSummary();
    expect(summary.backend!.metadata).toEqual({ env: "test", version: "1.0" });
  });

  it("getAllHeartbeats response has no secrets", async () => {
    const result = await getAllHeartbeats();
    const json = JSON.stringify(result);
    expect(json).not.toContain("password");
    expect(json).not.toContain("ADMIN_PASSWORD");
  });
});
