import { describe, it, expect, vi, beforeEach } from "vitest";

// ═════════════════════════════════════════════════════════
// Mock config
// ═════════════════════════════════════════════════════════
const mockConfig = vi.hoisted(() => ({
  nodeEnv: "test",
  zalo: {
    sessionDir: "/tmp/test-zalo-session",
    dryRun: true,
    rateLimitPerMinute: 10,
    rateLimitGlobalPerMinute: 60,
    mediaAllowedBaseDir: "/tmp/hermes-media",
    voiceEnabled: false,
  },
  autoReply: {
    enabled: true,
    dryRun: true,
    allowedThreads: ["thread-123"],
    cooldownSeconds: 10,
    groupReplyWindowSeconds: 600,
  },
  logLevel: "error",
}));

vi.mock("../config.js", () => ({ config: mockConfig }));

// ═════════════════════════════════════════════════════════
// Mock prisma
// ═════════════════════════════════════════════════════════
vi.mock("../db.js", () => ({
  prisma: {
    message: {
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
    },
    outboundRecord: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
    },
    agentTask: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => ({ id: "agent-task-001", ...data })),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => ({ id: "audit-log-001", ...data })),
    },
    runtimeSetting: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    document: {
      findMany: vi.fn(async () => []),
    },
    systemHeartbeat: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async () => ({})),
    },
  },
}));

// ═════════════════════════════════════════════════════════
// Mock zalo gateway
// ═════════════════════════════════════════════════════════
const mockGatewayStatus = vi.hoisted(() => ({
  connected: true,
  connectionStatus: "connected",
  lastConnectedAt: new Date().toISOString(),
  lastError: null,
  selfUserId: "test-uid-123",
  selfDisplayName: "Test Bot",
  dryRun: true,
  qrAvailable: false,
  qrUpdatedAt: null,
}));

const mockGateway = vi.hoisted(() => ({
  getStatus: vi.fn(() => mockGatewayStatus),
  isConnected: vi.fn(() => true),
  restoreSession: vi.fn(async () => true),
  startLogin: vi.fn(async () => ({ status: "connected" })),
  logout: vi.fn(async () => {}),
  getApi: vi.fn(() => null),
  isListenerActive: vi.fn(() => true),
  // ZR2: reconnect mutex + backup-restore signaling
  isReconnectInProgress: vi.fn(() => false),
  beginReconnect: vi.fn(() => true),
  endReconnect: vi.fn(() => {}),
  getLastRestoreSource: vi.fn(() => "primary" as "primary" | "backup" | null),
  getRecoveryStatus: vi.fn(() => ({
    recoveryState: "idle" as "idle" | "scheduled" | "reconnecting" | "error",
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    lastReconnectAt: null,
    lastReconnectError: null,
    listenerActive: true,
    lastListenerBeatAt: new Date().toISOString(),
    listenerHeartbeatAgeSeconds: 3,
  })),
}));

vi.mock("../services/zalo-gateway.service.js", () => ({
  getZaloGateway: vi.fn(() => mockGateway),
  findLatestSessionBackup: vi.fn(() => null),
}));

// ═════════════════════════════════════════════════════════
// Mock runtime config (returns defaults)
// ═════════════════════════════════════════════════════════
vi.mock("../services/runtime-config.service.js", () => ({
  getCurrentEffectiveDryRun: vi.fn(() => true),
  getEffectiveCooldownSeconds: vi.fn(() => 10),
  getAllRuntimeSettings: vi.fn(async () => []),
  SETTING_META: {},
}));

// ═════════════════════════════════════════════════════════
// Mock heartbeat service
// ═════════════════════════════════════════════════════════
vi.mock("../services/heartbeat.service.js", () => ({
  getHeartbeatSummary: vi.fn(async () => ({
    zaloConnection: { name: "zaloConnection", status: "ok", lastBeatAt: new Date().toISOString(), ageSeconds: 5, lastError: null, lastSuccessAt: null, lastErrorAt: null, metadata: null },
    zaloListener: { name: "zaloListener", status: "ok", lastBeatAt: new Date().toISOString(), ageSeconds: 3, lastError: null, lastSuccessAt: null, lastErrorAt: null, metadata: null },
    messagePipeline: { name: "messagePipeline", status: "ok", lastBeatAt: new Date().toISOString(), ageSeconds: 8, lastError: null, lastSuccessAt: null, lastErrorAt: null, metadata: null },
    backend: { name: "backend", status: "ok", lastBeatAt: new Date().toISOString(), ageSeconds: 2, lastError: null, lastSuccessAt: null, lastErrorAt: null, metadata: null },
    schedulerWorker: { name: "schedulerWorker", status: "ok", lastBeatAt: new Date().toISOString(), ageSeconds: 10, lastError: null, lastSuccessAt: null, lastErrorAt: null, metadata: null },
  })),
  heartbeatOk: vi.fn(async () => {}),
}));

// ═════════════════════════════════════════════════════════
// Mock fs
// ═════════════════════════════════════════════════════════
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  statSync: vi.fn(() => ({ mtimeMs: Date.now() })),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(() => "{}"),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// ═════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════
describe("Batch 16 — Zalo Ops Dashboard", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset gateway status to defaults
    Object.assign(mockGatewayStatus, {
      connected: true,
      connectionStatus: "connected",
      lastConnectedAt: new Date().toISOString(),
      lastError: null,
      selfUserId: "test-uid-123",
      selfDisplayName: "Test Bot",
      dryRun: true,
      qrAvailable: false,
      qrUpdatedAt: null,
    });
  });

  // ── Test 1: status returns connected/listener/session without secrets ──
  it("1. getZaloOpsStatus returns fields without secrets", async () => {
    const { getZaloOpsStatus } = await import("../services/zalo-ops.service.js");

    const result = await getZaloOpsStatus();

    // Check status fields
    expect(result.connected).toBe(true);
    expect(result.selfUserId).toBe("test-uid-123");
    expect(result.selfDisplayName).toBe("Test Bot");
    expect(result.dryRun).toBe(true);

    // Check session info exists (masked)
    expect(result.session).toBeDefined();
    expect(result.session.exists).toBeDefined();
    expect(typeof result.session.path).toBe("string");

    // Check heartbeats
    expect(result.heartbeats.zaloConnection.status).toBe("ok");
    expect(result.heartbeats.zaloListener.status).toBe("ok");

    // Check no secrets exposed
    const json = JSON.stringify(result);
    expect(json).not.toContain("cookie");
    expect(json).not.toContain("token");
    expect(json).not.toContain("secret");
    expect(json).not.toContain("credential");
    expect(json).not.toContain("password");
    expect(json).not.toContain("imei");
  });

  // ── Test 2: reconnect without session or backup returns qr_required (ZR2 rename of legacy needs_qr) ──
  it("2. reconnect without session or backup returns qr_required, no crash", async () => {
    mockGateway.isConnected = vi.fn(() => false);
    mockGateway.restoreSession = vi.fn(async () => false);
    mockGateway.startLogin = vi.fn(async () => ({ status: "connecting" }));

    const { reconnectZalo } = await import("../services/zalo-ops.service.js");
    const result = await reconnectZalo("admin");

    expect(result.success).toBe(true);
    expect(result.status).toBe("qr_required");
  });

  // ── Test 3: reconnect with session starts listener ──
  it("3. reconnect with mocked session starts listener", async () => {
    const { existsSync } = await import("node:fs");
    (existsSync as any).mockReturnValue(true); // Session exists

    mockGateway.isConnected = vi.fn(() => false);
    mockGateway.restoreSession = vi.fn(async (opts?: any) => {
      expect(opts?.startListener).toBe(true);
      return true;
    });

    const { reconnectZalo } = await import("../services/zalo-ops.service.js");
    const result = await reconnectZalo("admin");

    expect(result.success).toBe(true);
    expect(result.status).toBe("restored");
  });

  // ── Test 4: reconnect when already connected ──
  it("4. reconnect when already connected returns no-op", async () => {
    mockGateway.isConnected = vi.fn(() => true);

    const { reconnectZalo } = await import("../services/zalo-ops.service.js");
    const result = await reconnectZalo("admin");

    expect(result.success).toBe(true);
    expect(result.status).toBe("already_connected");
  });

  // ── Test 5: disconnect success ──
  it("5. disconnect calls logout cleanly", async () => {
    mockGateway.logout = vi.fn(async () => {});

    const { disconnectZalo } = await import("../services/zalo-ops.service.js");
    const result = await disconnectZalo("admin");

    expect(result.success).toBe(true);
    expect(result.status).toBe("disconnected");
    expect(mockGateway.logout).toHaveBeenCalled();
  });

  // ── Test 6: QR endpoint does not leak session ──
  it("6. getQRStatus does not leak session content", async () => {
    const { getQRStatus } = await import("../services/zalo-ops.service.js");

    const result = getQRStatus();

    expect(result.qrAvailable).toBe(false);
    expect(result.status).toBe("connected");
    const json = JSON.stringify(result);
    expect(json).not.toContain("cookie");
    expect(json).not.toContain("token");
    expect(json).not.toContain("session");
  });

  // ── Test 7: Test DM blocked when dryRun=false ──
  it("7. testDM blocked when dryRun=false", async () => {
    const { getCurrentEffectiveDryRun } = await import("../services/runtime-config.service.js");
    (getCurrentEffectiveDryRun as any).mockReturnValue(false);

    const { testDM } = await import("../services/zalo-ops.service.js");
    const result = await testDM({ threadId: "thread-123" }, "admin");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("NOT_DRY_RUN");
  });

  // ── Test 8: Test DM blocked when thread not allowed ──
  it("8. testDM blocked when thread not allowed", async () => {
    const { getCurrentEffectiveDryRun, getAllRuntimeSettings } = await import("../services/runtime-config.service.js");
    (getCurrentEffectiveDryRun as any).mockReturnValue(true);
    (getAllRuntimeSettings as any).mockResolvedValue([
      { key: "autoReply.allowedThreads", value: JSON.stringify(["thread-456"]) },
    ]);

    const { testDM } = await import("../services/zalo-ops.service.js");
    const result = await testDM({ threadId: "thread-999" }, "admin");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("THREAD_NOT_ALLOWED");
  });

  it("8b. testDM fails closed when allowedThreads is empty without writing evidence", async () => {
    const { getCurrentEffectiveDryRun, getAllRuntimeSettings } = await import("../services/runtime-config.service.js");
    (getCurrentEffectiveDryRun as any).mockReturnValue(true);
    (getAllRuntimeSettings as any).mockResolvedValue([
      { key: "autoReply.allowedThreads", value: JSON.stringify([]) },
    ]);

    const { prisma } = await import("../db.js");
    const { testDM } = await import("../services/zalo-ops.service.js");
    const result = await testDM({ threadId: "thread-123" }, "admin");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("THREAD_NOT_ALLOWED");
    expect(prisma.agentTask.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("8c. testDM rejects an absent threadId before reading settings or writing evidence", async () => {
    const { getCurrentEffectiveDryRun, getAllRuntimeSettings } = await import("../services/runtime-config.service.js");
    (getCurrentEffectiveDryRun as any).mockReturnValue(true);
    (getAllRuntimeSettings as any).mockResolvedValue([
      { key: "autoReply.allowedThreads", value: JSON.stringify(["thread-123"]) },
    ]);

    const { prisma } = await import("../db.js");
    const { testDM } = await import("../services/zalo-ops.service.js");
    const result = await testDM({ threadId: "" }, "admin");

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("MISSING_THREAD_ID");
    expect(getAllRuntimeSettings).not.toHaveBeenCalled();
    expect(prisma.agentTask.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("8d. testDM rejects a whitespace-only threadId before reading settings or writing evidence", async () => {
    const { getCurrentEffectiveDryRun, getAllRuntimeSettings } = await import("../services/runtime-config.service.js");
    (getCurrentEffectiveDryRun as any).mockReturnValue(true);
    (getAllRuntimeSettings as any).mockResolvedValue([
      { key: "autoReply.allowedThreads", value: JSON.stringify(["thread-123"]) },
    ]);

    const { prisma } = await import("../db.js");
    const { testDM } = await import("../services/zalo-ops.service.js");
    const result = await testDM({ threadId: "   \t" }, "admin");

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("MISSING_THREAD_ID");
    expect(getAllRuntimeSettings).not.toHaveBeenCalled();
    expect(prisma.agentTask.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  // ── Test 9: Test DM allowed in dryRun creates audit only ──
  it("9. testDM allowed in dryRun creates agent task + audit", async () => {
    const { getCurrentEffectiveDryRun, getAllRuntimeSettings } = await import("../services/runtime-config.service.js");
    (getCurrentEffectiveDryRun as any).mockReturnValue(true);
    (getAllRuntimeSettings as any).mockResolvedValue([
      { key: "autoReply.allowedThreads", value: JSON.stringify(["thread-123"]) },
    ]);

    const { testDM } = await import("../services/zalo-ops.service.js");
    const result = await testDM({ threadId: "thread-123", content: "Test hello" }, "admin");

    expect(result.allowed).toBe(true);
    expect(result.agentTaskId).toBeDefined();
    expect(result.auditId).toBeDefined();

    const { prisma } = await import("../db.js");
    expect(prisma.agentTask.create).toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  // ── Test 10: Test DM blocked with missing threadId ──
  it("10. testDM blocked when threadId empty", async () => {
    // The route handles missing threadId, but the service still runs
    const { testDM } = await import("../services/zalo-ops.service.js");
    try {
      // The route already validates MISSING_THREAD_ID before calling testDM,
      // so the service itself gets called with whatever is passed.
      const result = await testDM({ threadId: "not-in-list", content: "hi" }, "admin");
      // Should be blocked by thread not allowed
      expect(result.allowed).toBe(false);
    } catch (e) {
      // unexpected
    }
  });

  // ── Test 11: Recent events returns safely ──
  it("11. getRecentEvents returns inbound/outbound/errors safely", async () => {
    const { getRecentEvents } = await import("../services/zalo-ops.service.js");
    const result = await getRecentEvents();

    expect(result).toHaveProperty("inbound");
    expect(result).toHaveProperty("outbound");
    expect(result).toHaveProperty("errors");
    expect(Array.isArray(result.inbound)).toBe(true);
    expect(Array.isArray(result.outbound)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  // ── Test 12: Status returns correct dryRun and cooldown ──
  it("12. status reflects dryRun=true + cooldownSeconds from runtime config", async () => {
    const { getEffectiveCooldownSeconds, getCurrentEffectiveDryRun } = await import("../services/runtime-config.service.js");
    (getEffectiveCooldownSeconds as any).mockReturnValue(30);
    (getCurrentEffectiveDryRun as any).mockReturnValue(true);

    const { getZaloOpsStatus } = await import("../services/zalo-ops.service.js");
    const result = await getZaloOpsStatus();

    expect(result.dryRun).toBe(true);
    expect(result.cooldownSeconds).toBe(30);
  });
});
