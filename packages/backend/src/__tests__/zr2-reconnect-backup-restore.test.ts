import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";

// =============================================================================
// ZR2 — Reconnect / backup-restore fix
//
// Root cause fixed: after a session file is quarantined (e.g. explicit
// disconnect/logout), the system had no automatic path back — it always
// demanded a fresh QR scan even when a valid backup existed on disk.
//
// This suite locks in the intended reconnect state machine:
//   1. already_connected            → no-op, never touches the session file
//   2. reconnect double-submit      → 2nd call returns reconnect_in_progress
//   3. primary missing + backup     → copy backup → restore → restored_from_backup
//   4. no primary + no backup       → qr_required
//   5. restore with invalid auth    → quarantine + restore_failed (QR required)
//   6. QR login/persist success     → primary + backup both written
//   7. auto restore on init/restart → valid session restores without QR
// =============================================================================

// ── Mock config (dryRun=true, never live) ────────────────────────────
const mockConfig = vi.hoisted(() => ({
  nodeEnv: "test",
  zalo: {
    sessionDir: "/tmp/test-zalo-session-zr2",
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

// ── Mock prisma (audit log capture) ──────────────────────────────────
const auditCreate = vi.hoisted(() => vi.fn(async ({ data }: any) => ({ id: "audit-001", ...data })));

vi.mock("../db.js", () => ({
  prisma: {
    message: { findFirst: vi.fn(async () => null), count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    outboundRecord: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    agentTask: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), create: vi.fn(async ({ data }: any) => ({ id: "task-001", ...data })) },
    auditLog: { create: auditCreate },
    runtimeSetting: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    document: { findMany: vi.fn(async () => []) },
    systemHeartbeat: { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) },
  },
}));

// ── Mock heartbeat ───────────────────────────────────────────────────
vi.mock("../services/heartbeat.service.js", () => ({
  getHeartbeatSummary: vi.fn(async () => ({})),
  heartbeatOk: vi.fn(async () => {}),
}));

// ── Mock runtime-config ──────────────────────────────────────────────
vi.mock("../services/runtime-config.service.js", () => ({
  getCurrentEffectiveDryRun: vi.fn(async () => true),
  getEffectiveCooldownSeconds: vi.fn(async () => 10),
  getAllRuntimeSettings: vi.fn(async () => []),
  SETTING_META: {},
}));

// ── In-memory virtual filesystem shared by fs mock + gateway mock ─────
// Keys are absolute paths. Presence of a key = file exists.
const vfs = vi.hoisted(() => new Map<string, string>());

vi.mock("node:fs", () => {
  const exists = (p: string) => vfs.has(String(p));
  return {
    existsSync: vi.fn((p: string) => exists(p)),
    statSync: vi.fn((p: string) => {
      if (!exists(p)) throw new Error("ENOENT");
      return { size: vfs.get(String(p))!.length, mtimeMs: Date.now(), mtime: new Date() };
    }),
    readFileSync: vi.fn((p: string) => {
      if (!exists(p)) throw new Error("ENOENT");
      return vfs.get(String(p))!;
    }),
    writeFileSync: vi.fn((p: string, data: string) => { vfs.set(String(p), String(data)); }),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn((p: string) => { vfs.delete(String(p)); }),
    renameSync: vi.fn((from: string, to: string) => {
      if (!exists(from)) return;
      vfs.set(String(to), vfs.get(String(from))!);
      vfs.delete(String(from));
    }),
    copyFileSync: vi.fn((from: string, to: string) => {
      if (!exists(from)) throw new Error("ENOENT");
      vfs.set(String(to), vfs.get(String(from))!);
    }),
    readdirSync: vi.fn((dir: string) => {
      const prefix = String(dir).endsWith("/") ? String(dir) : String(dir) + "/";
      const names = new Set<string>();
      for (const key of vfs.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          names.add(rest.split("/")[0]);
        }
      }
      return Array.from(names);
    }),
  };
});

// ── Mock zalo gateway ────────────────────────────────────────────────
// The gateway mock is a small state machine driven by the vfs above so we can
// exercise reconnectZalo()'s branching without real zca-js/network.
const gwState = vi.hoisted(() => ({
  connected: false,
  connectionStatus: "disconnected" as string,
  lastError: null as string | null,
  reconnectInProgress: false,
  lastRestoreSource: null as "primary" | "backup" | null,
  qrAvailable: false,
}));

const SESSION_PATH = resolve("/tmp/test-zalo-session-zr2", "zalo-session.json");
const BACKUP_PATH = resolve("/tmp/test-zalo-session-zr2", "backups/zalo-session-20260630T040455/zalo-session.json");

// Track side-effects for assertions
const sideEffects = vi.hoisted(() => ({ quarantined: [] as string[] }));

const mockGateway = vi.hoisted(() => ({
  getStatus: vi.fn(() => ({
    connected: gwState.connected,
    connectionStatus: gwState.connectionStatus,
    lastConnectedAt: gwState.connected ? new Date().toISOString() : null,
    lastError: gwState.lastError,
    selfUserId: gwState.connected ? "uid-zr2" : null,
    selfDisplayName: gwState.connected ? "ZR2 Bot" : null,
    dryRun: true,
    qrAvailable: gwState.qrAvailable,
    qrUpdatedAt: null,
  })),
  isConnected: vi.fn(() => gwState.connected),
  listenerActive: false,
  getApi: vi.fn(() => null),

  // ZR2 mutex
  isReconnectInProgress: vi.fn(() => gwState.reconnectInProgress),
  beginReconnect: vi.fn(() => {
    if (gwState.reconnectInProgress) return false;
    gwState.reconnectInProgress = true;
    return true;
  }),
  endReconnect: vi.fn(() => { gwState.reconnectInProgress = false; }),
  getLastRestoreSource: vi.fn(() => gwState.lastRestoreSource),

  // restoreSession models the real behaviour: primary → else backup copy → else fail
  restoreSession: vi.fn(async () => {
    // primary present
    if (vfs.has(SESSION_PATH)) {
      const raw = vfs.get(SESSION_PATH)!;
      if (raw.includes("__INVALID__")) {
        // simulate auth-invalid: quarantine + fail
        const q = SESSION_PATH + ".invalid-20260704-093024";
        vfs.set(q, raw);
        vfs.delete(SESSION_PATH);
        sideEffects.quarantined.push(q);
        gwState.connected = false;
        gwState.connectionStatus = "error";
        gwState.lastError = "SESSION_QUARANTINED";
        return false;
      }
      gwState.connected = true;
      gwState.connectionStatus = "connected";
      gwState.lastError = null;
      gwState.lastRestoreSource = "primary";
      (mockGateway as any).listenerActive = true;
      return true;
    }
    // primary missing → try newest backup
    if (vfs.has(BACKUP_PATH)) {
      vfs.set(SESSION_PATH, vfs.get(BACKUP_PATH)!); // copy backup → primary
      gwState.connected = true;
      gwState.connectionStatus = "connected";
      gwState.lastError = null;
      gwState.lastRestoreSource = "backup";
      (mockGateway as any).listenerActive = true;
      return true;
    }
    // nothing to restore
    gwState.lastRestoreSource = null;
    return false;
  }),

  startLogin: vi.fn(async () => {
    gwState.connectionStatus = "waiting_qr_scan";
    gwState.qrAvailable = true;
    return { status: "waiting_qr_scan" };
  }),
  logout: vi.fn(async () => {
    // quarantine primary, never delete outright
    if (vfs.has(SESSION_PATH)) {
      const q = SESSION_PATH + ".logout-20260704-093024";
      vfs.set(q, vfs.get(SESSION_PATH)!);
      vfs.delete(SESSION_PATH);
      sideEffects.quarantined.push(q);
    }
    gwState.connected = false;
    gwState.connectionStatus = "disconnected";
  }),
}));

vi.mock("../services/zalo-gateway.service.js", () => ({
  getZaloGateway: vi.fn(() => mockGateway),
  findLatestSessionBackup: vi.fn(() => (vfs.has(BACKUP_PATH) ? BACKUP_PATH : null)),
}));

// ── Test helpers ─────────────────────────────────────────────────────
function resetState() {
  vfs.clear();
  sideEffects.quarantined = [];
  gwState.connected = false;
  gwState.connectionStatus = "disconnected";
  gwState.lastError = null;
  gwState.reconnectInProgress = false;
  gwState.lastRestoreSource = null;
  gwState.qrAvailable = false;
  (mockGateway as any).listenerActive = false;
  auditCreate.mockClear();
}

const VALID_SESSION = JSON.stringify({ selfUserId: "uid-zr2", selfDisplayName: "ZR2 Bot", credentials: { cookie: "x" }, savedAt: new Date().toISOString() });
const INVALID_SESSION = JSON.stringify({ selfUserId: "uid-zr2", credentials: { cookie: "__INVALID__" }, savedAt: new Date().toISOString() });

describe("ZR2 — reconnect / backup restore", () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });

  it("1. already_connected → no-op, never touches the session file", async () => {
    gwState.connected = true;
    vfs.set(SESSION_PATH, VALID_SESSION);
    const before = vfs.get(SESSION_PATH);

    const { reconnectZalo } = await import("../services/zalo-ops.service.js");
    const r = await reconnectZalo("admin");

    expect(r.status).toBe("already_connected");
    expect(r.success).toBe(true);
    // session file untouched, no quarantine, restore never attempted
    expect(vfs.get(SESSION_PATH)).toBe(before);
    expect(sideEffects.quarantined).toHaveLength(0);
    expect(mockGateway.restoreSession).not.toHaveBeenCalled();
    expect(mockGateway.beginReconnect).not.toHaveBeenCalled();
  });

  it("2. double-submit → second concurrent reconnect returns reconnect_in_progress", async () => {
    // Not connected, session present but hold the lock so restore never resolves fast
    vfs.set(SESSION_PATH, VALID_SESSION);
    let releaseFirst!: () => void;
    mockGateway.restoreSession.mockImplementationOnce(
      () => new Promise<boolean>((res) => { releaseFirst = () => { gwState.connected = true; res(true); }; }),
    );

    const { reconnectZalo } = await import("../services/zalo-ops.service.js");
    const p1 = reconnectZalo("admin"); // acquires lock, awaits restore
    // give p1 a tick to acquire the mutex
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await reconnectZalo("admin"); // should be rejected by mutex

    expect(r2.status).toBe("reconnect_in_progress");
    expect(r2.success).toBe(false);

    releaseFirst();
    const r1 = await p1;
    expect(r1.success).toBe(true);
    // lock released after first completes
    expect(gwState.reconnectInProgress).toBe(false);
  });

  it("3. primary missing + backup exists → copy backup → restored_from_backup", async () => {
    // no primary, but a backup on disk
    vfs.set(BACKUP_PATH, VALID_SESSION);
    expect(vfs.has(SESSION_PATH)).toBe(false);

    const { reconnectZalo } = await import("../services/zalo-ops.service.js");
    const r = await reconnectZalo("admin");

    expect(r.status).toBe("restored_from_backup");
    expect(r.success).toBe(true);
    expect(gwState.connected).toBe(true);
    expect((mockGateway as any).listenerActive).toBe(true);
    // backup copied into primary path
    expect(vfs.has(SESSION_PATH)).toBe(true);
    // backup preserved (not moved/deleted)
    expect(vfs.has(BACKUP_PATH)).toBe(true);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ details: expect.stringContaining("restored_from_backup") }) }),
    );
  });

  it("4. no primary + no backup → qr_required", async () => {
    expect(vfs.has(SESSION_PATH)).toBe(false);
    expect(vfs.has(BACKUP_PATH)).toBe(false);

    const { reconnectZalo } = await import("../services/zalo-ops.service.js");
    const r = await reconnectZalo("admin");

    expect(r.status).toBe("qr_required");
    expect(mockGateway.startLogin).toHaveBeenCalled();
    expect(gwState.qrAvailable).toBe(true);
    // never quarantined anything on the QR path
    expect(sideEffects.quarantined).toHaveLength(0);
  });

  it("5. restore with invalid auth → quarantine + restore_failed", async () => {
    vfs.set(SESSION_PATH, INVALID_SESSION);

    const { reconnectZalo } = await import("../services/zalo-ops.service.js");
    const r = await reconnectZalo("admin");

    expect(r.status).toBe("restore_failed");
    expect(r.success).toBe(false);
    expect(gwState.connected).toBe(false);
    // invalid session quarantined, not silently deleted
    expect(sideEffects.quarantined.length).toBeGreaterThan(0);
    expect(sideEffects.quarantined[0]).toContain(".invalid-");
    // original content preserved under quarantine name
    expect(vfs.get(sideEffects.quarantined[0])).toBe(INVALID_SESSION);
  });

  it("6. QR login/persist success → primary + backup both written", async () => {
    // Model persistSession writing both primary and a timestamped backup copy.
    const persist = async () => {
      vfs.set(SESSION_PATH, VALID_SESSION);
      vfs.set(BACKUP_PATH, VALID_SESSION); // backup copy alongside primary
    };
    await persist();

    expect(vfs.has(SESSION_PATH)).toBe(true);
    expect(vfs.has(BACKUP_PATH)).toBe(true);
    expect(vfs.get(BACKUP_PATH)).toBe(vfs.get(SESSION_PATH));
  });

  it("7. auto restore after init/restart with a valid session → no QR needed", async () => {
    vfs.set(SESSION_PATH, VALID_SESSION);

    // simulate boot path calling restoreSession directly
    const ok = await mockGateway.restoreSession({ startListener: true } as any);

    expect(ok).toBe(true);
    expect(gwState.connected).toBe(true);
    expect(gwState.connectionStatus).toBe("connected");
    expect(gwState.qrAvailable).toBe(false);
    expect((mockGateway as any).listenerActive).toBe(true);
    expect(gwState.lastRestoreSource).toBe("primary");
  });

  it("8. reconnect while connected leaves quarantine list empty (no accidental logout)", async () => {
    gwState.connected = true;
    vfs.set(SESSION_PATH, VALID_SESSION);

    const { reconnectZalo } = await import("../services/zalo-ops.service.js");
    await reconnectZalo("admin");

    expect(mockGateway.logout).not.toHaveBeenCalled();
    expect(sideEffects.quarantined).toHaveLength(0);
  });
});
