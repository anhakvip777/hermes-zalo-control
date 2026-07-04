import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanDatabase } from "./shared-setup.js";

// ═════════════════════════════════════════════════════════
// Hoist mutable test state (vitest requires hoisted for mock access)
// ═════════════════════════════════════════════════════════
const S3 = vi.hoisted(() => {
  const dir = "/tmp/s3-test-session";
  const SESSION_FILE = "zalo-session.json";
  return {
    dir,
    sessionPath: dir + "/" + SESSION_FILE,
    SESSION_FILE,
    gw: {
      connected: false,
      connectionStatus: "disconnected" as string,
      selfUserId: null as string | null,
      selfDisplayName: null as string | null,
      lastConnectedAt: null as string | null,
      lastError: null as string | null,
      dryRun: true,
      qrAvailable: false,
      qrUpdatedAt: null as string | null,
    },
  };
});

const mockConfig = vi.hoisted(() => ({
  nodeEnv: "test",
  zalo: {
    sessionDir: S3.dir,
    dryRun: false,
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

const mockGateway = vi.hoisted(() => ({
  getStatus: vi.fn(() => ({ ...S3.gw })),
  isConnected: vi.fn(() => S3.gw.connected),
  restoreSession: vi.fn(async () => S3.gw.connected),
  startLogin: vi.fn(async () => ({ status: "connected" })),
  logout: vi.fn(async () => {}),
  getApi: vi.fn(() => null),
  getSessionDir: vi.fn(() => S3.dir),
  getSessionFileInfo: vi.fn(() => {
    try {
      if (!existsSync(S3.sessionPath)) return { exists: false, size: null, updatedAt: null };
      const st = statSync(S3.sessionPath);
      return { exists: true, size: st.size, updatedAt: st.mtime.toISOString() };
    } catch {
      return { exists: false, size: null, updatedAt: null };
    }
  }),
  isSessionFilePersisted: vi.fn(() => {
    try {
      if (!existsSync(S3.sessionPath)) return false;
      return statSync(S3.sessionPath).size > 0;
    } catch {
      return false;
    }
  }),
  // ZR2: reconnect mutex + backup-restore signaling
  isReconnectInProgress: vi.fn(() => false),
  beginReconnect: vi.fn(() => true),
  endReconnect: vi.fn(() => {}),
  getLastRestoreSource: vi.fn(() => "primary" as "primary" | "backup" | null),
}));

// ═════════════════════════════════════════════════════════
// Mocks
// ═════════════════════════════════════════════════════════
vi.mock("../config.js", () => ({ config: mockConfig }));

vi.mock("../services/zalo-gateway.service.js", () => ({
  getZaloGateway: vi.fn(() => mockGateway),
  ZaloGatewayService: vi.fn(),
  findLatestSessionBackup: vi.fn(() => null),
  quarantineSessionFile: vi.fn((path: string, reason: string) => {
    try {
      if (!existsSync(path)) return null;
      const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
      const safeReason = reason.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 20) || "unknown";
      const quarantinePath = `${path}.${safeReason}-${ts}`;
      const { renameSync } = require("node:fs");
      renameSync(path, quarantinePath);
      return quarantinePath;
    } catch {
      return null;
    }
  }),
}));

vi.mock("../db.js", () => ({
  prisma: {
    $executeRawUnsafe: vi.fn(async () => {}),
    message: { findFirst: vi.fn(async () => null), count: vi.fn(async () => 0), findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({})) },
    outboundRecord: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({})) },
    agentTask: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), create: vi.fn(async ({ data }: any) => ({ id: "task-001", ...data })), deleteMany: vi.fn(async () => ({})) },
    auditLog: { create: vi.fn(async ({ data }: any) => ({ id: "audit-001", ...data })), deleteMany: vi.fn(async () => ({})) },
    runtimeSetting: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({})) },
    document: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({})) },
    systemHeartbeat: { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) },
    schedule: { deleteMany: vi.fn(async () => ({})) },
    scheduleJob: { deleteMany: vi.fn(async () => ({})) },
    scheduleRevision: { deleteMany: vi.fn(async () => ({})) },
    scheduleExecution: { deleteMany: vi.fn(async () => ({})) },
    rule: { deleteMany: vi.fn(async () => ({})) },
    ruleVersion: { deleteMany: vi.fn(async () => ({})) },
    ruleExecution: { deleteMany: vi.fn(async () => ({})) },
    documentChunk: { deleteMany: vi.fn(async () => ({})) },
    documentIngestionJob: { deleteMany: vi.fn(async () => ({})) },
    attendanceRecord: { deleteMany: vi.fn(async () => ({})) },
    attendanceSession: { deleteMany: vi.fn(async () => ({})) },
    zaloThread: { deleteMany: vi.fn(async () => ({})) },
    zaloPrincipal: { deleteMany: vi.fn(async () => ({})) },
    zaloPrincipalAudit: { deleteMany: vi.fn(async () => ({})) },
    threadProfile: { deleteMany: vi.fn(async () => ({})) },
    messageBatch: { deleteMany: vi.fn(async () => ({})) },
    appSetting: { deleteMany: vi.fn(async () => ({})) },
  },
}));

vi.mock("../services/runtime-config.service.js", () => ({
  getCurrentEffectiveDryRun: vi.fn(() => true),
  getEffectiveCooldownSeconds: vi.fn(() => 10),
  getAllRuntimeSettings: vi.fn(async () => []),
  SETTING_META: {},
}));

vi.mock("../services/heartbeat.service.js", () => ({
  getHeartbeatSummary: vi.fn(async () => ({
    zaloConnection: { status: "ok", lastBeatAt: new Date().toISOString(), ageSeconds: 5 },
    zaloListener: { status: "ok", lastBeatAt: new Date().toISOString(), ageSeconds: 3 },
    messagePipeline: { status: "ok", lastBeatAt: new Date().toISOString(), ageSeconds: 8 },
    backend: { status: "ok", lastBeatAt: new Date().toISOString(), ageSeconds: 2 },
  })),
  heartbeatOk: vi.fn(async () => {}),
}));

// ═════════════════════════════════════════════════════════
// Setup / Teardown
// ═════════════════════════════════════════════════════════
beforeEach(async () => {
  await cleanDatabase();
  try { rmSync(S3.dir, { recursive: true, force: true }); } catch {}
  mkdirSync(S3.dir, { recursive: true });
  S3.gw.connected = false;
  S3.gw.connectionStatus = "disconnected";
  S3.gw.selfUserId = null;
  S3.gw.selfDisplayName = null;
  S3.gw.lastConnectedAt = null;
  S3.gw.lastError = null;
  S3.gw.qrAvailable = false;
  S3.gw.qrUpdatedAt = null;
});

afterEach(() => {
  try { rmSync(S3.dir, { recursive: true, force: true }); } catch {}
});

function createSessionFile() {
  mkdirSync(S3.dir, { recursive: true });
  writeFileSync(
    S3.sessionPath,
    JSON.stringify({
      selfUserId: "test-uid-123",
      selfDisplayName: "Test Bot",
      credentials: { cookie: "test-cookie", imei: "test-imei" },
      savedAt: new Date().toISOString(),
    }),
    "utf-8",
  );
}

// ═════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════
describe("S3.1 — Connected with session file", () => {
  it("returns no warning when connected and session file exists", async () => {
    createSessionFile();
    S3.gw.connected = true;
    S3.gw.connectionStatus = "connected";
    S3.gw.selfUserId = "test-uid-123";
    S3.gw.selfDisplayName = "Test Bot";
    S3.gw.lastConnectedAt = new Date().toISOString();

    const { getZaloOpsStatus } = await import("../services/zalo-ops.service.js");
    const status = await getZaloOpsStatus();

    expect(status.connected).toBe(true);
    expect(status.session.exists).toBe(true);
    expect(status.session.fileSize).toBeGreaterThan(0);
    expect(status.session.updatedAt).toBeTruthy();
    expect(status.session.warning).toBeNull();
    expect(status.session.quarantinedFiles).toEqual([]);
  });
});

describe("S3.2 — Connected but session file missing", () => {
  it("reports CONNECTED_BUT_SESSION_NOT_PERSISTED warning", async () => {
    S3.gw.connected = true;
    S3.gw.connectionStatus = "connected";
    S3.gw.selfUserId = "test-uid-123";
    S3.gw.lastConnectedAt = new Date().toISOString();

    const { getZaloOpsStatus } = await import("../services/zalo-ops.service.js");
    const status = await getZaloOpsStatus();

    expect(status.connected).toBe(true);
    expect(status.session.exists).toBe(false);
    expect(status.session.fileSize).toBeNull();
    expect(status.session.updatedAt).toBeNull();
    expect(status.session.warning).toBe("CONNECTED_BUT_SESSION_NOT_PERSISTED");
  });
});

describe("S3.3 — Disconnected with no session file", () => {
  it("reports NO_SESSION_FILE warning when disconnected and file missing", async () => {
    S3.gw.connected = false;
    S3.gw.connectionStatus = "disconnected";

    const { getZaloOpsStatus } = await import("../services/zalo-ops.service.js");
    const status = await getZaloOpsStatus();

    expect(status.connected).toBe(false);
    expect(status.session.exists).toBe(false);
    expect(status.session.warning).toBe("NO_SESSION_FILE");
  });
});

describe("S3.4 — Quarantine file listing (no content exposed)", () => {
  it("lists quarantined filenames but never exposes session content", async () => {
    createSessionFile();
    S3.gw.connected = true;
    S3.gw.connectionStatus = "connected";
    S3.gw.selfUserId = "test-uid-123";

    writeFileSync(
      join(S3.dir, "zalo-session.json.expired-20260630-120000"),
      JSON.stringify({ credentials: { cookie: "EXPIRED_SECRET_DO_NOT_EXPOSE" } }),
      "utf-8",
    );
    writeFileSync(
      join(S3.dir, "zalo-session.json.invalid-20260629-080000"),
      JSON.stringify({ credentials: { cookie: "ANOTHER_SECRET" } }),
      "utf-8",
    );

    const { getZaloOpsStatus } = await import("../services/zalo-ops.service.js");
    const status = await getZaloOpsStatus();

    expect(status.session.quarantinedFiles).toContain("zalo-session.json.expired-20260630-120000");
    expect(status.session.quarantinedFiles).toContain("zalo-session.json.invalid-20260629-080000");
    expect(status.session.quarantinedFiles.length).toBe(2);
    expect(status.session.exists).toBe(true);
    expect(status.session.warning).toBe("SESSION_QUARANTINED");

    const statusJson = JSON.stringify(status);
    expect(statusJson).not.toContain("EXPIRED_SECRET_DO_NOT_EXPOSE");
    expect(statusJson).not.toContain("ANOTHER_SECRET");
    expect(statusJson).not.toContain("test-cookie");
    expect(statusJson).not.toContain("test-imei");
    expect(statusJson).not.toContain('"credentials"');
  });
});

describe("S3.5 — Session restore verifies file persistence", () => {
  it("isSessionFilePersisted returns true after createSessionFile", () => {
    createSessionFile();
    expect(existsSync(S3.sessionPath)).toBe(true);
    expect(mockGateway.isSessionFilePersisted()).toBe(true);
  });

  it("isSessionFilePersisted returns false when no file exists", () => {
    expect(existsSync(S3.sessionPath)).toBe(false);
    expect(mockGateway.isSessionFilePersisted()).toBe(false);
  });

  it("isSessionFilePersisted returns false for empty file", () => {
    mkdirSync(S3.dir, { recursive: true });
    writeFileSync(S3.sessionPath, "", "utf-8");
    expect(existsSync(S3.sessionPath)).toBe(true);
    expect(mockGateway.isSessionFilePersisted()).toBe(false);
  });
});

describe("S3.6 — Ops status never exposes session content", () => {
  it("getZaloOpsStatus never includes credentials, cookies, or imei", async () => {
    createSessionFile();
    S3.gw.connected = true;
    S3.gw.connectionStatus = "connected";
    S3.gw.selfUserId = "test-uid-123";

    const { getZaloOpsStatus } = await import("../services/zalo-ops.service.js");
    const status = await getZaloOpsStatus();

    const statusJson = JSON.stringify(status);
    expect(statusJson).not.toContain("test-cookie");
    expect(statusJson).not.toContain("test-imei");
    expect(statusJson).not.toContain('"credentials"');

    expect(status.session.exists).toBe(true);
    expect(status.session.fileSize).toBeGreaterThan(0);
    expect(status.selfUserId).toBe("test-uid-123");
  });
});

describe("S3.7 — No destructive session operations", () => {
  it("getZaloOpsStatus does not modify or delete session files", async () => {
    createSessionFile();
    S3.gw.connected = true;
    S3.gw.connectionStatus = "connected";

    const originalStat = statSync(S3.sessionPath);

    const { getZaloOpsStatus } = await import("../services/zalo-ops.service.js");
    await getZaloOpsStatus();

    expect(existsSync(S3.sessionPath)).toBe(true);
    const afterStat = statSync(S3.sessionPath);
    expect(afterStat.size).toBe(originalStat.size);
    expect(afterStat.mtimeMs).toBe(originalStat.mtimeMs);
  });

  it("getSessionInfo helper never deletes or truncates files", async () => {
    createSessionFile();
    S3.gw.connected = true;

    const { getZaloOpsStatus } = await import("../services/zalo-ops.service.js");
    await getZaloOpsStatus();
    await getZaloOpsStatus();
    await getZaloOpsStatus();

    expect(existsSync(S3.sessionPath)).toBe(true);
    expect(statSync(S3.sessionPath).size).toBeGreaterThan(0);
  });
});
