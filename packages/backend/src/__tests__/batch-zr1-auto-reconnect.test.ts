import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const zcaBoundary = vi.hoisted(() => {
  const login = vi.fn();

  class FakeZalo {
    constructor(_options: unknown) {}

    login(credentials: unknown) {
      return login(credentials);
    }
  }

  const projectRequire = vi.fn((moduleId: string) => {
    if (moduleId !== "zca-js") throw new Error(`Unexpected projectRequire call: ${moduleId}`);
    return { Zalo: FakeZalo };
  });

  return {
    login,
    projectRequire,
    createRequire: vi.fn(() => projectRequire),
  };
});

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return { ...actual, createRequire: zcaBoundary.createRequire };
});

// =============================================================================
// ZR1: Auto-reconnect + WS disconnect event wiring tests
// Pattern: unit-test ZaloGatewayService private methods directly via (gw as any)
// No hoisted EventEmitter (circular import issue) — create fresh emitter per test
// =============================================================================

// ── Mock config ──────────────────────────────────────────────────────────────
const mockConfig = vi.hoisted(() => ({
  nodeEnv: "test",
  zalo: {
    sessionDir: "/tmp/test-zr1-session",
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
  port: 3002,
  host: "127.0.0.1",
  logLevel: "error",
}));
vi.mock("../config.js", () => ({ config: mockConfig }));

// ── Mock prisma ───────────────────────────────────────────────────────────────
vi.mock("../db.js", () => ({
  prisma: {
    systemHeartbeat: { upsert: vi.fn(async () => ({})) },
    runtimeSetting: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  },
}));

// ── Mock heartbeat ─────────────────────────────────────────────────────────────
vi.mock("../services/heartbeat.service.js", () => ({
  heartbeatOk: vi.fn(async () => {}),
  heartbeatFail: vi.fn(async () => {}),
}));

// ── Mock runtime-config ───────────────────────────────────────────────────────
vi.mock("../services/runtime-config.service.js", () => ({
  getCurrentEffectiveDryRun: vi.fn(() => true),
  getEffectiveDryRunInfo: vi.fn(() => ({ dryRun: true, dryRunSource: "env" })),
  getEffectiveAutoReplyConfig: vi.fn(async () => ({
    enabled: true, dryRun: true, allowedThreads: ["thread-123"],
    cooldownSeconds: 10, groupReplyWindowSeconds: 600, dryRunSource: "env",
  })),
  getEffectiveAutoReplyConfigSync: vi.fn(() => ({
    enabled: true, dryRun: true, allowedThreads: ["thread-123"],
    cooldownSeconds: 10, groupReplyWindowSeconds: 600, dryRunSource: "env",
  })),
  getEffectiveBatchingConfig: vi.fn(() => ({
    enabled: false, windowMs: 3000, maxMessages: 5, maxChars: 3000,
  })),
  getEffectiveCooldownSeconds: vi.fn(() => 10),
  heartbeatOk: vi.fn(async () => {}),
}));

// ── Mock node:fs with importOriginal to avoid leaking to other test files ─────
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "{}"),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 3000 })),
    renameSync: vi.fn(),
  };
});

// ── Mock zca-js (used by restoreSession via projectRequire) ──────────────────────
// projectRequire("zca-js") → require() from node_modules, not ESM import.
// Vitest cannot intercept CJS require() directly, so we mock the Zalo constructor
// by patching the gateway's zalo instance AFTER new Zalo() is called via prototype.
// Simpler: spy on the gateway's internal this.zalo.login after construction.
// → T7/T9 use a different approach: mock persistSession + spy after zalo is set.

// ── Mock zalo-receive (avoid DB calls in listener) ─────────────────────────────
vi.mock("../services/zalo-receive.js", () => ({
  normalizeMessage: vi.fn(() => null),
  saveIncomingMessage: vi.fn(async () => ({ saved: false })),
  normalizeReaction: vi.fn(() => null),
}));

// ── Mock zalo-reaction-utils ───────────────────────────────────────────────────
vi.mock("../services/zalo-reaction-utils.js", () => ({
  normalizeReaction: vi.fn(() => null),
}));

// =============================================================================
// Helper: build a minimal mock listener (EventEmitter-like)
// =============================================================================
function makeMockListener() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    on(event: string, fn: (...args: unknown[]) => void) {
      (handlers[event] ??= []).push(fn);
    },
    emit(event: string, ...args: unknown[]) {
      (handlers[event] ?? []).forEach((fn) => fn(...args));
    },
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    removeAllListeners: vi.fn(() => {}),
    _handlers: handlers,
  };
}

function makeMockApi(listener: ReturnType<typeof makeMockListener>) {
  return {
    listener,
    getOwnId: vi.fn(() => "test-uid-zr1"),
    getOwnName: vi.fn(() => "ZR1 Test Bot"),
    sendMessage: vi.fn(async () => ({ msgId: "msg-zr1" })),
  };
}

// =============================================================================
describe("ZR1 auto-reconnect — WS event wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    zcaBoundary.login.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── ZR1-T1: "disconnected" triggers scheduleReconnect ─────────────────────
  it("ZR1-T1: WS 'disconnected' → listenerActive=false + scheduleReconnect", async () => {
    const { ZaloGatewayService } = await import("../services/zalo-gateway.service.js") as any;
    const gw = new ZaloGatewayService();
    const listener = makeMockListener();
    const api = makeMockApi(listener);

    (gw as any).api = api;
    (gw as any).listenerActive = false; // allow startListener to run
    (gw as any).status.connected = true;
    (gw as any).status.connectionStatus = "connected";

    const reconnectSpy = vi.spyOn(gw as any, "scheduleReconnect").mockImplementation(() => {});

    // Wire handlers via startListener (listenerActive=false → guard passes)
    await (gw as any).startListener();
    expect((gw as any).listenerActive).toBe(true); // now active

    // Simulate WS disconnect
    listener.emit("disconnected", 1006, "connection lost");

    expect((gw as any).listenerActive).toBe(false);
    expect((gw as any).status.connectionStatus).toBe("error");
    expect((gw as any).status.lastError).toContain("WS_DISCONNECTED");
    expect(reconnectSpy).toHaveBeenCalledTimes(1);
  });

  // ── ZR1-T2: "closed" triggers scheduleReconnect ───────────────────────────
  it("ZR1-T2: WS 'closed' → listenerActive=false + scheduleReconnect", async () => {
    const { ZaloGatewayService } = await import("../services/zalo-gateway.service.js") as any;
    const gw = new ZaloGatewayService();
    const listener = makeMockListener();
    const api = makeMockApi(listener);

    (gw as any).api = api;
    (gw as any).listenerActive = false;
    (gw as any).status.connected = true;

    const reconnectSpy = vi.spyOn(gw as any, "scheduleReconnect").mockImplementation(() => {});
    await (gw as any).startListener();

    listener.emit("closed", 1001, "going away");

    expect((gw as any).listenerActive).toBe(false);
    expect((gw as any).status.lastError).toContain("WS_CLOSED");
    expect(reconnectSpy).toHaveBeenCalledTimes(1);
  });

  // ── ZR1-T3: "error" triggers scheduleReconnect ────────────────────────────
  it("ZR1-T3: WS 'error' → listenerActive=false + scheduleReconnect", async () => {
    const { ZaloGatewayService } = await import("../services/zalo-gateway.service.js") as any;
    const gw = new ZaloGatewayService();
    const listener = makeMockListener();
    const api = makeMockApi(listener);

    (gw as any).api = api;
    (gw as any).listenerActive = false;
    (gw as any).status.connected = true;

    const reconnectSpy = vi.spyOn(gw as any, "scheduleReconnect").mockImplementation(() => {});
    await (gw as any).startListener();

    listener.emit("error", new Error("ECONNRESET"));

    expect((gw as any).listenerActive).toBe(false);
    expect((gw as any).status.lastError).toContain("WS_ERROR");
    expect(reconnectSpy).toHaveBeenCalledTimes(1);
  });

  // ── ZR1-T4: exponential backoff ──────────────────────────────────────────
  it("ZR1-T4: scheduleReconnect uses exponential backoff", async () => {
    const { ZaloGatewayService } = await import("../services/zalo-gateway.service.js") as any;
    const gw = new ZaloGatewayService();
    const restoreSpy = vi.spyOn(gw as any, "restoreSession").mockResolvedValue(true);

    // attempt=0 → delay=1000ms
    (gw as any).reconnectAttempt = 0;
    (gw as any).scheduleReconnect();
    await vi.advanceTimersByTimeAsync(999);
    expect(restoreSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(restoreSpy).toHaveBeenCalledTimes(1);

    // attempt=1 → delay=2000ms
    (gw as any).reconnectAttempt = 1;
    (gw as any).reconnectTimer = null;
    (gw as any).scheduleReconnect();
    await vi.advanceTimersByTimeAsync(1999);
    expect(restoreSpy).toHaveBeenCalledTimes(1); // not yet
    await vi.advanceTimersByTimeAsync(1);
    expect(restoreSpy).toHaveBeenCalledTimes(2); // fired
  });

  // ── ZR1-T5: no duplicate timers ──────────────────────────────────────────
  it("ZR1-T5: scheduleReconnect is idempotent (no duplicate timers)", async () => {
    const { ZaloGatewayService } = await import("../services/zalo-gateway.service.js") as any;
    const gw = new ZaloGatewayService();
    vi.spyOn(gw as any, "restoreSession").mockResolvedValue(true);

    (gw as any).scheduleReconnect();
    const t1 = (gw as any).reconnectTimer;
    (gw as any).scheduleReconnect(); // second call ignored
    const t2 = (gw as any).reconnectTimer;

    expect(t1).toBe(t2);
  });

  // ── ZR1-T6: second disconnect event after flag=false is no-op ────────────
  it("ZR1-T6: duplicate disconnect events only trigger reconnect once", async () => {
    const { ZaloGatewayService } = await import("../services/zalo-gateway.service.js") as any;
    const gw = new ZaloGatewayService();
    const listener = makeMockListener();
    const api = makeMockApi(listener);

    (gw as any).api = api;
    (gw as any).listenerActive = false;
    (gw as any).status.connected = true;

    const reconnectSpy = vi.spyOn(gw as any, "scheduleReconnect").mockImplementation(() => {});
    await (gw as any).startListener();

    listener.emit("disconnected", 1006, "lost");
    listener.emit("disconnected", 1006, "lost again"); // ignored (listenerActive already false)

    expect(reconnectSpy).toHaveBeenCalledTimes(1);
  });

  // ── ZR1-T7: valid session → restoreSession true ───────────────────────────
  it("ZR1-T7: valid session file → restoreSession returns true (no QR needed)", async () => {
    const fs = await import("node:fs");
    const sessionJson = JSON.stringify({
      selfUserId: "uid-test",
      selfDisplayName: "Test Bot",
      savedAt: String(Date.now()),
      credentials: { imei: "test-imei", cookie: [], userAgent: "test-ua", language: "vi" },
    });
    const writes = new Map<string, string>();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation((path) => (writes.get(String(path)) ?? sessionJson) as any);
    vi.mocked(fs.writeFileSync).mockImplementation((path, data) => {
      writes.set(String(path), String(data));
    });
    vi.mocked(fs.statSync).mockImplementation((path) => ({
      size: (writes.get(String(path)) ?? sessionJson).length,
    }) as any);
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      const data = writes.get(String(from));
      if (data !== undefined) {
        writes.set(String(to), data);
        writes.delete(String(from));
      }
    });

    const { ZaloGatewayService } = await import("../services/zalo-gateway.service.js") as any;
    const gw = new ZaloGatewayService();

    const mockApi = makeMockApi(makeMockListener());

    zcaBoundary.login.mockResolvedValueOnce(mockApi);

    const result = await (gw as any).restoreSession({ startListener: false });

    expect(result).toBe(true);
    expect(zcaBoundary.login).toHaveBeenCalledOnce();
    expect((gw as any).status.connected).toBe(true);
  });

  // ── ZR1-T8: no session file → false (QR needed) ──────────────────────────
  it("ZR1-T8: missing session file → restoreSession=false (QR_REQUIRED)", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const { ZaloGatewayService } = await import("../services/zalo-gateway.service.js") as any;
    const gw = new ZaloGatewayService();

    const result = await (gw as any).restoreSession({ startListener: false });

    expect(result).toBe(false);
    expect((gw as any).status.connectionStatus).toBe("error");
    expect((gw as any).status.lastError).toBe("NO_SESSION_FILE");
  });

  // ── ZR1-T9: auth invalid → false ─────────────────────────────────────────
  it("ZR1-T9: Zalo login failure → restoreSession=false", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      credentials: { imei: "x", cookie: [], userAgent: "ua" },
    }) as any);

    const { ZaloGatewayService } = await import("../services/zalo-gateway.service.js") as any;
    const gw = new ZaloGatewayService();
    (gw as any).zalo = {
      login: vi.fn(async () => { throw new Error("Đăng nhập thất bại"); }),
    };
    zcaBoundary.login.mockRejectedValueOnce(new Error("restore login failed"));

    const result = await (gw as any).restoreSession({ startListener: false });

    expect(result).toBe(false);
    expect((gw as any).status.connectionStatus).toBe("error");
    expect((gw as any).status.lastError).toMatch(/LOGIN_FAILED|RESTORE_FAILED/);
  });

  // ── ZR1-T10: dryRun=true → restoreSession returns true without FS ─────────
  it("ZR1-T10: static dryRun blocks restore before synthetic connection", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockConfig.zalo.dryRun = true;

    const { ZaloGatewayService } = await import("../services/zalo-gateway.service.js") as any;
    const gw = new ZaloGatewayService();

    try {
      const result = await (gw as any).restoreSession({ startListener: false });

      expect(result).toBe(false);
      expect((gw as any).status.connected).toBe(false);
      expect((gw as any).status.connectionStatus).toBe("blocked");
      expect((gw as any).status.lastError).toBe("LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED");
    } finally {
      mockConfig.zalo.dryRun = false;
    }
  });

  // ── ZR1-T11: getStatus() never leaks credentials ─────────────────────────
  it("ZR1-T11: getStatus() does not expose cookie, imei, or savedCredentials", async () => {
    const { ZaloGatewayService } = await import("../services/zalo-gateway.service.js") as any;
    const gw = new ZaloGatewayService();
    (gw as any).savedCredentials = {
      imei: "secret-imei",
      cookie: "secret-cookie-value",
      userAgent: "ua",
    };
    (gw as any).status.connected = true;
    (gw as any).status.selfUserId = "uid-safe-test";

    const st = gw.getStatus();
    const raw = JSON.stringify(st);

    expect(raw).not.toContain("secret-imei");
    expect(raw).not.toContain("secret-cookie-value");
    expect(raw).not.toContain("savedCredentials");
  });
});
