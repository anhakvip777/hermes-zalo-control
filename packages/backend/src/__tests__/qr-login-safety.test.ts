import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config } from "../config.js";
import { ZaloGatewayService } from "../services/zalo-gateway.service.js";

const originalStaticDryRun = config.zalo.dryRun;

afterEach(() => {
  (config.zalo as { dryRun: boolean }).dryRun = originalStaticDryRun;
  vi.restoreAllMocks();
});

describe("QR login safety", () => {
  it("blocks a fresh login before dry-run can create a synthetic connection", async () => {
    (config.zalo as { dryRun: boolean }).dryRun = true;
    const gateway = new ZaloGatewayService();

    await expect(gateway.startLogin()).resolves.toEqual({
      status: "blocked",
      reason: "STATIC_DRY_RUN_ENABLED",
    });
    expect(gateway.getStatus()).toMatchObject({
      connected: false,
      connectionStatus: "blocked",
      lastError: "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED",
    });
  });

  it("returns bytes only while the captured QR generation and timestamp remain current", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-owned-read-"));
    const qrBytes = Buffer.alloc(600, 7);
    try {
      writeFileSync(join(sessionDir, "qr-current.png"), qrBytes);
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = 3;
      (gateway as any).activeLoginGeneration = 3;
      (gateway as any).qrUpdatedAt = "2026-07-22T04:00:00.000Z";
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });

      await expect(gateway.readCurrentQr()).resolves.toEqual({
        status: "ok",
        data: qrBytes,
        updatedAt: "2026-07-22T04:00:00.000Z",
      });
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("drops bytes when the QR generation is replaced while its read is pending", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-replaced-read-"));
    try {
      writeFileSync(join(sessionDir, "qr-current.png"), Buffer.alloc(600, 1));
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = 4;
      (gateway as any).activeLoginGeneration = 4;
      (gateway as any).qrUpdatedAt = "2026-07-22T04:00:00.000Z";
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });

      const pendingRead = gateway.readCurrentQr();
      (gateway as any).loginGeneration = 5;
      (gateway as any).activeLoginGeneration = 5;
      (gateway as any).qrUpdatedAt = "2026-07-22T04:00:01.000Z";

      await expect(pendingRead).resolves.toEqual({ status: "not_found" });
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("drops bytes when the QR timestamp changes inside the same generation", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-refreshed-read-"));
    try {
      writeFileSync(join(sessionDir, "qr-current.png"), Buffer.alloc(600, 2));
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = 6;
      (gateway as any).activeLoginGeneration = 6;
      (gateway as any).qrUpdatedAt = "2026-07-22T04:00:00.000Z";
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });

      const pendingRead = gateway.readCurrentQr();
      (gateway as any).qrUpdatedAt = "2026-07-22T04:00:01.000Z";

      await expect(pendingRead).resolves.toEqual({ status: "not_found" });
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("returns a safety block without bytes when policy changes during a QR read", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-blocked-read-"));
    try {
      writeFileSync(join(sessionDir, "qr-current.png"), Buffer.alloc(600, 3));
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = 7;
      (gateway as any).activeLoginGeneration = 7;
      (gateway as any).qrUpdatedAt = "2026-07-22T04:00:00.000Z";
      vi.spyOn(gateway, "getLoginSafetyDecision")
        .mockReturnValueOnce({ allowed: true, reason: null })
        .mockReturnValue({ allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" });

      await expect(gateway.readCurrentQr()).resolves.toEqual({
        status: "blocked",
        reason: "OUTBOUND_DRY_RUN_REQUIRED",
      });
      expect(existsSync(join(sessionDir, "qr-current.png"))).toBe(false);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("removes an idle stale QR artifact when a fresh login is safety-blocked", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-idle-stale-"));
    const qrPath = join(sessionDir, "qr-current.png");
    try {
      writeFileSync(qrPath, Buffer.alloc(600));
      (config.zalo as { dryRun: boolean }).dryRun = true;
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;

      await expect(gateway.startLogin()).resolves.toMatchObject({
        status: "blocked",
        reason: "STATIC_DRY_RUN_ENABLED",
      });

      expect(existsSync(qrPath)).toBe(false);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("blocks session restore before dry-run can create a synthetic connection", async () => {
    (config.zalo as { dryRun: boolean }).dryRun = true;
    const gateway = new ZaloGatewayService();

    await expect(gateway.restoreSession()).resolves.toBe(false);
    expect(gateway.getStatus()).toMatchObject({
      connected: false,
      connectionStatus: "blocked",
      lastError: "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED",
    });
  });

  it("keeps an idle disconnected status untouched when a status read sees a denied policy", () => {
    const gateway = new ZaloGatewayService();
    const initialStatus = { ...(gateway as any).status };
    const initialGeneration = (gateway as any).loginGeneration;
    const statusListener = vi.fn();
    gateway.on("status", statusListener);
    vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({
      allowed: false,
      reason: "STATIC_DRY_RUN_ENABLED",
    });

    const status = gateway.getStatus();

    expect(status).toMatchObject({
      connectionStatus: "disconnected",
      lastError: null,
      qrAvailable: false,
    });
    expect((gateway as any).status).toEqual(initialStatus);
    expect((gateway as any).loginGeneration).toBe(initialGeneration);
    expect((gateway as any).activeLoginGeneration).toBeNull();
    expect(statusListener).not.toHaveBeenCalled();
  });

  it("cancelling QR invalidates its generation without disconnecting a truthful connection", () => {
    const gateway = new ZaloGatewayService();
    (gateway as any).status = {
      ...gateway.getStatus(),
      connected: true,
      connectionStatus: "connected",
    };
    (gateway as any).loginInProgress = true;
    (gateway as any).loginGeneration = 7;
    (gateway as any).activeLoginGeneration = 7;
    (gateway as any).qrUpdatedAt = "2026-07-21T12:00:00.000Z";

    expect(gateway.cancelLogin()).toEqual({ cancelled: true, message: "Login cancelled" });
    expect(gateway.getStatus()).toMatchObject({
      connected: true,
      connectionStatus: "connected",
      qrUpdatedAt: null,
    });
    expect((gateway as any).loginGeneration).toBe(8);
    expect((gateway as any).activeLoginGeneration).toBeNull();
  });

  it("logout invalidates a pending QR generation and removes its artifact", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-logout-"));
    const qrPath = join(sessionDir, "qr-current.png");
    try {
      writeFileSync(qrPath, Buffer.alloc(600));
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = 11;
      (gateway as any).activeLoginGeneration = 11;
      (gateway as any).qrUpdatedAt = "2026-07-21T12:00:00.000Z";

      await gateway.logout();

      expect(existsSync(qrPath)).toBe(false);
      expect((gateway as any).loginInProgress).toBe(false);
      expect((gateway as any).activeLoginGeneration).toBeNull();
      expect((gateway as any).loginGeneration).toBe(12);
      expect(gateway.getStatus()).toMatchObject({
        connected: false,
        connectionStatus: "disconnected",
        qrAvailable: false,
        qrUpdatedAt: null,
      });
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("blocks a late login success from connecting or persisting after policy becomes unsafe", async () => {
    const gateway = new ZaloGatewayService();
    const api = {
      getOwnId: () => "late-user",
      getOwnName: () => "Late User",
    };
    (gateway as any).loginInProgress = true;
    (gateway as any).loginGeneration = 4;
    (gateway as any).activeLoginGeneration = 4;

    const persistSession = vi.spyOn(gateway, "persistSession").mockResolvedValue({
      ok: true,
      message: "Session saved",
    });
    const startListener = vi.spyOn(gateway as any, "startListener").mockResolvedValue(undefined);
    const ready = vi.fn();
    gateway.on("ready", ready);
    vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({
      allowed: false,
      reason: "STATIC_DRY_RUN_ENABLED",
    });

    await (gateway as any).onLoginSuccess(4, {
      zalo: { source: "late-qr" },
      api,
      credentials: null,
    });

    expect(gateway.getStatus()).toMatchObject({
      connected: false,
      connectionStatus: "blocked",
      lastError: "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED",
    });
    expect((gateway as any).activeLoginGeneration).toBeNull();
    expect((gateway as any).loginGeneration).toBe(5);
    expect(persistSession).not.toHaveBeenCalled();
    expect(startListener).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });

  it("hides a stale QR when the safety decision is blocked", () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-safety-"));
    try {
      writeFileSync(join(sessionDir, "qr-current.png"), Buffer.alloc(600));
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = 3;
      (gateway as any).activeLoginGeneration = 3;
      (gateway as any).qrUpdatedAt = "2026-07-21T12:00:00.000Z";
      (config.zalo as { dryRun: boolean }).dryRun = true;

      expect(gateway.getStatus().qrAvailable).toBe(false);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("cleans an active QR flow and blocks status when the policy becomes blocked", () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-safety-"));
    const qrPath = join(sessionDir, "qr-current.png");
    try {
      writeFileSync(qrPath, Buffer.alloc(600));
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = 3;
      (gateway as any).activeLoginGeneration = 3;
      (gateway as any).qrUpdatedAt = "2026-07-21T12:00:00.000Z";
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({
        allowed: false,
        reason: "STATIC_DRY_RUN_ENABLED",
      });

      expect(gateway.getStatus()).toMatchObject({
        connectionStatus: "blocked",
        lastError: "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED",
        qrAvailable: false,
        qrUpdatedAt: null,
      });
      expect(existsSync(qrPath)).toBe(false);
      expect((gateway as any).loginGeneration).toBe(4);
      expect((gateway as any).activeLoginGeneration).toBeNull();
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("emits one final blocked status when safety blocks an active QR during a status update", () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-safety-"));
    try {
      writeFileSync(join(sessionDir, "qr-current.png"), Buffer.alloc(600));
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;
      (gateway as any).status = {
        ...(gateway as any).status,
        connected: false,
        connectionStatus: "disconnected",
      };
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = 3;
      (gateway as any).activeLoginGeneration = 3;
      (gateway as any).qrUpdatedAt = "2026-07-21T12:00:00.000Z";
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({
        allowed: false,
        reason: "STATIC_DRY_RUN_ENABLED",
      });
      const statusListener = vi.fn();
      gateway.on("status", statusListener);

      (gateway as any).setStatus({ connectionStatus: "waiting_qr_scan" });

      expect(statusListener).toHaveBeenCalledTimes(1);
      expect(statusListener).toHaveBeenLastCalledWith(expect.objectContaining({
        connectionStatus: "blocked",
        lastError: "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED",
        qrAvailable: false,
      }));
      expect((gateway as any).loginInProgress).toBe(false);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("cleans an active QR flow without disconnecting when the policy becomes blocked", () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-safety-"));
    const qrPath = join(sessionDir, "qr-current.png");
    try {
      writeFileSync(qrPath, Buffer.alloc(600));
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;
      (gateway as any).status = {
        ...gateway.getStatus(),
        connected: true,
        connectionStatus: "connected",
      };
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = 3;
      (gateway as any).activeLoginGeneration = 3;
      (gateway as any).qrUpdatedAt = "2026-07-21T12:00:00.000Z";
      const stopListener = vi.spyOn(gateway as any, "stopListener");
      const startListener = vi.spyOn(gateway as any, "startListener");
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({
        allowed: false,
        reason: "STATIC_DRY_RUN_ENABLED",
      });

      expect(gateway.getStatus()).toMatchObject({
        connected: true,
        connectionStatus: "connected",
        qrAvailable: false,
        qrUpdatedAt: null,
      });
      expect(existsSync(qrPath)).toBe(false);
      expect((gateway as any).loginGeneration).toBe(4);
      expect((gateway as any).activeLoginGeneration).toBeNull();
      expect(stopListener).not.toHaveBeenCalled();
      expect(startListener).not.toHaveBeenCalled();
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("expires a current QR by clearing its stale file and availability", () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-expired-"));
    const qrPath = join(sessionDir, "qr-current.png");
    const retainedPath = join(sessionDir, "qr-history.png");
    try {
      writeFileSync(qrPath, Buffer.alloc(600));
      writeFileSync(retainedPath, Buffer.alloc(600));
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = 5;
      (gateway as any).activeLoginGeneration = 5;
      (gateway as any).qrUpdatedAt = "2026-07-21T12:00:00.000Z";
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });

      (gateway as any).expireQrLogin(5, qrPath);

      expect(existsSync(qrPath)).toBe(false);
      expect(existsSync(retainedPath)).toBe(true);
      expect(gateway.getStatus()).toMatchObject({
        connectionStatus: "expired",
        qrAvailable: false,
        qrUpdatedAt: null,
      });
      expect((gateway as any).loginInProgress).toBe(false);
      expect((gateway as any).activeLoginGeneration).toBeNull();
      expect((gateway as any).loginGeneration).toBe(6);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("rolls back QR-owned API and credentials when expiry arrives after assignment", () => {
    const gateway = new ZaloGatewayService();
    const originalStatus = { ...(gateway as any).status };
    (gateway as any).loginInProgress = true;
    (gateway as any).loginGeneration = 12;
    (gateway as any).activeLoginGeneration = 12;
    (gateway as any).activeLoginOperation = {
      generation: 12,
      status: originalStatus,
      api: null,
      zalo: null,
      savedCredentials: null,
      listenerActive: false,
      listenerBindings: null,
      lastListenerBeatAt: null,
      stagedSessionPath: null,
    };
    (gateway as any).api = { source: "late-qr-api" };
    (gateway as any).zalo = { source: "late-qr-client" };
    (gateway as any).savedCredentials = { cookie: [{ key: "late", value: "credential" }] };
    (gateway as any).status = { ...originalStatus, connectionStatus: "waiting_qr_scan" };
    vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });

    (gateway as any).expireQrLogin(12, "unused-by-generation-cleanup.png");

    expect(gateway.getApi()).toBeNull();
    expect((gateway as any).zalo).toBeNull();
    expect((gateway as any).savedCredentials).toBeNull();
    expect((gateway as any).activeLoginOperation).toBeNull();
    expect(gateway.getStatus()).toMatchObject({
      connected: false,
      connectionStatus: "expired",
      lastError: null,
    });
  });

  it("does not commit or advertise QR success when listener startup returns no binding", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "zalo-qr-listener-null-"));
    try {
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;
      const originalStatus = { ...(gateway as any).status };
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = 13;
      (gateway as any).activeLoginGeneration = 13;
      (gateway as any).activeLoginOperation = {
        generation: 13,
        status: originalStatus,
        api: null,
        zalo: null,
        savedCredentials: null,
        listenerActive: false,
        listenerBindings: null,
        lastListenerBeatAt: null,
        stagedSessionPath: null,
      };
      const api = {
        getOwnId: () => "listener-null-user",
        getOwnName: () => "Listener Null User",
      };
      const zalo = { source: "qr-login" };
      const credentials = { cookie: [{ key: "listener", value: "null" }] };
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
      vi.spyOn(gateway as any, "startListener").mockResolvedValue(null);
      const commit = vi.spyOn(gateway as any, "commitStagedSessionOrThrow").mockImplementation(() => {});
      const ready = vi.fn();
      gateway.on("ready", ready);

      await expect((gateway as any).onLoginSuccess(13, { zalo, api, credentials })).rejects.toThrow("LISTENER_START_FAILED");

      expect(commit).not.toHaveBeenCalled();
      expect(ready).not.toHaveBeenCalled();
      expect(gateway.getApi()).toBeNull();
      expect((gateway as any).activeLoginOperation).toBeNull();
      expect(gateway.getStatus()).toMatchObject({ connected: false, connectionStatus: "error" });
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("cleans the successful QR generation and artifact before emitting ready", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hermes-qr-success-"));
    const sessionDir = join(workspaceRoot, "zalo-session");
    const qrPath = join(sessionDir, "qr-current.png");
    try {
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(qrPath, Buffer.alloc(600));
      const gateway = new ZaloGatewayService();
      class ReadyListener extends EventEmitter {
        start = vi.fn(async () => {});
        stop = vi.fn(async () => {});
      }
      const listener = new ReadyListener();
      const api = {
        listener,
        getOwnId: () => "ready-user",
        getOwnName: () => "Ready User",
      };
      (gateway as any).sessionDir = sessionDir;
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = 6;
      (gateway as any).activeLoginGeneration = 6;
      (gateway as any).activeLoginOperation = {
        generation: 6,
        status: { ...(gateway as any).status },
        api: null,
        zalo: null,
        savedCredentials: null,
        listenerActive: false,
        listenerBindings: null,
        lastListenerBeatAt: null,
        stagedSessionPath: null,
      };
      const zalo = { source: "qr-login" };
      const credentials = { cookie: [{ key: "ready", value: "ready" }] };
      (gateway as any).qrUpdatedAt = "2026-07-21T12:00:00.000Z";
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
      const stageSession = vi.spyOn(gateway as any, "stageSessionOrThrow");
      const startListener = vi.spyOn(gateway as any, "startListener");
      let stateAtReady: Record<string, unknown> | null = null;
      const ready = vi.fn(() => {
        stateAtReady = {
          loginInProgress: (gateway as any).loginInProgress,
          activeLoginGeneration: (gateway as any).activeLoginGeneration,
          loginGeneration: (gateway as any).loginGeneration,
          qrUpdatedAt: gateway.getStatus().qrUpdatedAt,
          qrExists: existsSync(qrPath),
        };
      });
      gateway.on("ready", ready);

      await (gateway as any).onLoginSuccess(6, { zalo, api, credentials });

      expect(stageSession).toHaveBeenCalledOnce();
      expect(startListener).toHaveBeenCalledOnce();
      expect(ready).toHaveBeenCalledWith(api);
      expect(stateAtReady).toEqual({
        loginInProgress: false,
        activeLoginGeneration: null,
        loginGeneration: 7,
        qrUpdatedAt: null,
        qrExists: false,
      });
      expect(gateway.getStatus()).toMatchObject({
        connected: true,
        connectionStatus: "connected",
        qrAvailable: false,
        qrUpdatedAt: null,
      });
      await (gateway as any).stopListener();
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("stops the exact owned listener after a status read blocks its pending start", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-listener-block-"));
    const qrPath = join(sessionDir, "qr-current.png");
    try {
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;
      (config.zalo as { dryRun: boolean }).dryRun = false;

      let blocked = false;
      vi.spyOn(gateway, "getLoginSafetyDecision").mockImplementation(() => blocked
        ? { allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" }
        : { allowed: true, reason: null });
      vi.spyOn(gateway, "restoreSession").mockResolvedValue(false);
      vi.spyOn(gateway as any, "runLoginInBackground").mockResolvedValue(undefined);

      await expect(gateway.startLogin()).resolves.toMatchObject({ status: "connecting" });
      const generation = (gateway as any).activeLoginGeneration as number;
      writeFileSync(qrPath, Buffer.alloc(600));

      let signalListenerStarted!: () => void;
      const listenerStarted = new Promise<void>((resolve) => { signalListenerStarted = resolve; });
      let finishListenerStart!: () => void;
      const listenerCanFinish = new Promise<void>((resolve) => { finishListenerStart = resolve; });
      const stopSawSettledStart: boolean[] = [];
      class FakeListener extends EventEmitter {
        startSettled = false;
        live = false;
        start = vi.fn(async () => {
          signalListenerStarted();
          await listenerCanFinish;
          this.startSettled = true;
          this.live = true;
        });
        stop = vi.fn(async () => {
          stopSawSettledStart.push(this.startSettled);
          if (this.startSettled) this.live = false;
        });
      }
      const listener = new FakeListener();
      const api = {
        listener,
        getOwnId: () => "listener-user",
        getOwnName: () => "Listener User",
      };
      const liveZalo = { source: "qr-login" };
      const liveCredentials = { cookie: [{ key: "qr-key", value: "qr-value" }] };
      (gateway as any).qrUpdatedAt = "2026-07-21T12:00:00.000Z";
      vi.spyOn(gateway, "persistSession").mockResolvedValue({ ok: true, message: "Session saved" });
      const ready = vi.fn();
      gateway.on("ready", ready);

      const loginSuccess = (gateway as any).onLoginSuccess(generation, {
        zalo: liveZalo,
        api,
        credentials: liveCredentials,
      });
      await listenerStarted;
      const ownedHandlers = new Map(
        ["message", "reaction", "disconnected", "closed", "error"]
          .map((event) => [event, listener.listeners(event)[0]]),
      );
      expect((gateway as any).listenerBindings).toBeNull();

      blocked = true;
      expect(gateway.getStatus()).toMatchObject({
        connected: false,
        connectionStatus: "blocked",
        lastError: "LOGIN_SAFETY_BLOCKED:OUTBOUND_DRY_RUN_REQUIRED",
      });
      finishListenerStart();
      await loginSuccess;

      expect(listener.start).toHaveBeenCalledOnce();
      expect(stopSawSettledStart).toContain(true);
      expect(listener.live).toBe(false);
      expect((gateway as any).listenerActive).toBe(false);
      expect((gateway as any).listenerBindings).toBeNull();
      for (const event of ["message", "reaction", "disconnected", "closed", "error"]) {
        expect(listener.listeners(event)).not.toContain(ownedHandlers.get(event));
        expect(listener.listenerCount(event)).toBe(0);
      }
      expect(ready).not.toHaveBeenCalled();
      expect(existsSync(qrPath)).toBe(false);
      expect((gateway as any).loginInProgress).toBe(false);
      expect((gateway as any).activeLoginGeneration).toBeNull();
      expect((gateway as any).loginGeneration).toBe(generation + 1);
      expect(gateway.getApi()).toBeNull();
      expect((gateway as any).zalo).toBeNull();
      expect((gateway as any).savedCredentials).toBeNull();
      expect(gateway.getStatus()).toMatchObject({
        connected: false,
        connectionStatus: "blocked",
        lastError: "LOGIN_SAFETY_BLOCKED:OUTBOUND_DRY_RUN_REQUIRED",
        qrAvailable: false,
        qrUpdatedAt: null,
      });
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("rolls back QR ownership and detaches only owned handlers when listener start rejects", async () => {
    const gateway = new ZaloGatewayService();
    (config.zalo as { dryRun: boolean }).dryRun = false;
    vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
    vi.spyOn(gateway, "restoreSession").mockResolvedValue(false);
    vi.spyOn(gateway as any, "runLoginInBackground").mockResolvedValue(undefined);

    await expect(gateway.startLogin()).resolves.toMatchObject({ status: "connecting" });
    const generation = (gateway as any).activeLoginGeneration as number;

    let signalListenerStarted!: () => void;
    const listenerStarted = new Promise<void>((resolve) => { signalListenerStarted = resolve; });
    let rejectListenerStart!: (error: Error) => void;
    const listenerCanReject = new Promise<void>((_resolve, reject) => { rejectListenerStart = reject; });
    class RejectingListener extends EventEmitter {
      start = vi.fn(async () => {
        signalListenerStarted();
        await listenerCanReject;
      });
      stop = vi.fn(async () => {});
    }
    const listener = new RejectingListener();
    const externalHandlers = new Map<string, () => void>();
    for (const event of ["message", "reaction", "disconnected", "closed", "error"]) {
      const handler = () => {};
      externalHandlers.set(event, handler);
      listener.on(event, handler);
    }
    const api = {
      listener,
      getOwnId: () => "reject-user",
      getOwnName: () => "Reject User",
    };
    const zalo = { source: "qr-login" };
    const credentials = { cookie: [{ key: "reject-key", value: "reject-value" }] };
    vi.spyOn(gateway, "persistSession").mockResolvedValue({ ok: true, message: "Session saved" });
    const ready = vi.fn();
    gateway.on("ready", ready);

    const loginSuccess = (gateway as any).onLoginSuccess(generation, {
      zalo,
      api,
      credentials,
    }) as Promise<void>;
    const loginRejected = expect(loginSuccess).rejects.toThrow("listener start failed");
    await listenerStarted;
    const ownedHandlers = new Map(
      ["message", "reaction", "disconnected", "closed", "error"]
        .map((event) => [event, listener.listeners(event).find((handler) => handler !== externalHandlers.get(event))]),
    );
    expect((gateway as any).listenerBindings).toBeNull();
    rejectListenerStart(new Error("listener start failed"));
    await loginRejected;

    expect(listener.stop).toHaveBeenCalledOnce();
    for (const event of ["message", "reaction", "disconnected", "closed", "error"]) {
      expect(listener.listeners(event)).toEqual([externalHandlers.get(event)]);
      expect(listener.listeners(event)).not.toContain(ownedHandlers.get(event));
    }
    expect(gateway.getApi()).toBeNull();
    expect((gateway as any).zalo).toBeNull();
    expect((gateway as any).savedCredentials).toBeNull();
    expect((gateway as any).listenerActive).toBe(false);
    expect((gateway as any).listenerBindings).toBeNull();
    expect((gateway as any).loginInProgress).toBe(false);
    expect((gateway as any).activeLoginGeneration).toBeNull();
    expect((gateway as any).activeLoginOperation).toBeNull();
    expect((gateway as any).loginGeneration).toBe(generation + 1);
    expect(ready).not.toHaveBeenCalled();
    expect(gateway.getStatus()).toMatchObject({
      connected: false,
      connectionStatus: "error",
      lastError: "listener start failed",
    });

    const retry = await gateway.startLogin();
    expect(retry.status).toBe("connecting");
    expect(retry.status).not.toBe("already_connected");
  });

  it("keeps a pre-existing connection and listener untouched when a new start is requested", async () => {
    const gateway = new ZaloGatewayService();
    const existingApi = { listener: new EventEmitter() };
    (gateway as any).api = existingApi;
    (gateway as any).listenerActive = true;
    (gateway as any).status = {
      ...(gateway as any).status,
      connected: true,
      connectionStatus: "connected",
    };
    vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({
      allowed: false,
      reason: "STATIC_DRY_RUN_ENABLED",
    });
    const restoreSession = vi.spyOn(gateway, "restoreSession");
    const startListener = vi.spyOn(gateway as any, "startListener");
    const stopListener = vi.spyOn(gateway as any, "stopListener");

    await expect(gateway.startLogin()).resolves.toEqual({
      status: "already_connected",
      qrImage: "Zalo is already connected.",
    });

    expect(gateway.getApi()).toBe(existingApi);
    expect(gateway.getStatus()).toMatchObject({ connected: true, connectionStatus: "connected" });
    expect((gateway as any).listenerActive).toBe(true);
    expect(restoreSession).not.toHaveBeenCalled();
    expect(startListener).not.toHaveBeenCalled();
    expect(stopListener).not.toHaveBeenCalled();
  });

  it("detaches only gateway-owned listener callbacks and does not duplicate them on restart", async () => {
    class FakeListener extends EventEmitter {
      start = vi.fn(async () => {});
      stop = vi.fn(async () => {});
    }

    const gateway = new ZaloGatewayService();
    const listener = new FakeListener();
    const externalHandlers = new Map<string, () => void>();
    for (const event of ["message", "reaction", "disconnected", "closed", "error"]) {
      const handler = () => {};
      externalHandlers.set(event, handler);
      listener.on(event, handler);
    }
    (gateway as any).api = { listener };

    await (gateway as any).startListener();
    expect(listener.start).toHaveBeenCalledOnce();
    expect(listener.listenerCount("message")).toBe(2);
    expect(listener.listenerCount("reaction")).toBe(2);
    expect(listener.listenerCount("disconnected")).toBe(2);
    expect(listener.listenerCount("closed")).toBe(2);
    expect(listener.listenerCount("error")).toBe(2);

    await (gateway as any).stopListener();
    expect(listener.stop).toHaveBeenCalledOnce();
    for (const event of ["message", "reaction", "disconnected", "closed", "error"]) {
      expect(listener.listeners(event)).toEqual([externalHandlers.get(event)]);
    }

    await (gateway as any).startListener();
    expect(listener.start).toHaveBeenCalledTimes(2);
    for (const event of ["message", "reaction", "disconnected", "closed", "error"]) {
      expect(listener.listenerCount(event)).toBe(2);
    }
    await (gateway as any).stopListener();
  });

  it("does not let an older pending listener start overwrite a newer listener", async () => {
    class DeferredListener extends EventEmitter {
      start = vi.fn(async () => {});
      stop = vi.fn(async () => {});
    }

    const first = new DeferredListener();
    let resolveFirstStart!: () => void;
    first.start.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveFirstStart = resolve;
    }));
    const second = new DeferredListener();
    const gateway = new ZaloGatewayService();
    (gateway as any).api = { listener: first };

    const firstStart = (gateway as any).startListener() as Promise<unknown>;
    await vi.waitFor(() => expect(first.start).toHaveBeenCalledOnce());
    await (gateway as any).stopListener();

    (gateway as any).api = { listener: second };
    await (gateway as any).startListener();
    expect((gateway as any).listenerBindings.listener).toBe(second);
    expect((gateway as any).listenerActive).toBe(true);

    resolveFirstStart();
    await firstStart;

    expect(first.stop).toHaveBeenCalled();
    expect((gateway as any).listenerBindings.listener).toBe(second);
    expect((gateway as any).listenerActive).toBe(true);
  });

  it("does not resurrect a listener when its pending start finishes after stop", async () => {
    class DeferredListener extends EventEmitter {
      startSettled = false;
      live = false;
      start = vi.fn(async () => {});
      stop = vi.fn(async () => {
        if (this.startSettled) this.live = false;
      });
    }

    const listener = new DeferredListener();
    let resolveStart!: () => void;
    listener.start.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { resolveStart = resolve; });
      listener.startSettled = true;
      listener.live = true;
    });
    const gateway = new ZaloGatewayService();
    (gateway as any).api = { listener };

    const pendingStart = (gateway as any).startListener() as Promise<unknown>;
    await vi.waitFor(() => expect(listener.start).toHaveBeenCalledOnce());
    await (gateway as any).stopListener();

    resolveStart();
    await expect(pendingStart).resolves.toBeNull();

    expect(listener.stop).toHaveBeenCalledTimes(2);
    expect(listener.live).toBe(false);
    expect((gateway as any).listenerActive).toBe(false);
    expect((gateway as any).listenerBindings).toBeNull();
    expect((gateway as any).lastListenerBeatAt).toBeNull();
    for (const event of ["message", "reaction", "disconnected", "closed", "error"]) {
      expect(listener.listenerCount(event)).toBe(0);
    }
  });

  it.each(["rejects", "returns_not_ok"] as const)(
    "rolls back QR success when session persistence %s",
    async (mode) => {
      const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-persist-fail-"));
      const qrPath = join(sessionDir, "qr-current.png");
      try {
        writeFileSync(qrPath, Buffer.alloc(600));
        const gateway = new ZaloGatewayService();
        (gateway as any).sessionDir = sessionDir;
        (config.zalo as { dryRun: boolean }).dryRun = false;
        vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
        vi.spyOn(gateway, "restoreSession").mockResolvedValue(false);
        vi.spyOn(gateway as any, "runLoginInBackground").mockResolvedValue(undefined);

        await expect(gateway.startLogin()).resolves.toMatchObject({ status: "connecting" });
        const generation = (gateway as any).activeLoginGeneration as number;
        const api = {
          getOwnId: () => "persist-user",
          getOwnName: () => "Persist User",
        };
        const zalo = { source: "qr-login" };
        const credentials = { cookie: [{ key: "persist-key", value: "persist-value" }] };
        (gateway as any).qrUpdatedAt = "2026-07-22T05:00:00.000Z";

        const stageSession = vi.spyOn(gateway as any, "stageSessionOrThrow");
        if (mode === "rejects") {
          stageSession.mockRejectedValue(new Error("PERSIST_FAILED:disk unavailable"));
        } else {
          stageSession.mockRejectedValue(new Error("PERSIST_FAILED:write verification failed"));
        }
        const startListener = vi.spyOn(gateway as any, "startListener").mockResolvedValue(undefined);
        const ready = vi.fn();
        gateway.on("ready", ready);

        await expect((gateway as any).onLoginSuccess(generation, {
          zalo,
          api,
          credentials,
        })).rejects.toThrow("PERSIST_FAILED");

        expect(startListener).not.toHaveBeenCalled();
        expect(ready).not.toHaveBeenCalled();
        expect(gateway.getApi()).toBeNull();
        expect((gateway as any).zalo).toBeNull();
        expect((gateway as any).savedCredentials).toBeNull();
        expect((gateway as any).listenerActive).toBe(false);
        expect((gateway as any).listenerBindings).toBeNull();
        expect((gateway as any).loginInProgress).toBe(false);
        expect((gateway as any).activeLoginGeneration).toBeNull();
        expect((gateway as any).activeLoginOperation).toBeNull();
        expect(existsSync(qrPath)).toBe(false);
        expect(gateway.getStatus()).toMatchObject({
          connected: false,
          connectionStatus: "error",
          qrAvailable: false,
          qrUpdatedAt: null,
        });
      } finally {
        rmSync(sessionDir, { recursive: true, force: true });
      }
    },
  );

  it("does not restore or start login when reconnect becomes blocked before its timer fires", async () => {
    vi.useFakeTimers();
    try {
      const gateway = new ZaloGatewayService();
      vi.spyOn(gateway, "getLoginSafetyDecision")
        .mockReturnValueOnce({ allowed: true, reason: null })
        .mockReturnValue({ allowed: false, reason: "STATIC_DRY_RUN_ENABLED" });
      const restoreSession = vi.spyOn(gateway, "restoreSession").mockResolvedValue(false);
      const startLogin = vi.spyOn(gateway, "startLogin").mockResolvedValue({ status: "blocked", reason: "STATIC_DRY_RUN_ENABLED" });

      (gateway as any).scheduleReconnect();
      await vi.runAllTimersAsync();

      expect(restoreSession).not.toHaveBeenCalled();
      expect(startLogin).not.toHaveBeenCalled();
      expect((gateway as any).reconnectTimer).toBeNull();
      expect((gateway as any).reconnectAttempt).toBe(0);
      expect((gateway as any).recoveryState).toBe("idle");
      expect((gateway as any).lastReconnectError).toBe("LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not accept watchdog recovery when the login safety gate is blocked", () => {
    const gateway = new ZaloGatewayService();
    vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({
      allowed: false,
      reason: "STATIC_DRY_RUN_ENABLED",
    });
    const scheduleReconnect = vi.spyOn(gateway as any, "scheduleReconnect");
    (gateway as any).reconnectAttempt = 7;

    expect(gateway.requestRecovery("blocked-policy")).toBe(false);
    expect(scheduleReconnect).not.toHaveBeenCalled();
    expect(gateway.getRecoveryStatus()).toMatchObject({
      recoveryState: "idle",
      reconnectAttempts: 0,
      lastReconnectError: "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED",
    });
    expect(gateway.getStatus()).toMatchObject({
      connectionStatus: "blocked",
      lastError: "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED",
    });
  });

  it("cancels a pending reconnect timer as soon as policy becomes blocked", () => {
    vi.useFakeTimers();
    try {
      const gateway = new ZaloGatewayService();
      vi.spyOn(gateway, "getLoginSafetyDecision")
        .mockReturnValueOnce({ allowed: true, reason: null })
        .mockReturnValue({ allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" });
      const restoreSession = vi.spyOn(gateway, "restoreSession").mockResolvedValue(false);

      (gateway as any).scheduleReconnect();
      expect((gateway as any).reconnectTimer).not.toBeNull();
      (gateway as any).scheduleReconnect();

      expect((gateway as any).reconnectTimer).toBeNull();
      expect((gateway as any).reconnectAttempt).toBe(0);
      expect((gateway as any).recoveryState).toBe("idle");
      expect((gateway as any).lastReconnectError).toBe("LOGIN_SAFETY_BLOCKED:OUTBOUND_DRY_RUN_REQUIRED");
      vi.runAllTimers();
      expect(restoreSession).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("requestRecovery clears an existing timer when the policy becomes blocked", () => {
    vi.useFakeTimers();
    try {
      const gateway = new ZaloGatewayService();
      vi.spyOn(gateway, "getLoginSafetyDecision")
        .mockReturnValueOnce({ allowed: true, reason: null })
        .mockReturnValue({ allowed: false, reason: "STATIC_DRY_RUN_ENABLED" });

      (gateway as any).scheduleReconnect();
      expect((gateway as any).reconnectTimer).not.toBeNull();

      expect(gateway.requestRecovery("policy-flip")).toBe(false);
      expect((gateway as any).reconnectTimer).toBeNull();
      expect((gateway as any).lastReconnectError).toBe("LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED");
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforceLoginSafety clears stale recovery state from a denied policy", () => {
    vi.useFakeTimers();
    try {
      const gateway = new ZaloGatewayService();
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({
        allowed: false,
        reason: "STATIC_DRY_RUN_ENABLED",
      });
      (gateway as any).reconnectTimer = setTimeout(() => {}, 60_000);
      (gateway as any).reconnectAttempt = 6;
      (gateway as any).recoveryState = "reconnecting";
      (gateway as any).lastReconnectError = "OLD_NETWORK_ERROR";

      expect(gateway.enforceLoginSafety()).toEqual({
        allowed: false,
        reason: "STATIC_DRY_RUN_ENABLED",
      });
      expect((gateway as any).reconnectTimer).toBeNull();
      expect(gateway.getRecoveryStatus()).toMatchObject({
        recoveryState: "idle",
        reconnectAttempts: 0,
        lastReconnectError: "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
