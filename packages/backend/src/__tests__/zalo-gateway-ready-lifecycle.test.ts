import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config } from "../config.js";
import { ZaloGatewayService } from "../services/zalo-gateway.service.js";

const reactionBoundary = vi.hoisted(() => ({
  handleIncomingReaction: vi.fn(async () => {}),
}));

vi.mock("../services/zalo-reaction.service.js", () => reactionBoundary);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

afterEach(() => {
  reactionBoundary.handleIncomingReaction.mockClear();
  vi.restoreAllMocks();
});

describe("Zalo gateway ready lifecycle", () => {
  it("keeps QR artifacts local until commit, then publishes them before connected and ready", async () => {
    const listenerMayFinish = deferred<void>();
    class PendingListener extends EventEmitter {
      start = vi.fn(async () => {
        await listenerMayFinish.promise;
      });
      stop = vi.fn(async () => {});
    }

    const listener = new PendingListener();
    const localZalo = { owner: "qr-generation" };
    const localApi = {
      listener,
      getOwnId: () => "local-user",
      getOwnName: () => "Local User",
    };
    const localCredentials = { cookie: [{ key: "local", value: "redacted" }] };
    const gateway = new ZaloGatewayService();
    const generation = 19;
    (gateway as any).status = {
      ...(gateway as any).status,
      connected: false,
      connectionStatus: "waiting_qr_scan",
    };
    (gateway as any).loginInProgress = true;
    (gateway as any).loginGeneration = generation;
    (gateway as any).activeLoginGeneration = generation;
    (gateway as any).activeLoginOperation = {
      generation,
      status: { ...(gateway as any).status },
      api: null,
      zalo: null,
      savedCredentials: null,
      listenerActive: false,
      listenerBindings: null,
      lastListenerBeatAt: null,
      stagedSessionPath: null,
    };
    vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });

    const sessionMayFinish = deferred<void>();
    const stageSession = vi.spyOn(gateway as any, "stageSessionOrThrow")
      .mockImplementation(async (...args: unknown[]) => {
        expect(args[3]).toBe(localCredentials);
        await sessionMayFinish.promise;
      });
    const transitions: string[] = [];
    const commit = vi.spyOn(gateway as any, "commitStagedSessionOrThrow")
      .mockImplementation(() => {
        transitions.push("commit");
        expect(gateway.getApi()).toBeNull();
        expect((gateway as any).zalo).toBeNull();
        expect((gateway as any).savedCredentials).toBeNull();
        expect((gateway as any).listenerBindings).toBeNull();
        expect((gateway as any).listenerActive).toBe(false);
      });
    let stateAtConnected: Record<string, unknown> | null = null;
    const originalSetConnected = (gateway as any).setConnected.bind(gateway);
    vi.spyOn(gateway as any, "setConnected").mockImplementation((opts: unknown) => {
      transitions.push("connected");
      stateAtConnected = {
        api: gateway.getApi(),
        zalo: (gateway as any).zalo,
        credentials: (gateway as any).savedCredentials,
        listenerBindings: (gateway as any).listenerBindings,
        listenerActive: (gateway as any).listenerActive,
      };
      originalSetConnected(opts);
    });
    let stateAtReady: Record<string, unknown> | null = null;
    const ready = vi.fn((readyApi: unknown) => {
      transitions.push("ready");
      stateAtReady = {
        readyApi,
        api: gateway.getApi(),
        zalo: (gateway as any).zalo,
        credentials: (gateway as any).savedCredentials,
      };
    });
    gateway.on("ready", ready);

    const loginSuccess = (gateway as any).onLoginSuccess(generation, {
      zalo: localZalo,
      api: localApi,
      credentials: localCredentials,
    }) as Promise<void>;
    void loginSuccess.catch(() => {});
    await vi.waitFor(() => expect(stageSession).toHaveBeenCalledOnce());

    expect(gateway.getApi()).toBeNull();
    expect((gateway as any).zalo).toBeNull();
    expect((gateway as any).savedCredentials).toBeNull();
    expect((gateway as any).listenerBindings).toBeNull();
    expect((gateway as any).listenerActive).toBe(false);

    sessionMayFinish.resolve();
    await vi.waitFor(() => expect(listener.start).toHaveBeenCalledOnce());
    expect(gateway.getApi()).toBeNull();
    expect((gateway as any).zalo).toBeNull();
    expect((gateway as any).savedCredentials).toBeNull();
    expect((gateway as any).listenerBindings).toBeNull();
    expect((gateway as any).listenerActive).toBe(false);

    listenerMayFinish.resolve();
    await loginSuccess;

    expect(commit).toHaveBeenCalledOnce();
    expect(transitions).toEqual(["commit", "connected", "ready"]);
    expect(stateAtConnected).toEqual({
      api: localApi,
      zalo: localZalo,
      credentials: localCredentials,
      listenerBindings: expect.objectContaining({ listener }),
      listenerActive: true,
    });
    expect(stateAtReady).toEqual({
      readyApi: localApi,
      api: localApi,
      zalo: localZalo,
      credentials: localCredentials,
    });
    await (gateway as any).stopListener();
  });

  it("stops a locally-owned QR listener when the final session commit fails", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-local-commit-fail-"));
    try {
      class Listener extends EventEmitter {
        start = vi.fn(async () => {});
        stop = vi.fn(async () => {});
      }
      const listener = new Listener();
      const api = {
        listener,
        getOwnId: () => "commit-fail-user",
        getOwnName: () => "Commit Fail User",
      };
      const zalo = { owner: "commit-fail-qr" };
      const credentials = { cookie: [{ key: "commit-fail", value: "redacted" }] };
      const gateway = new ZaloGatewayService();
      const generation = 20;
      (gateway as any).sessionDir = sessionDir;
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = generation;
      (gateway as any).activeLoginGeneration = generation;
      (gateway as any).activeLoginOperation = {
        generation,
        status: { ...(gateway as any).status },
        api: null,
        zalo: null,
        savedCredentials: null,
        listenerActive: false,
        listenerBindings: null,
        lastListenerBeatAt: null,
        stagedSessionPath: null,
      };
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
      vi.spyOn(gateway as any, "commitStagedSessionOrThrow").mockImplementation(() => {
        throw new Error("commit failed");
      });

      await expect((gateway as any).onLoginSuccess(generation, { zalo, api, credentials }))
        .rejects.toThrow("commit failed");

      expect(listener.start).toHaveBeenCalledOnce();
      expect(listener.stop).toHaveBeenCalledOnce();
      expect(listener.listenerCount("message")).toBe(0);
      expect(listener.listenerCount("reaction")).toBe(0);
      expect(listener.listenerCount("disconnected")).toBe(0);
      expect(listener.listenerCount("closed")).toBe(0);
      expect(listener.listenerCount("error")).toBe(0);
      expect(gateway.getApi()).toBeNull();
      expect((gateway as any).zalo).toBeNull();
      expect((gateway as any).savedCredentials).toBeNull();
      expect((gateway as any).listenerBindings).toBeNull();
      expect((gateway as any).listenerActive).toBe(false);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("does not let stale commit cleanup invalidate a newer QR generation", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-stale-commit-cleanup-"));
    const stopMayFinish = deferred<void>();
    try {
      class Listener extends EventEmitter {
        start = vi.fn(async () => {});
        stop = vi.fn(async () => {
          await stopMayFinish.promise;
        });
      }
      const listener = new Listener();
      const api = {
        listener,
        getOwnId: () => "stale-cleanup-user",
        getOwnName: () => "Stale Cleanup User",
      };
      const gateway = new ZaloGatewayService();
      const generation = 22;
      (gateway as any).sessionDir = sessionDir;
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = generation;
      (gateway as any).activeLoginGeneration = generation;
      (gateway as any).activeLoginOperation = {
        generation,
        status: { ...(gateway as any).status },
        api: null,
        zalo: null,
        savedCredentials: null,
        listenerActive: false,
        listenerBindings: null,
        lastListenerBeatAt: null,
        stagedSessionPath: null,
      };
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
      vi.spyOn(gateway as any, "commitStagedSessionOrThrow").mockImplementation(() => {
        throw new Error("commit failed");
      });

      const loginSuccess = (gateway as any).onLoginSuccess(generation, {
        zalo: { owner: "stale-cleanup-qr" },
        api,
        credentials: { cookie: [{ key: "stale-cleanup", value: "redacted" }] },
      }) as Promise<void>;
      const rejected = expect(loginSuccess).rejects.toThrow("commit failed");
      await vi.waitFor(() => expect(listener.stop).toHaveBeenCalledOnce());

      expect(gateway.cancelLogin()).toEqual({ cancelled: true, message: "Login cancelled" });
      const nextGeneration = 23;
      const nextStatus = {
        ...(gateway as any).status,
        connected: false,
        connectionStatus: "connecting",
      };
      const nextOperation = {
        generation: nextGeneration,
        status: { ...nextStatus },
        api: null,
        zalo: null,
        savedCredentials: null,
        listenerActive: false,
        listenerBindings: null,
        lastListenerBeatAt: null,
        stagedSessionPath: null,
      };
      (gateway as any).status = nextStatus;
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = nextGeneration;
      (gateway as any).activeLoginGeneration = nextGeneration;
      (gateway as any).activeLoginOperation = nextOperation;

      stopMayFinish.resolve();
      await rejected;

      expect((gateway as any).loginInProgress).toBe(true);
      expect((gateway as any).loginGeneration).toBe(nextGeneration);
      expect((gateway as any).activeLoginGeneration).toBe(nextGeneration);
      expect((gateway as any).activeLoginOperation).toBe(nextOperation);
      expect(gateway.getStatus()).toMatchObject({
        connected: false,
        connectionStatus: "connecting",
      });
    } finally {
      stopMayFinish.resolve();
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("does not call listener.start when the safety gate flips during listener setup", async () => {
    class Listener extends EventEmitter {
      start = vi.fn(async () => {});
      stop = vi.fn(async () => {});
    }

    const oldListener = new Listener();
    const newListener = new Listener();
    const oldStop = deferred<void>();
    oldListener.stop.mockReturnValueOnce(oldStop.promise);

    const gateway = new ZaloGatewayService();
    (gateway as any).api = { listener: newListener };
    const noop = vi.fn();
    (gateway as any).listenerBindings = {
      listener: oldListener,
      message: noop,
      reaction: noop,
      disconnected: noop,
      closed: noop,
      error: noop,
    };

    let blocked = false;
    const operationGuard = vi.fn(() => !blocked);
    const pendingStart = (gateway as any).startListener(operationGuard) as Promise<unknown>;

    await vi.waitFor(() => expect(oldListener.stop).toHaveBeenCalledOnce());
    blocked = true;
    oldStop.resolve();

    await expect(pendingStart).resolves.toBeNull();
    expect(operationGuard).toHaveBeenCalled();
    expect(newListener.start).not.toHaveBeenCalled();
    expect((gateway as any).listenerBindings).toBeNull();
    expect((gateway as any).listenerActive).toBe(false);
  });

  it("ignores websocket callbacks that belong to an older listener binding", async () => {
    class Listener extends EventEmitter {
      start = vi.fn(async () => {});
      stop = vi.fn(async () => {});
    }

    const first = new Listener();
    const second = new Listener();
    const gateway = new ZaloGatewayService();
    (gateway as any).api = { listener: first };
    await (gateway as any).startListener();
    const oldBindings = (gateway as any).listenerBindings;

    await (gateway as any).stopListener();
    (gateway as any).api = { listener: second };
    await (gateway as any).startListener();
    (gateway as any).status = {
      ...(gateway as any).status,
      connected: true,
      connectionStatus: "connected",
    };
    const scheduleReconnect = vi.spyOn(gateway as any, "scheduleReconnect");

    oldBindings.disconnected(1006, "stale");

    expect(scheduleReconnect).not.toHaveBeenCalled();
    expect((gateway as any).listenerActive).toBe(true);
    expect((gateway as any).listenerBindings.listener).toBe(second);
    await (gateway as any).stopListener();
  });

  it("ignores message and reaction callbacks that belong to an older listener binding", async () => {
    class Listener extends EventEmitter {
      start = vi.fn(async () => {});
      stop = vi.fn(async () => {});
    }

    const first = new Listener();
    const second = new Listener();
    const gateway = new ZaloGatewayService();
    (gateway as any).api = { listener: first };
    await (gateway as any).startListener();
    const oldBindings = (gateway as any).listenerBindings;

    await (gateway as any).stopListener();
    (gateway as any).api = { listener: second };
    await (gateway as any).startListener();
    const currentBindings = (gateway as any).listenerBindings;
    const currentBeat = "2026-07-22T06:00:00.000Z";
    (gateway as any).lastListenerBeatAt = currentBeat;
    reactionBoundary.handleIncomingReaction.mockClear();

    await oldBindings.message({});
    await oldBindings.reaction({
      threadId: "stale-thread",
      isGroup: false,
      isSelf: false,
      data: {
        uidFrom: "stale-user",
        msgId: "stale-message",
        content: { rIcon: "/-heart", rType: 1 },
      },
    });

    expect((gateway as any).lastListenerBeatAt).toBe(currentBeat);
    expect(reactionBoundary.handleIncomingReaction).not.toHaveBeenCalled();
    expect((gateway as any).listenerBindings).toBe(currentBindings);
    expect((gateway as any).listenerActive).toBe(true);
    await (gateway as any).stopListener();
  });

  it("allows only one QR generation when concurrent starts finish restore together", async () => {
    const gateway = new ZaloGatewayService();
    vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
    const restore = deferred<boolean>();
    const restoreSession = vi.spyOn(gateway, "restoreSession").mockReturnValue(restore.promise);
    const runLoginInBackground = vi.spyOn(gateway as any, "runLoginInBackground").mockResolvedValue(undefined);

    const first = gateway.startLogin();
    const second = gateway.startLogin();
    await vi.waitFor(() => expect(restoreSession).toHaveBeenCalledTimes(2));
    restore.resolve(false);

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: "connecting" }),
      expect.objectContaining({ status: "already_in_progress" }),
    ]);
    expect(runLoginInBackground).toHaveBeenCalledOnce();
    expect((gateway as any).loginGeneration).toBe(1);
    expect((gateway as any).activeLoginGeneration).toBe(1);
  });

  it("does not supersede an in-flight session restore", async () => {
    const gateway = new ZaloGatewayService();
    (gateway as any).activeRestoreGeneration = 9;
    (gateway as any).activeRestoreOperation = { generation: 9 };

    await expect(gateway.restoreSession()).resolves.toBe(false);
    expect((gateway as any).activeRestoreGeneration).toBe(9);
    expect((gateway as any).activeRestoreOperation).toMatchObject({ generation: 9 });
    expect(gateway.getStatus()).toMatchObject({ connectionStatus: "disconnected", lastError: null });
  });

  it("does not start QR login while a restore operation owns the gateway", async () => {
    const originalDryRun = config.zalo.dryRun;
    try {
      (config.zalo as { dryRun: boolean }).dryRun = false;
      const gateway = new ZaloGatewayService();
      const restoreOperation = {
        generation: 17,
        status: { ...(gateway as any).status },
        api: null,
        zalo: null,
        savedCredentials: null,
        listenerActive: false,
        listenerBindings: null,
        lastListenerBeatAt: null,
        stagedSessionPath: null,
      };
      (gateway as any).activeRestoreGeneration = 17;
      (gateway as any).activeRestoreOperation = restoreOperation;
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
      const restoreSession = vi.spyOn(gateway, "restoreSession");
      const runLoginInBackground = vi.spyOn(gateway as any, "runLoginInBackground");

      await expect(gateway.startLogin()).resolves.toMatchObject({ status: "already_in_progress" });

      expect(restoreSession).not.toHaveBeenCalled();
      expect(runLoginInBackground).not.toHaveBeenCalled();
      expect((gateway as any).activeRestoreGeneration).toBe(17);
      expect((gateway as any).activeRestoreOperation).toBe(restoreOperation);
      expect((gateway as any).activeLoginGeneration).toBeNull();
    } finally {
      (config.zalo as { dryRun: boolean }).dryRun = originalDryRun;
    }
  });

  it("does not start a restore while a QR login operation owns the gateway", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "zalo-restore-login-overlap-"));
    try {
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = 31;
      (gateway as any).activeLoginGeneration = 31;
      (gateway as any).activeLoginOperation = {
        generation: 31,
        status: { ...(gateway as any).status },
        api: null,
        zalo: null,
        savedCredentials: null,
        listenerActive: false,
        listenerBindings: null,
        lastListenerBeatAt: null,
        stagedSessionPath: null,
      };
      const before = gateway.getStatus();
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
      const beginRestoreOperation = vi.spyOn(gateway as any, "beginRestoreOperation");

      await expect(gateway.restoreSession()).resolves.toBe(false);

      expect(beginRestoreOperation).not.toHaveBeenCalled();
      expect((gateway as any).activeLoginGeneration).toBe(31);
      expect((gateway as any).activeRestoreGeneration).toBeNull();
      expect(gateway.getStatus()).toEqual(before);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("rolls back both operation snapshots when a safety block finds login and restore co-active", () => {
    const gateway = new ZaloGatewayService();
    const originalStatus = { ...(gateway as any).status };
    const restoreOperation = {
      generation: 40,
      status: originalStatus,
      api: null,
      zalo: null,
      savedCredentials: null,
      listenerActive: false,
      listenerBindings: null,
      lastListenerBeatAt: null,
      stagedSessionPath: null,
    };
    (gateway as any).restoreGeneration = 40;
    (gateway as any).activeRestoreGeneration = 40;
    (gateway as any).activeRestoreOperation = restoreOperation;

    const restoreApi = { source: "pending-restore-api" };
    const restoreZalo = { source: "pending-restore-client" };
    const restoreCredentials = { cookie: [{ key: "restore", value: "credential" }] };
    (gateway as any).api = restoreApi;
    (gateway as any).zalo = restoreZalo;
    (gateway as any).savedCredentials = restoreCredentials;
    const loginOperation = {
      generation: 41,
      status: { ...originalStatus },
      api: restoreApi,
      zalo: restoreZalo,
      savedCredentials: restoreCredentials,
      listenerActive: false,
      listenerBindings: null,
      lastListenerBeatAt: null,
      stagedSessionPath: null,
    };
    (gateway as any).loginInProgress = true;
    (gateway as any).loginGeneration = 41;
    (gateway as any).activeLoginGeneration = 41;
    (gateway as any).activeLoginOperation = loginOperation;
    (gateway as any).api = { source: "pending-login-api" };
    (gateway as any).zalo = { source: "pending-login-client" };
    (gateway as any).savedCredentials = { cookie: [{ key: "login", value: "credential" }] };

    (gateway as any).applyLoginSafetyBlock("OUTBOUND_DRY_RUN_REQUIRED");

    expect((gateway as any).activeLoginGeneration).toBeNull();
    expect((gateway as any).activeLoginOperation).toBeNull();
    expect((gateway as any).activeRestoreGeneration).toBeNull();
    expect((gateway as any).activeRestoreOperation).toBeNull();
    expect(gateway.getApi()).toBeNull();
    expect((gateway as any).zalo).toBeNull();
    expect((gateway as any).savedCredentials).toBeNull();
    expect(gateway.getStatus()).toMatchObject({
      connected: false,
      connectionStatus: "blocked",
      lastError: "LOGIN_SAFETY_BLOCKED:OUTBOUND_DRY_RUN_REQUIRED",
    });
  });

  it("keeps a QR success non-connected and hides its QR while persistence and listener startup are pending", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-ready-pending-"));
    const qrPath = join(sessionDir, "qr-current.png");
    try {
      writeFileSync(qrPath, Buffer.alloc(600));
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;
      (gateway as any).status = {
        ...(gateway as any).status,
        connected: false,
        connectionStatus: "waiting_qr_scan",
      };
      const generation = 21;
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = generation;
      (gateway as any).activeLoginGeneration = generation;
      (gateway as any).activeLoginOperation = {
        generation,
        status: { ...(gateway as any).status },
        api: null,
        zalo: null,
        savedCredentials: null,
        listenerActive: false,
        listenerBindings: null,
        lastListenerBeatAt: null,
        stagedSessionPath: null,
      };
      const api = {
        getOwnId: () => "pending-user",
        getOwnName: () => "Pending User",
      };
      const zalo = { source: "pending-qr" };
      const credentials = { cookie: [{ key: "pending", value: "redacted" }] };
      (gateway as any).qrUpdatedAt = "2026-07-22T05:00:00.000Z";

      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
      const persist = deferred<void>();
      const stageSession = vi.spyOn(gateway as any, "stageSessionOrThrow").mockReturnValue(persist.promise);
      vi.spyOn(gateway as any, "commitStagedSessionOrThrow").mockImplementation(() => {});
      const listener = deferred<unknown>();
      const startListener = vi.spyOn(gateway as any, "startListener").mockReturnValue(listener.promise);
      const ready = vi.fn();
      gateway.on("ready", ready);

      const loginSuccess = (gateway as any).onLoginSuccess(generation, {
        zalo,
        api,
        credentials,
      }) as Promise<void>;
      await vi.waitFor(() => expect(stageSession).toHaveBeenCalledOnce());

      expect(gateway.getStatus()).toMatchObject({
        connected: false,
        qrAvailable: false,
        qrUpdatedAt: null,
      });
      expect(ready).not.toHaveBeenCalled();

      persist.resolve();
      await vi.waitFor(() => expect(startListener).toHaveBeenCalledOnce());
      expect(gateway.getStatus()).toMatchObject({
        connected: false,
        qrAvailable: false,
        qrUpdatedAt: null,
      });
      expect(ready).not.toHaveBeenCalled();

      listener.resolve({ listener: { source: "started-binding" } });
      await loginSuccess;
      expect(gateway.getStatus()).toMatchObject({
        connected: true,
        connectionStatus: "connected",
        qrAvailable: false,
        qrUpdatedAt: null,
      });
      expect((gateway as any).loginInProgress).toBe(false);
      expect((gateway as any).activeLoginGeneration).toBeNull();
      expect((gateway as any).loginGeneration).toBe(generation + 1);
      expect(existsSync(qrPath)).toBe(false);
      expect(ready).toHaveBeenCalledOnce();
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("keeps the active session transactional and rolls back exact QR ownership when cancelled during listener start", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hermes-qr-session-transaction-"));
    const sessionDir = join(workspaceRoot, "zalo-session");
    const sessionPath = join(sessionDir, "zalo-session.json");
    const backupRoot = join(workspaceRoot, "backups", "db");
    const originalSessionDir = config.zalo.sessionDir;
    let finishListenerStart: (() => void) | undefined;
    try {
      mkdirSync(sessionDir, { recursive: true });
      const originalSession = JSON.stringify({
        selfUserId: "existing-user",
        selfDisplayName: "Existing User",
        credentials: { cookie: [{ key: "existing", value: "existing" }] },
      });
      writeFileSync(sessionPath, originalSession, "utf8");
      (config.zalo as { sessionDir: string }).sessionDir = sessionDir;

      class PendingListener extends EventEmitter {
        start = vi.fn(async () => {
          await new Promise<void>((resolve) => { finishListenerStart = resolve; });
        });
        stop = vi.fn(async () => {});
      }
      const listener = new PendingListener();
      const gateway = new ZaloGatewayService();
      const generation = 31;
      (gateway as any).status = {
        ...(gateway as any).status,
        connected: false,
        connectionStatus: "waiting_qr_scan",
      };
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = generation;
      (gateway as any).activeLoginGeneration = generation;
      (gateway as any).activeLoginOperation = {
        generation,
        status: { ...(gateway as any).status },
        api: null,
        zalo: null,
        savedCredentials: null,
        listenerActive: false,
        listenerBindings: null,
        lastListenerBeatAt: null,
      };
      const api = {
        listener,
        getOwnId: () => "new-user",
        getOwnName: () => "New User",
      };
      const zalo = { owner: "new-qr-operation" };
      const credentials = { cookie: [{ key: "new", value: "new" }] };
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
      const ready = vi.fn();
      gateway.on("ready", ready);

      const loginSuccess = (gateway as any).onLoginSuccess(generation, {
        zalo,
        api,
        credentials,
      }) as Promise<void>;
      await vi.waitFor(() => expect(listener.start).toHaveBeenCalledOnce());
      const activeWhilePending = readFileSync(sessionPath, "utf8");
      const backupVisibleWhilePending = existsSync(backupRoot);

      expect(gateway.cancelLogin()).toEqual({ cancelled: true, message: "Login cancelled" });
      finishListenerStart();
      await loginSuccess;

      expect(activeWhilePending).toBe(originalSession);
      expect(backupVisibleWhilePending).toBe(false);
      expect(readFileSync(sessionPath, "utf8")).toBe(originalSession);
      expect(readdirSync(sessionDir).filter((name) => name.includes("staged"))).toEqual([]);
      expect(existsSync(backupRoot)).toBe(false);
      expect(gateway.getApi()).toBeNull();
      expect((gateway as any).zalo).toBeNull();
      expect((gateway as any).savedCredentials).toBeNull();
      expect((gateway as any).listenerBindings).toBeNull();
      expect((gateway as any).listenerActive).toBe(false);
      expect(listener.stop).toHaveBeenCalled();
      expect(ready).not.toHaveBeenCalled();
      expect(gateway.getStatus()).toMatchObject({ connected: false, connectionStatus: "disconnected" });
    } finally {
      finishListenerStart?.();
      (config.zalo as { sessionDir: string }).sessionDir = originalSessionDir;
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("enforces a blocked decision by invalidating QR ownership and staged credentials", () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "hermes-qr-enforce-block-"));
    const qrPath = join(sessionDir, "qr-current.png");
    const stagedPath = join(sessionDir, ".zalo-session-login-41.staged");
    try {
      writeFileSync(qrPath, Buffer.alloc(600));
      writeFileSync(stagedPath, "staged-fake-credentials", "utf8");
      const gateway = new ZaloGatewayService();
      (gateway as any).sessionDir = sessionDir;
      const generation = 41;
      (gateway as any).status = {
        ...(gateway as any).status,
        connected: false,
        connectionStatus: "waiting_qr_scan",
      };
      (gateway as any).loginInProgress = true;
      (gateway as any).loginGeneration = generation;
      (gateway as any).activeLoginGeneration = generation;
      (gateway as any).activeLoginOperation = {
        generation,
        status: { ...(gateway as any).status, connectionStatus: "disconnected" },
        api: null,
        zalo: null,
        savedCredentials: null,
        listenerActive: false,
        listenerBindings: null,
        lastListenerBeatAt: null,
        stagedSessionPath: stagedPath,
      };
      (gateway as any).api = { owner: "blocked-login" };
      (gateway as any).savedCredentials = { cookie: [{ key: "blocked", value: "blocked" }] };
      (gateway as any).qrUpdatedAt = "2026-07-22T06:30:00.000Z";
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({
        allowed: false,
        reason: "OUTBOUND_DRY_RUN_REQUIRED",
      });

      expect((gateway as any).enforceLoginSafety()).toEqual({
        allowed: false,
        reason: "OUTBOUND_DRY_RUN_REQUIRED",
      });

      expect(existsSync(qrPath)).toBe(false);
      expect(existsSync(stagedPath)).toBe(false);
      expect(gateway.getApi()).toBeNull();
      expect((gateway as any).savedCredentials).toBeNull();
      expect((gateway as any).activeLoginGeneration).toBeNull();
      expect(gateway.getStatus()).toMatchObject({
        connected: false,
        connectionStatus: "blocked",
        lastError: "LOGIN_SAFETY_BLOCKED:OUTBOUND_DRY_RUN_REQUIRED",
      });
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("does not let an admin persistence call publish credentials owned by a pending restore", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hermes-restore-admin-persist-"));
    const sessionDir = join(workspaceRoot, "zalo-session");
    const sessionPath = join(sessionDir, "zalo-session.json");
    const backupRoot = join(workspaceRoot, "backups", "db");
    const originalSessionDir = config.zalo.sessionDir;
    try {
      mkdirSync(sessionDir, { recursive: true });
      const originalSession = JSON.stringify({ credentials: { owner: "existing-session" } });
      writeFileSync(sessionPath, originalSession, "utf8");
      (config.zalo as { sessionDir: string }).sessionDir = sessionDir;
      const gateway = new ZaloGatewayService();
      (gateway as any).status = {
        ...(gateway as any).status,
        connected: true,
        connectionStatus: "connected",
      };
      (gateway as any).savedCredentials = { owner: "pending-restore" };
      (gateway as any).activeRestoreGeneration = 51;
      (gateway as any).activeRestoreOperation = {
        generation: 51,
        status: { ...(gateway as any).status },
        api: null,
        zalo: null,
        savedCredentials: { owner: "existing-session" },
        listenerActive: false,
        listenerBindings: null,
        lastListenerBeatAt: null,
        stagedSessionPath: null,
      };

      await expect(gateway.persistSession()).resolves.toMatchObject({ ok: false });
      expect(readFileSync(sessionPath, "utf8")).toBe(originalSession);
      expect(existsSync(backupRoot)).toBe(false);
    } finally {
      (config.zalo as { sessionDir: string }).sessionDir = originalSessionDir;
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
