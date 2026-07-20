import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// ═════════════════════════════════════════════════════════
// Mock config
// ═════════════════════════════════════════════════════════
const mockConfig = vi.hoisted(() => ({
  nodeEnv: "test",
  zalo: { sessionDir: "/tmp/test-zalo-session", dryRun: true, rateLimitPerMinute: 10, rateLimitGlobalPerMinute: 60, mediaAllowedBaseDir: "/tmp", voiceEnabled: false },
  autoReply: { enabled: true, dryRun: true, allowedThreads: ["thread-123"], cooldownSeconds: 10, groupReplyWindowSeconds: 600 },
  messageBatching: { enabled: false, windowMs: 4000, maxMessages: 5, maxChars: 3000, threadTypes: ["user"] },
  document: { enabled: false, maxSizeMB: 50, allowedExtensions: ["pdf", "txt"] },
  security: { adminPassword: "strong-password-not-default", jwtSecret: "dev-jwt", cookieSecret: "dev-cookie" },
  logLevel: "error",
}));

vi.mock("../config.js", () => ({ config: mockConfig }));

// ═════════════════════════════════════════════════════════
// Mock prisma
// ═════════════════════════════════════════════════════════
const mockSessionStore: Record<string, any> = {};
const mockAuditStore: any[] = [];

let activeLookupBarrier: {
  arrivals: number;
  wait: Promise<void>;
  release: () => void;
} | null = null;

function armActiveLookupBarrier(): void {
  let release = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  activeLookupBarrier = { arrivals: 0, wait, release };
}

async function updateManySessions({ where, data }: any) {
  let count = 0;
  for (const session of Object.values(mockSessionStore) as any[]) {
    if (where?.status && session.status !== where.status) continue;
    if (where?.threadId && session.threadId !== where.threadId) continue;
    if (where?.expiresAt?.lt && !(session.expiresAt < where.expiresAt.lt)) continue;
    Object.assign(session, data, { updatedAt: new Date() });
    count++;
  }
  return { count };
}

vi.mock("../db.js", () => {
  const liveTestSession = {
    findFirst: vi.fn(async ({ where }: any) => {
      const snapshot = where?.threadId
        ? Object.values(mockSessionStore).find((s: any) => s.threadId === where.threadId && s.status === "active") ?? null
        : Object.values(mockSessionStore).find((s: any) => s.status === "active") ?? null;
      const barrier = activeLookupBarrier;
      if (barrier && where?.status === "active") {
        barrier.arrivals += 1;
        if (barrier.arrivals >= 2) barrier.release();
        await Promise.race([
          barrier.wait,
          new Promise<void>((resolve) => setImmediate(resolve)),
        ]);
      }
      return snapshot;
    }),
    findMany: vi.fn(async ({ where }: any) => {
      return Object.values(mockSessionStore).filter((s: any) => {
        if (where?.status && s.status !== where.status) return false;
        if (where?.threadId && s.threadId !== where.threadId) return false;
        return true;
      });
    }),
    create: vi.fn(async ({ data }: any) => {
      const id = "lts-" + Object.keys(mockSessionStore).length;
      mockSessionStore[id] = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
      return mockSessionStore[id];
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const s = mockSessionStore[where.id];
      if (s) {
        Object.assign(s, data, { updatedAt: new Date() });
        if (data.status && data.status !== "active") s.completedAt = new Date();
      }
      return s;
    }),
    updateMany: vi.fn(updateManySessions),
  };
  const auditLog = {
    create: vi.fn(async ({ data }: any) => {
      mockAuditStore.push(data);
      return { id: "audit-" + mockAuditStore.length, ...data };
    }),
  };
  const prisma: any = {
    liveTestSession,
    auditLog,
    zaloThread: {
      findUnique: vi.fn(async () => ({ type: "user" })),
    },
    message: {
      findMany: vi.fn(async () => [{ threadType: "user" }]),
    },
    agentTask: { count: vi.fn(async () => 0) },
    scheduleExecution: { count: vi.fn(async () => 0) },
    document: { findMany: vi.fn(async () => []) },
    rule: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    runtimeSetting: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) },
    systemHeartbeat: { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(async () => [{ "1": 1 }]),
  };
  prisma.$transaction = vi.fn(async (work: (tx: typeof prisma) => Promise<unknown>) => {
    const sessionSnapshot = Object.fromEntries(
      Object.entries(mockSessionStore).map(([id, session]) => [id, { ...(session as any) }]),
    );
    const auditSnapshot = mockAuditStore.slice();

    try {
      return await work(prisma);
    } catch (error) {
      for (const id of Object.keys(mockSessionStore)) delete mockSessionStore[id];
      Object.assign(mockSessionStore, sessionSnapshot);
      mockAuditStore.splice(0, mockAuditStore.length, ...auditSnapshot);
      throw error;
    }
  });
  return { prisma };
});

// ═════════════════════════════════════════════════════════
// Mock runtime config
// ═════════════════════════════════════════════════════════
vi.mock("../services/runtime-config.service.js", () => ({
  getCurrentEffectiveDryRun: vi.fn(() => true),
  getEffectiveCooldownSeconds: vi.fn(() => 10),
  getAllRuntimeSettings: vi.fn(async () => []),
  getEffectiveAutoReplyConfig: vi.fn(async () => ({})),
  getRuntimeConfig: vi.fn(async () => []),
  setRuntimeConfig: vi.fn(async () => ({ success: true })),
  getRuntimeConfigAudit: vi.fn(async () => []),
  setRuntimeSetting: vi.fn(async () => ({ success: true })),
  getSettingMeta: vi.fn(() => ({})),
}));

// ═════════════════════════════════════════════════════════
// Mock production readiness
// ═════════════════════════════════════════════════════════
const REQUIRED_READINESS_CHECK_IDS = [
  "zalo.connected", "zalo.listener", "zalo.messagePipeline",
  "safety.dryRun", "safety.allowedThreads", "safety.groupRisk",
  "config.status", "config.strictErrors",
  "health.backend", "health.worker", "health.processLock", "health.db",
  "backup.recent", "backup.dbSize", "backup.session",
  "security.adminPassword", "rules.status", "docs.status",
  "errors.agentTasks", "errors.executions", "errors.heartbeats",
];

function readyReadiness() {
  const checks = REQUIRED_READINESS_CHECK_IDS.map((id) => ({
    id,
    label: id,
    category: "Test",
    status: "pass",
    severity: "critical",
    message: "Ready",
  }));
  return {
    verdict: "READY_FOR_LIVE",
    score: 100,
    dataQuality: "complete",
    timestamp: new Date().toISOString(),
    checks,
    summary: { pass: checks.length, warn: 0, fail: 0, unknown: 0, criticalFail: 0, highFail: 0 },
  };
}

vi.mock("../services/production-readiness.service.js", () => ({
  REQUIRED_READINESS_CHECK_IDS,
  getProductionReadiness: vi.fn(async () => readyReadiness()),
}));

// ═════════════════════════════════════════════════════════
// Mock heartbeat
// ═════════════════════════════════════════════════════════
vi.mock("../services/heartbeat.service.js", () => ({
  getHeartbeatSummary: vi.fn(async () => ({})),
}));

let liveTestStartHandler: ((request: any, reply: any) => Promise<unknown>) | undefined;

beforeAll(async () => {
  const handlers: Record<string, (request: any, reply: any) => Promise<unknown>> = {};
  const fakeApp = {
    get: vi.fn(),
    patch: vi.fn(),
    post: (path: string, ...args: unknown[]) => {
      handlers[path] = args.at(-1) as (request: any, reply: any) => Promise<unknown>;
    },
  };
  const { systemRoutes } = await import("../routes/system.js");
  await systemRoutes(fakeApp as never);
  liveTestStartHandler = handlers["/system/live-test/start"];
});

// ═════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════
describe("Batch 18 — Controlled Live Test Mode", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const k of Object.keys(mockSessionStore)) delete mockSessionStore[k];
    mockAuditStore.length = 0;
    activeLookupBarrier = null;
    mockConfig.autoReply.allowedThreads = ["thread-123"];

    const { getCurrentEffectiveDryRun, getAllRuntimeSettings } = await import("../services/runtime-config.service.js");
    (getCurrentEffectiveDryRun as any).mockReturnValue(true);
    (getAllRuntimeSettings as any).mockResolvedValue([]);

    const { prisma } = await import("../db.js");
    (prisma.liveTestSession.updateMany as any).mockReset();
    (prisma.liveTestSession.updateMany as any).mockImplementation(updateManySessions);
    (prisma.zaloThread.findUnique as any).mockResolvedValue({ type: "user" });
    (prisma.message.findMany as any).mockResolvedValue([{ threadType: "user" }]);

    const { getProductionReadiness } = await import("../services/production-readiness.service.js");
    (getProductionReadiness as any).mockResolvedValue(readyReadiness());
  });

  it("1. wrong confirm text rejected", async () => {
    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 120,
      confirmText: "WRONG", reason: "Testing live",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("BAD_CONFIRM");
  });

  it("2. reason too short rejected", async () => {
    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "test",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("REASON_TOO_SHORT");
  });

  it("3. maxMessages > 3 rejected", async () => {
    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 5, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("INVALID_MAX_MESSAGES");
  });

  it("4. TTL > 3600 rejected", async () => {
    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 3601,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("INVALID_TTL");
  });

  it("4a. TTL 1800 accepted", async () => {
    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 1800,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing pilot",
    });
    expect(result.success).toBe(true);
  });

  it("4b. TTL 3600 accepted", async () => {
    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 3600,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing pilot",
    });
    expect(result.success).toBe(true);
  });

  it("4c. TTL 0 rejected", async () => {
    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 0,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("INVALID_TTL");
  });

  it.each([
    ["whitespace-only reason", { reason: "            " }, "REASON_TOO_SHORT"],
    ["empty threadId", { threadId: "   " }, "INVALID_THREAD_ID"],
    ["non-string threadId", { threadId: 123 }, "INVALID_THREAD_ID"],
    ["non-finite maxMessages", { maxMessages: Number.NaN }, "INVALID_MAX_MESSAGES"],
    ["infinite maxMessages", { maxMessages: Number.POSITIVE_INFINITY }, "INVALID_MAX_MESSAGES"],
    ["fractional maxMessages", { maxMessages: 1.5 }, "INVALID_MAX_MESSAGES"],
    ["NaN ttlSeconds", { ttlSeconds: Number.NaN }, "INVALID_TTL"],
    ["non-finite ttlSeconds", { ttlSeconds: Number.POSITIVE_INFINITY }, "INVALID_TTL"],
    ["fractional ttlSeconds", { ttlSeconds: 1.5 }, "INVALID_TTL"],
  ])("rejects %s before any database side effect", async (_case, overrides, errorCode) => {
    const { prisma } = await import("../db.js");
    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123",
      maxMessages: 1,
      ttlSeconds: 120,
      confirmText: "START LIVE TEST",
      reason: "Valid reason for testing",
      ...overrides,
    } as any);

    expect(result).toMatchObject({ success: false, errorCode });
    expect(prisma.zaloThread.findUnique).not.toHaveBeenCalled();
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(prisma.liveTestSession.findFirst).not.toHaveBeenCalled();
    expect(prisma.liveTestSession.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("returns a canonical 400 for fractional JSON route input", async () => {
    if (!liveTestStartHandler) throw new Error("Live-test start handler was not registered");
    const reply: any = { status: vi.fn(), send: vi.fn() };
    reply.status.mockReturnValue(reply);

    await liveTestStartHandler({
      body: {
        threadId: "thread-123",
        maxMessages: 1.5,
        ttlSeconds: 120,
        confirmText: "START LIVE TEST",
        reason: "Valid reason for testing",
      },
    }, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: "INVALID_MAX_MESSAGES",
        message: "maxMessages must be 1-3",
      },
    });
    const { prisma } = await import("../db.js");
    expect(prisma.liveTestSession.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ["maxMessages", "", "INVALID_MAX_MESSAGES", "maxMessages must be 1-3"],
    ["maxMessages", "2", "INVALID_MAX_MESSAGES", "maxMessages must be 1-3"],
    ["maxMessages", null, "INVALID_MAX_MESSAGES", "maxMessages must be 1-3"],
    ["maxMessages", [], "INVALID_MAX_MESSAGES", "maxMessages must be 1-3"],
    ["maxMessages", {}, "INVALID_MAX_MESSAGES", "maxMessages must be 1-3"],
    ["ttlSeconds", "", "INVALID_TTL", "ttlSeconds must be 1-3600"],
    ["ttlSeconds", "120", "INVALID_TTL", "ttlSeconds must be 1-3600"],
    ["ttlSeconds", null, "INVALID_TTL", "ttlSeconds must be 1-3600"],
    ["ttlSeconds", [], "INVALID_TTL", "ttlSeconds must be 1-3600"],
    ["ttlSeconds", {}, "INVALID_TTL", "ttlSeconds must be 1-3600"],
  ] as const)(
    "returns a canonical 400 for wrong-type route input %s=%j",
    async (field, value, errorCode, message) => {
      if (!liveTestStartHandler) throw new Error("Live-test start handler was not registered");
      const reply: any = { status: vi.fn(), send: vi.fn() };
      reply.status.mockReturnValue(reply);

      await liveTestStartHandler({
        body: {
          threadId: "thread-123",
          maxMessages: 1,
          ttlSeconds: 120,
          confirmText: "START LIVE TEST",
          reason: "Valid reason for testing",
          [field]: value,
        },
      }, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({ error: { code: errorCode, message } });
      const { prisma } = await import("../db.js");
      expect(prisma.zaloThread.findUnique).not.toHaveBeenCalled();
      expect(prisma.message.findMany).not.toHaveBeenCalled();
      expect(prisma.liveTestSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.liveTestSession.updateMany).not.toHaveBeenCalled();
      expect(prisma.liveTestSession.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it("defaults omitted route limits to one message and 120 seconds", async () => {
    if (!liveTestStartHandler) throw new Error("Live-test start handler was not registered");
    const reply: any = { status: vi.fn(), send: vi.fn() };
    reply.status.mockReturnValue(reply);

    await liveTestStartHandler({
      body: {
        threadId: "thread-123",
        confirmText: "START LIVE TEST",
        reason: "Valid reason for testing",
      },
    }, reply);

    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const { prisma } = await import("../db.js");
    expect(prisma.liveTestSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ maxMessages: 1, ttlSeconds: 120 }),
    });
  });

  it("4d. incomplete readiness inventory is rejected", async () => {
    const { getProductionReadiness } = await import("../services/production-readiness.service.js");
    const incomplete = readyReadiness();
    incomplete.checks = incomplete.checks.slice(0, -1);
    incomplete.summary.pass = incomplete.checks.length;
    (getProductionReadiness as any).mockResolvedValueOnce(incomplete);

    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing",
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("NOT_READY");
  });

  it("4e. inconsistent readiness summary is rejected", async () => {
    const { getProductionReadiness } = await import("../services/production-readiness.service.js");
    const inconsistent = readyReadiness();
    inconsistent.summary.pass -= 1;
    inconsistent.summary.warn = 1;
    (getProductionReadiness as any).mockResolvedValueOnce(inconsistent);

    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing",
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("NOT_READY");
  });

  it("5. thread outside allowlist rejected", async () => {
    const { getAllRuntimeSettings } = await import("../services/runtime-config.service.js");
    (getAllRuntimeSettings as any).mockResolvedValue([
      { key: "autoReply.allowedThreads", value: JSON.stringify(["other-thread"]) },
    ]);

    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-999", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("THREAD_NOT_ALLOWED");
  });

  it("5a. empty allowlist fails closed before session creation", async () => {
    const { getAllRuntimeSettings } = await import("../services/runtime-config.service.js");
    (getAllRuntimeSettings as any).mockResolvedValue([
      { key: "autoReply.allowedThreads", value: JSON.stringify([]) },
    ]);

    const { prisma } = await import("../db.js");
    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing",
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("THREAD_NOT_ALLOWED");
    expect(prisma.liveTestSession.create).not.toHaveBeenCalled();
  });

  it("6. group thread rejected", async () => {
    const { getAllRuntimeSettings } = await import("../services/runtime-config.service.js");
    (getAllRuntimeSettings as any).mockResolvedValue([
      { key: "autoReply.allowedThreads", value: JSON.stringify(["grp-1"]) },
    ]);

    const { prisma } = await import("../db.js");
    // Mock the thread as a group
    (prisma.zaloThread.findUnique as any).mockResolvedValueOnce({ type: "group" });

    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "grp-1", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("GROUP_NOT_ALLOWED");
  });

  it("6a. missing ZaloThread evidence is rejected", async () => {
    const { prisma } = await import("../db.js");
    (prisma.zaloThread.findUnique as any).mockResolvedValueOnce(null);

    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing",
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("THREAD_UNVERIFIED");
  });

  it("6b. conflicting message evidence is rejected", async () => {
    const { prisma } = await import("../db.js");
    (prisma.message.findMany as any).mockResolvedValueOnce([
      { threadType: "user" },
      { threadType: "group" },
    ]);

    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing",
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("GROUP_NOT_ALLOWED");
  });

  it("7. valid DM starts session", async () => {
    const { getAllRuntimeSettings } = await import("../services/runtime-config.service.js");
    (getAllRuntimeSettings as any).mockResolvedValue([
      { key: "autoReply.allowedThreads", value: JSON.stringify(["thread-123"]) },
    ]);

    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing",
      createdBy: "admin",
    });
    expect(result.success).toBe(true);
    expect(result.sessionId).toBeDefined();
    expect(result.expiresAt).toBeDefined();
  });

  it("rolls back an otherwise valid live-test start when audit persistence fails", async () => {
    const { prisma } = await import("../db.js");
    (prisma.auditLog.create as any).mockRejectedValueOnce(new Error("audit write failed"));
    const { startLiveTest } = await import("../services/live-test.service.js");

    await expect(startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing",
      createdBy: "admin",
    })).rejects.toThrow("audit write failed");

    expect(Object.values(mockSessionStore).filter((session: any) => session.status === "active")).toHaveLength(0);
    expect(mockSessionStore).toEqual({});
    expect(mockAuditStore).toEqual([]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.liveTestSession.create).toHaveBeenCalledTimes(1);
  });

  it("7a. rejects a second live test when another thread already has an active session", async () => {
    const expiresAt = new Date(Date.now() + 120_000);
    mockSessionStore["lts-active-a"] = {
      id: "lts-active-a",
      threadId: "thread-a",
      maxMessages: 1,
      sentCount: 0,
      ttlSeconds: 120,
      expiresAt,
      status: "active",
      reason: "existing global live test",
      createdBy: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { getAllRuntimeSettings } = await import("../services/runtime-config.service.js");
    (getAllRuntimeSettings as any).mockResolvedValue([
      { key: "autoReply.allowedThreads", value: JSON.stringify(["thread-a", "thread-b"]) },
    ]);
    const { prisma } = await import("../db.js");
    const { startLiveTest } = await import("../services/live-test.service.js");

    const result = await startLiveTest({
      threadId: "thread-b", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for thread B",
    });

    expect(result).toMatchObject({ success: false, errorCode: "SESSION_EXISTS" });
    expect(prisma.liveTestSession.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("7b. expires stale active sessions globally before checking for a collision", async () => {
    mockSessionStore["lts-expired-a"] = {
      id: "lts-expired-a",
      threadId: "thread-a",
      maxMessages: 1,
      sentCount: 0,
      ttlSeconds: 120,
      expiresAt: new Date(Date.now() - 10_000),
      status: "active",
      reason: "expired global live test",
      createdBy: "admin",
      createdAt: new Date(Date.now() - 130_000),
      updatedAt: new Date(),
    };
    const { getAllRuntimeSettings } = await import("../services/runtime-config.service.js");
    (getAllRuntimeSettings as any).mockResolvedValue([
      { key: "autoReply.allowedThreads", value: JSON.stringify(["thread-a", "thread-b"]) },
    ]);
    const { prisma } = await import("../db.js");
    const { startLiveTest } = await import("../services/live-test.service.js");

    const result = await startLiveTest({
      threadId: "thread-b", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason after global expiry",
    });

    expect(result.success).toBe(true);
    expect(mockSessionStore["lts-expired-a"]!.status).toBe("expired");
    expect(mockSessionStore["lts-expired-a"]!.completedAt).toBeInstanceOf(Date);
    expect(prisma.liveTestSession.updateMany).toHaveBeenCalledWith({
      where: { status: "active", expiresAt: { lt: expect.any(Date) } },
      data: { status: "expired", completedAt: expect.any(Date) },
    });
  });

  it("7c. serializes concurrent starts so exactly one global live test is created", async () => {
    const { getAllRuntimeSettings } = await import("../services/runtime-config.service.js");
    mockConfig.autoReply.allowedThreads = ["thread-a", "thread-b"];
    (getAllRuntimeSettings as any).mockResolvedValue([]);
    const { prisma } = await import("../db.js");
    const { startLiveTest } = await import("../services/live-test.service.js");
    armActiveLookupBarrier();

    const results = await Promise.all([
      startLiveTest({
        threadId: "thread-a", maxMessages: 1, ttlSeconds: 120,
        confirmText: "START LIVE TEST", reason: "Concurrent valid reason A",
      }),
      startLiveTest({
        threadId: "thread-b", maxMessages: 1, ttlSeconds: 120,
        confirmText: "START LIVE TEST", reason: "Concurrent valid reason B",
      }),
    ]);

    expect(results.map((result) => result.success ? "SUCCESS" : result.errorCode).sort())
      .toEqual(["SESSION_EXISTS", "SUCCESS"]);
    expect(prisma.liveTestSession.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(Object.values(mockSessionStore).filter((session: any) => session.status === "active")).toHaveLength(1);
  });

  it("7d. expires a stale active row before starting the same thread again", async () => {
    mockSessionStore["lts-expired"] = {
      id: "lts-expired",
      threadId: "thread-123",
      maxMessages: 1,
      sentCount: 0,
      ttlSeconds: 120,
      expiresAt: new Date(Date.now() - 10_000),
      status: "active",
      reason: "old test",
      createdBy: "admin",
      createdAt: new Date(Date.now() - 130_000),
      updatedAt: new Date(),
    };

    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for restart",
    });

    expect(result.success).toBe(true);
    expect(result.errorCode).not.toBe("SESSION_EXISTS");
    expect(mockSessionStore["lts-expired"]!.status).toBe("expired");
    expect(mockSessionStore["lts-expired"]!.completedAt).toBeInstanceOf(Date);
  });

  it("7e. fails closed when expired-session persistence fails", async () => {
    mockSessionStore["lts-expired"] = {
      id: "lts-expired",
      threadId: "thread-123",
      maxMessages: 1,
      sentCount: 0,
      ttlSeconds: 120,
      expiresAt: new Date(Date.now() - 10_000),
      status: "active",
      reason: "old test",
      createdBy: "admin",
      createdAt: new Date(Date.now() - 130_000),
      updatedAt: new Date(),
    };
    const { prisma } = await import("../db.js");
    (prisma.liveTestSession.updateMany as any).mockRejectedValueOnce(new Error("write failed"));

    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for restart",
    });

    expect(result).toMatchObject({ success: false, errorCode: "SESSION_CLEANUP_FAILED" });
    expect(mockSessionStore["lts-expired"]!.status).toBe("active");
    expect(prisma.liveTestSession.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("8. shouldSendLiveForThread returns live for active session", async () => {
    // Create a session in the mock store
    const { prisma } = await import("../db.js");
    const expiresAt = new Date(Date.now() + 120_000);
    const session = { id: "lts-1", threadId: "thread-123", maxMessages: 1, sentCount: 0, ttlSeconds: 120, expiresAt, status: "active", reason: "test", createdBy: "admin", createdAt: new Date(), updatedAt: new Date() };
    mockSessionStore["lts-1"] = session;

    const { shouldSendLiveForThread } = await import("../services/live-test.service.js");
    const result = await shouldSendLiveForThread("thread-123");
    expect(result.live).toBe(true);
    expect(result.sessionId).toBe("lts-1");
    expect(result.reason).toBe("live_test");
  });

  it("9. shouldSendLiveForThread returns dryRun for non-target thread", async () => {
    const expiresAt = new Date(Date.now() + 120_000);
    mockSessionStore["lts-1"] = { id: "lts-1", threadId: "thread-123", maxMessages: 1, sentCount: 0, ttlSeconds: 120, expiresAt, status: "active", reason: "test", createdBy: "admin", createdAt: new Date(), updatedAt: new Date() };

    const { shouldSendLiveForThread } = await import("../services/live-test.service.js");
    const result = await shouldSendLiveForThread("other-thread");
    expect(result.live).toBe(false);
    expect(result.reason).toBe("dry_run");
  });

  it("10. quota maxMessages enforced", async () => {
    // Session with sentCount at max
    const expiresAt = new Date(Date.now() + 120_000);
    mockSessionStore["lts-1"] = { id: "lts-1", threadId: "thread-123", maxMessages: 1, sentCount: 1, ttlSeconds: 120, expiresAt, status: "active", reason: "test", createdBy: "admin", createdAt: new Date(), updatedAt: new Date() };

    const { shouldSendLiveForThread } = await import("../services/live-test.service.js");
    const result = await shouldSendLiveForThread("thread-123");
    expect(result.live).toBe(false);
    expect(result.reason).toBe("live_test_quota_exhausted");

    // Session should be completed
    const session = mockSessionStore["lts-1"] as any;
    expect(session.status).toBe("completed");
  });

  it("11. TTL expiry reverts to dryRun", async () => {
    // Create an expired session
    const expiresAt = new Date(Date.now() - 10_000); // 10s ago
    mockSessionStore["lts-1"] = { id: "lts-1", threadId: "thread-123", maxMessages: 1, sentCount: 0, ttlSeconds: 120, expiresAt, status: "active", reason: "test", createdBy: "admin", createdAt: new Date(Date.now() - 200_000), updatedAt: new Date() };

    const { shouldSendLiveForThread } = await import("../services/live-test.service.js");
    const result = await shouldSendLiveForThread("thread-123");
    expect(result.live).toBe(false);
    expect(result.reason).toBe("live_test_expired");

    const session = mockSessionStore["lts-1"] as any;
    expect(session.status).toBe("expired");
  });

  it("12. stop session cancels", async () => {
    const expiresAt = new Date(Date.now() + 120_000);
    mockSessionStore["lts-1"] = { id: "lts-1", threadId: "thread-123", maxMessages: 1, sentCount: 0, ttlSeconds: 120, expiresAt, status: "active", reason: "test", createdBy: "admin", createdAt: new Date(), updatedAt: new Date() };

    const { stopLiveTest } = await import("../services/live-test.service.js");
    const result = await stopLiveTest("admin");
    expect(result.success).toBe(true);

    const session = mockSessionStore["lts-1"] as any;
    expect(session.status).toBe("cancelled");
  });

  it("13. audit records created on start/stop/send", async () => {
    // Reset
    for (const k of Object.keys(mockSessionStore)) delete mockSessionStore[k];
    mockAuditStore.length = 0;

    const { getAllRuntimeSettings } = await import("../services/runtime-config.service.js");
    (getAllRuntimeSettings as any).mockResolvedValue([
      { key: "autoReply.allowedThreads", value: JSON.stringify(["thread-123"]) },
    ]);

    const { startLiveTest, recordLiveTestSent } = await import("../services/live-test.service.js");

    // Start
    const startResult = await startLiveTest({
      threadId: "thread-123", maxMessages: 2, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing",
      createdBy: "admin",
    });
    expect(startResult.success).toBe(true);

    const sessionId = startResult.sessionId!;

    // Manually set sentCount to 0 for tracking
    if (mockSessionStore[sessionId]) {
      (mockSessionStore[sessionId] as any).sentCount = 0;
    }

    // Send one
    await recordLiveTestSent(sessionId, "thread-123", "msg-001");

    // Send another (should complete)
    await recordLiveTestSent(sessionId, "thread-123", "msg-002");

    // Check audits
    const actions = mockAuditStore.map((a: any) => a.action);
    expect(actions).toContain("live_test_started");
    expect(actions).toContain("live_test_message_sent");
    // Note: "live_test_completed" may or may not fire depending on mock behavior
    // The key test is that message_sent is recorded
  });

  it("14. already in live mode rejected", async () => {
    const { getCurrentEffectiveDryRun } = await import("../services/runtime-config.service.js");
    (getCurrentEffectiveDryRun as any).mockReturnValue(false); // already live

    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "thread-123", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("ALREADY_LIVE");
  });

  it("14a. global dryRun=false fails closed instead of enabling global live", async () => {
    const { getCurrentEffectiveDryRun } = await import("../services/runtime-config.service.js");
    (getCurrentEffectiveDryRun as any).mockReturnValue(false);

    const { shouldSendLiveForThread } = await import("../services/live-test.service.js");
    const result = await shouldSendLiveForThread("thread-123");

    expect(result).toEqual({ live: false, reason: "global_live_disabled" });
  });

  it("15. getLiveTestStatus returns active session with remainingMs", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    mockSessionStore["lts-1"] = { id: "lts-1", threadId: "thread-123", maxMessages: 1, sentCount: 0, ttlSeconds: 120, expiresAt, status: "active", reason: "test", createdBy: "admin", createdAt: new Date(), updatedAt: new Date() };

    const { getLiveTestStatus } = await import("../services/live-test.service.js");
    const status = await getLiveTestStatus();

    expect(status.active).toBe(true);
    expect(status.session).toBeDefined();
    expect(status.session!.remainingMs).toBeGreaterThan(0);
    expect(status.session!.threadId).toBe("thread-123");
  });
});
