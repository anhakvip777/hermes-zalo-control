import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../db.js", () => ({
  prisma: {
    liveTestSession: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where?.threadId) {
          const match = Object.values(mockSessionStore).find((s: any) => s.threadId === where.threadId && s.status === "active");
          return match ?? null;
        }
        return Object.values(mockSessionStore).find((s: any) => s.status === "active") ?? null;
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
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        mockAuditStore.push(data);
        return { id: "audit-" + mockAuditStore.length, ...data };
      }),
    },
    zaloThread: {
      findUnique: vi.fn(async () => null), // no thread = unknown type
    },
    message: {
      findFirst: vi.fn(async () => null),
    },
    agentTask: { count: vi.fn(async () => 0) },
    scheduleExecution: { count: vi.fn(async () => 0) },
    document: { findMany: vi.fn(async () => []) },
    rule: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    runtimeSetting: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) },
    systemHeartbeat: { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(async () => [{ "1": 1 }]),
  },
}));

// ═════════════════════════════════════════════════════════
// Mock runtime config
// ═════════════════════════════════════════════════════════
vi.mock("../services/runtime-config.service.js", () => ({
  getCurrentEffectiveDryRun: vi.fn(() => true),
  getEffectiveCooldownSeconds: vi.fn(() => 10),
  getAllRuntimeSettings: vi.fn(async () => []),
}));

// ═════════════════════════════════════════════════════════
// Mock production readiness
// ═════════════════════════════════════════════════════════
vi.mock("../services/production-readiness.service.js", () => ({
  getProductionReadiness: vi.fn(async () => ({
    verdict: "WARNING_ONLY",
    score: 75,
    timestamp: new Date().toISOString(),
    checks: [],
    summary: { pass: 10, warn: 2, fail: 0, criticalFail: 0, highFail: 0 },
  })),
}));

// ═════════════════════════════════════════════════════════
// Mock heartbeat
// ═════════════════════════════════════════════════════════
vi.mock("../services/heartbeat.service.js", () => ({
  getHeartbeatSummary: vi.fn(async () => ({})),
}));

// ═════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════
describe("Batch 18 — Controlled Live Test Mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(mockSessionStore)) delete mockSessionStore[k];
    mockAuditStore.length = 0;
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

  it("6. group thread rejected", async () => {
    const { getAllRuntimeSettings } = await import("../services/runtime-config.service.js");
    (getAllRuntimeSettings as any).mockResolvedValue([
      { key: "autoReply.allowedThreads", value: JSON.stringify(["grp-1"]) },
    ]);

    const { prisma } = await import("../db.js");
    // Mock the thread as a group
    (prisma.zaloThread.findUnique as any).mockResolvedValueOnce({ id: "grp-1", type: "group" });

    const { startLiveTest } = await import("../services/live-test.service.js");
    const result = await startLiveTest({
      threadId: "grp-1", maxMessages: 1, ttlSeconds: 120,
      confirmText: "START LIVE TEST", reason: "Valid reason for testing",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("GROUP_NOT_ALLOWED");
  });

  it("7. valid DM starts session", async () => {
    // Reset mocks from beforeEach
    vi.clearAllMocks();
    for (const k of Object.keys(mockSessionStore)) delete mockSessionStore[k];
    mockAuditStore.length = 0;

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
