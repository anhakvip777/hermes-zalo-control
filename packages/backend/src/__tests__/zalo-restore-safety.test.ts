import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const zcaBoundary = vi.hoisted(() => {
  const login = vi.fn();

  class FakeZalo {
    constructor(_options: unknown) {}

    login(credentials: unknown) {
      return login(credentials);
    }
  }

  const projectRequire = vi.fn((moduleId: string) => {
    if (moduleId !== "zca-js") {
      throw new Error(`Unexpected projectRequire call: ${moduleId}`);
    }
    return { Zalo: FakeZalo };
  });

  return {
    login,
    projectRequire,
    createRequire: vi.fn(() => projectRequire),
  };
});

const mockConfig = vi.hoisted(() => ({
  zalo: {
    dryRun: false,
    sessionDir: "",
  },
}));

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return { ...actual, createRequire: zcaBoundary.createRequire };
});

vi.mock("../config.js", () => ({ config: mockConfig }));

vi.mock("../services/heartbeat.service.js", () => ({
  heartbeatOk: vi.fn(async () => {}),
}));

vi.mock("../services/runtime-config.service.js", () => ({
  getCurrentEffectiveDryRun: vi.fn(() => false),
}));

import { ZaloGatewayService } from "../services/zalo-gateway.service.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("Zalo restore login safety", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), "zalo-restore-safety-"));
    mockConfig.zalo.sessionDir = sessionDir;
    zcaBoundary.login.mockReset();
    zcaBoundary.projectRequire.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("fails closed when login policy becomes blocked while session login is pending", async () => {
    const credentials = {
      cookie: [{ key: "fake-key", value: "fake-value" }],
      imei: "fake-imei",
      userAgent: "fake-user-agent",
    };
    writeFileSync(
      join(sessionDir, "zalo-session.json"),
      JSON.stringify({
        credentials,
        selfUserId: "saved-user-id",
        selfDisplayName: "Saved User",
      }),
      "utf8",
    );

    const loginResult = deferred<{
      getOwnId: () => string;
      getOwnName: () => string;
    }>();
    zcaBoundary.login.mockReturnValueOnce(loginResult.promise);

    const gateway = new ZaloGatewayService();
    vi.spyOn(gateway, "getLoginSafetyDecision")
      .mockReturnValueOnce({ allowed: true, reason: null })
      .mockReturnValue({ allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" });
    const stageSession = vi.spyOn(gateway as any, "stageSessionOrThrow")
      .mockResolvedValue(undefined);
    const startListener = vi.spyOn(gateway as any, "startListener")
      .mockResolvedValue(undefined);
    const ready = vi.fn();
    gateway.on("ready", ready);

    const restore = gateway.restoreSession();

    expect(zcaBoundary.projectRequire).toHaveBeenCalledOnce();
    expect(zcaBoundary.projectRequire).toHaveBeenCalledWith("zca-js");
    expect(zcaBoundary.login).toHaveBeenCalledOnce();
    expect(zcaBoundary.login).toHaveBeenCalledWith(credentials);

    const fakeApi = {
      getOwnId: () => "live-user-id",
      getOwnName: () => "Live User",
    };
    loginResult.resolve(fakeApi);

    const result = await restore;
    const status = gateway.getStatus();

    expect.soft(result).toBe(false);
    expect.soft(status).toMatchObject({
      connected: false,
      connectionStatus: "blocked",
      lastError: "LOGIN_SAFETY_BLOCKED:OUTBOUND_DRY_RUN_REQUIRED",
    });
    expect.soft(stageSession).not.toHaveBeenCalled();
    expect.soft(startListener).not.toHaveBeenCalled();
    expect.soft(ready).not.toHaveBeenCalled();
    expect.soft(gateway.getApi()).toBeNull();
  });

  it("rolls back a restore-owned API, credentials, and listener when policy blocks during listener start", async () => {
    class FakeListener extends EventEmitter {
      start!: () => Promise<void>;
      stop = vi.fn(async () => {});
    }

    const credentials = {
      cookie: [{ key: "restore-key", value: "restore-value" }],
      imei: "restore-imei",
      userAgent: "restore-user-agent",
    };
    writeFileSync(
      join(sessionDir, "zalo-session.json"),
      JSON.stringify({ credentials, selfUserId: "saved-user-id", selfDisplayName: "Saved User" }),
      "utf8",
    );

    const listener = new FakeListener();
    let signalListenerStart!: () => void;
    const listenerStarted = new Promise<void>((resolve) => { signalListenerStart = resolve; });
    let finishListenerStart!: () => void;
    const listenerCanFinish = new Promise<void>((resolve) => { finishListenerStart = resolve; });
    listener.start = vi.fn(async () => {
      signalListenerStart();
      await listenerCanFinish;
    });
    const restoredApi = {
      listener,
      getOwnId: () => "restored-user-id",
      getOwnName: () => "Restored User",
    };
    zcaBoundary.login.mockResolvedValueOnce(restoredApi);

    const gateway = new ZaloGatewayService();
    let blocked = false;
    vi.spyOn(gateway, "getLoginSafetyDecision").mockImplementation(() => blocked
      ? { allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" }
      : { allowed: true, reason: null });
    vi.spyOn(gateway as any, "stageSessionOrThrow");
    const ready = vi.fn();
    gateway.on("ready", ready);

    const restore = gateway.restoreSession();
    await listenerStarted;

    blocked = true;
    expect(gateway.getStatus()).toMatchObject({
      connected: false,
      connectionStatus: "blocked",
      lastError: "LOGIN_SAFETY_BLOCKED:OUTBOUND_DRY_RUN_REQUIRED",
    });
    finishListenerStart();
    await expect(restore).resolves.toBe(false);

    expect(gateway.getApi()).toBeNull();
    expect((gateway as any).zalo).toBeNull();
    expect((gateway as any).savedCredentials).toBeNull();
    expect((gateway as any).listenerActive).toBe(false);
    expect((gateway as any).listenerBindings).toBeNull();
    expect((gateway as any).activeRestoreGeneration).toBeNull();
    expect((gateway as any).activeRestoreOperation).toBeNull();
    for (const event of ["message", "reaction", "disconnected", "closed", "error"]) {
      expect(listener.listenerCount(event)).toBe(0);
    }
    expect(listener.stop).toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    expect(gateway.getStatus()).toMatchObject({
      connected: false,
      connectionStatus: "blocked",
      lastError: "LOGIN_SAFETY_BLOCKED:OUTBOUND_DRY_RUN_REQUIRED",
    });
  });

  it("does not commit or advertise restore success when listener startup returns no binding", async () => {
    const credentials = {
      cookie: [{ key: "listener-null", value: "restore-value" }],
      imei: "listener-null-imei",
      userAgent: "listener-null-agent",
    };
    writeFileSync(
      join(sessionDir, "zalo-session.json"),
      JSON.stringify({ credentials, selfUserId: "saved-user-id", selfDisplayName: "Saved User" }),
      "utf8",
    );
    zcaBoundary.login.mockResolvedValueOnce({
      getOwnId: () => "restored-user-id",
      getOwnName: () => "Restored User",
    });

    const gateway = new ZaloGatewayService();
    vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
    vi.spyOn(gateway as any, "startListener").mockResolvedValue(null);
    const commit = vi.spyOn(gateway as any, "commitStagedSessionOrThrow").mockImplementation(() => {});
    const ready = vi.fn();
    gateway.on("ready", ready);

    await expect(gateway.restoreSession()).resolves.toBe(false);

    expect(commit).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    expect(gateway.getApi()).toBeNull();
    expect((gateway as any).activeRestoreOperation).toBeNull();
    expect(gateway.getStatus()).toMatchObject({
      connected: false,
      connectionStatus: "error",
      lastError: "RESTORE_FAILED",
    });
  });

  it.each(["rejects", "returns_not_ok"] as const)(
    "rolls back restore when refreshed session persistence %s",
    async (mode) => {
      const credentials = {
        cookie: [{ key: "restore-key", value: "restore-value" }],
        imei: "restore-imei",
        userAgent: "restore-user-agent",
      };
      writeFileSync(
        join(sessionDir, "zalo-session.json"),
        JSON.stringify({ credentials, selfUserId: "saved-user-id", selfDisplayName: "Saved User" }),
        "utf8",
      );
      zcaBoundary.login.mockResolvedValueOnce({
        getOwnId: () => "restored-user-id",
        getOwnName: () => "Restored User",
      });

      const gateway = new ZaloGatewayService();
      vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
      const stageSession = vi.spyOn(gateway as any, "stageSessionOrThrow");
      if (mode === "rejects") {
        stageSession.mockRejectedValue(new Error("PERSIST_FAILED:disk unavailable"));
      } else {
        stageSession.mockRejectedValue(new Error("PERSIST_FAILED:write verification failed"));
      }
      const startListener = vi.spyOn(gateway as any, "startListener").mockResolvedValue(undefined);
      const ready = vi.fn();
      gateway.on("ready", ready);

      await expect(gateway.restoreSession()).resolves.toBe(false);

      expect(startListener).not.toHaveBeenCalled();
      expect(ready).not.toHaveBeenCalled();
      expect(gateway.getApi()).toBeNull();
      expect((gateway as any).zalo).toBeNull();
      expect((gateway as any).savedCredentials).toBeNull();
      expect((gateway as any).listenerActive).toBe(false);
      expect((gateway as any).listenerBindings).toBeNull();
      expect((gateway as any).activeRestoreGeneration).toBeNull();
      expect((gateway as any).activeRestoreOperation).toBeNull();
      expect(gateway.getStatus()).toMatchObject({
        connected: false,
        connectionStatus: "error",
        lastError: "RESTORE_FAILED",
      });
    },
  );

  it("keeps restore non-connected until persistence and listener startup commit", async () => {
    const credentials = {
      cookie: [{ key: "pending-restore-key", value: "pending-restore-value" }],
      imei: "pending-restore-imei",
      userAgent: "pending-restore-user-agent",
    };
    writeFileSync(
      join(sessionDir, "zalo-session.json"),
      JSON.stringify({ credentials, selfUserId: "saved-user-id", selfDisplayName: "Saved User" }),
      "utf8",
    );

    class PendingListener extends EventEmitter {
      start!: () => Promise<void>;
      stop = vi.fn(async () => {});
    }
    const listener = new PendingListener();
    let signalListenerStart!: () => void;
    const listenerStarted = new Promise<void>((resolve) => { signalListenerStart = resolve; });
    let finishListenerStart!: () => void;
    const listenerCanFinish = new Promise<void>((resolve) => { finishListenerStart = resolve; });
    listener.start = vi.fn(async () => {
      signalListenerStart();
      await listenerCanFinish;
    });
    zcaBoundary.login.mockResolvedValueOnce({
      listener,
      getOwnId: () => "pending-restore-user-id",
      getOwnName: () => "Pending Restore User",
    });

    const gateway = new ZaloGatewayService();
    vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
    let releasePersist!: () => void;
    const persistCanFinish = new Promise<void>((resolve) => { releasePersist = resolve; });
    const stageSession = vi.spyOn(gateway as any, "stageSessionOrThrow").mockImplementation(async () => {
      await persistCanFinish;
    });
    vi.spyOn(gateway as any, "commitStagedSessionOrThrow").mockImplementation(() => {});
    let stateAtReady: Record<string, unknown> | null = null;
    gateway.on("ready", () => {
      stateAtReady = {
        connected: gateway.getStatus().connected,
        activeRestoreGeneration: (gateway as any).activeRestoreGeneration,
      };
    });

    const restore = gateway.restoreSession();
    await vi.waitFor(() => expect(stageSession).toHaveBeenCalledOnce());
    expect(gateway.getStatus()).toMatchObject({
      connected: false,
      connectionStatus: "disconnected",
    });
    releasePersist();

    await listenerStarted;
    expect(gateway.getStatus()).toMatchObject({
      connected: false,
      connectionStatus: "disconnected",
    });
    finishListenerStart();
    await expect(restore).resolves.toBe(true);
    expect(gateway.getStatus()).toMatchObject({
      connected: true,
      connectionStatus: "connected",
    });
    expect(stateAtReady).toEqual({ connected: true, activeRestoreGeneration: null });
  });

  it("keeps the active session transactional and removes staged restore credentials when safety blocks listener startup", async () => {
    rmSync(sessionDir, { recursive: true, force: true });
    const workspaceRoot = mkdtempSync(join(tmpdir(), "zalo-restore-session-transaction-"));
    sessionDir = join(workspaceRoot, "zalo-session");
    mkdirSync(sessionDir, { recursive: true });
    mockConfig.zalo.sessionDir = sessionDir;
    const sessionPath = join(sessionDir, "zalo-session.json");
    const backupRoot = join(workspaceRoot, "backups", "db");
    const credentials = {
      cookie: [{ key: "restore-key", value: "restore-value" }],
      imei: "restore-imei",
      userAgent: "restore-user-agent",
    };
    const originalSession = JSON.stringify({
      credentials,
      selfUserId: "saved-user-id",
      selfDisplayName: "Saved User",
      savedAt: "2026-07-22T00:00:00.000Z",
    });
    writeFileSync(sessionPath, originalSession, "utf8");

    class PendingListener extends EventEmitter {
      start!: () => Promise<void>;
      stop = vi.fn(async () => {});
    }
    const listener = new PendingListener();
    let signalListenerStart!: () => void;
    const listenerStarted = new Promise<void>((resolve) => { signalListenerStart = resolve; });
    let finishListenerStart!: () => void;
    const listenerCanFinish = new Promise<void>((resolve) => { finishListenerStart = resolve; });
    listener.start = vi.fn(async () => {
      signalListenerStart();
      await listenerCanFinish;
    });
    zcaBoundary.login.mockResolvedValueOnce({
      listener,
      getOwnId: () => "refreshed-user-id",
      getOwnName: () => "Refreshed User",
    });

    const gateway = new ZaloGatewayService();
    let blocked = false;
    vi.spyOn(gateway, "getLoginSafetyDecision").mockImplementation(() => blocked
      ? { allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" }
      : { allowed: true, reason: null });
    const ready = vi.fn();
    gateway.on("ready", ready);

    const restore = gateway.restoreSession();
    await listenerStarted;
    const activeWhilePending = readFileSync(sessionPath, "utf8");
    const backupVisibleWhilePending = existsSync(backupRoot);
    blocked = true;
    gateway.getStatus();
    finishListenerStart();
    await expect(restore).resolves.toBe(false);

    expect(activeWhilePending).toBe(originalSession);
    expect(backupVisibleWhilePending).toBe(false);
    expect(readFileSync(sessionPath, "utf8")).toBe(originalSession);
    expect(readdirSync(sessionDir).filter((name) => name.includes("staged"))).toEqual([]);
    expect(existsSync(backupRoot)).toBe(false);
    expect(gateway.getApi()).toBeNull();
    expect((gateway as any).savedCredentials).toBeNull();
    expect((gateway as any).listenerBindings).toBeNull();
    expect(listener.stop).toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    expect(gateway.getStatus()).toMatchObject({
      connected: false,
      connectionStatus: "blocked",
      lastError: "LOGIN_SAFETY_BLOCKED:OUTBOUND_DRY_RUN_REQUIRED",
    });
  });

  it("reads a backup as restore input without publishing it as the active session before commit", async () => {
    rmSync(sessionDir, { recursive: true, force: true });
    const workspaceRoot = mkdtempSync(join(tmpdir(), "zalo-backup-restore-transaction-"));
    sessionDir = join(workspaceRoot, "zalo-session");
    const backupDir = join(workspaceRoot, "backups", "db", "zalo-session-20260722T120000");
    mkdirSync(backupDir, { recursive: true });
    mockConfig.zalo.sessionDir = sessionDir;

    const sessionPath = join(sessionDir, "zalo-session.json");
    const backupPath = join(backupDir, "zalo-session.json");
    const credentials = {
      cookie: [{ key: "backup-key", value: "backup-value" }],
      imei: "backup-imei",
      userAgent: "backup-user-agent",
    };
    const backupSession = JSON.stringify({
      credentials,
      selfUserId: "backup-user-id",
      selfDisplayName: "Backup User",
      savedAt: "2026-07-22T00:00:00.000Z",
    });
    writeFileSync(backupPath, backupSession, "utf8");

    class PendingListener extends EventEmitter {
      start!: () => Promise<void>;
      stop = vi.fn(async () => {});
    }
    const listener = new PendingListener();
    let signalListenerStart!: () => void;
    const listenerStarted = new Promise<void>((resolve) => { signalListenerStart = resolve; });
    let finishListenerStart!: () => void;
    const listenerCanFinish = new Promise<void>((resolve) => { finishListenerStart = resolve; });
    listener.start = vi.fn(async () => {
      signalListenerStart();
      await listenerCanFinish;
    });
    zcaBoundary.login.mockResolvedValueOnce({
      listener,
      getOwnId: () => "restored-user-id",
      getOwnName: () => "Restored User",
    });

    const gateway = new ZaloGatewayService();
    let blocked = false;
    vi.spyOn(gateway, "getLoginSafetyDecision").mockImplementation(() => blocked
      ? { allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" }
      : { allowed: true, reason: null });

    const restore = gateway.restoreSession();
    await listenerStarted;

    expect(existsSync(sessionPath)).toBe(false);
    expect(readFileSync(backupPath, "utf8")).toBe(backupSession);

    blocked = true;
    gateway.getStatus();
    finishListenerStart();
    await expect(restore).resolves.toBe(false);

    expect(existsSync(sessionPath)).toBe(false);
    expect(readFileSync(backupPath, "utf8")).toBe(backupSession);
    expect(readdirSync(sessionDir).filter((name) => name.includes("staged"))).toEqual([]);
    expect(listener.stop).toHaveBeenCalled();
    expect(gateway.getStatus()).toMatchObject({
      connected: false,
      connectionStatus: "blocked",
      lastError: "LOGIN_SAFETY_BLOCKED:OUTBOUND_DRY_RUN_REQUIRED",
    });
  });

  it("commits a staged restore and creates its backup only after listener startup", async () => {
    rmSync(sessionDir, { recursive: true, force: true });
    const workspaceRoot = mkdtempSync(join(tmpdir(), "zalo-restore-session-commit-"));
    sessionDir = join(workspaceRoot, "zalo-session");
    mkdirSync(sessionDir, { recursive: true });
    mockConfig.zalo.sessionDir = sessionDir;
    const sessionPath = join(sessionDir, "zalo-session.json");
    const backupRoot = join(workspaceRoot, "backups", "db");
    const credentials = {
      cookie: [{ key: "commit-key", value: "commit-value" }],
      imei: "commit-imei",
      userAgent: "commit-user-agent",
    };
    const originalSession = JSON.stringify({
      credentials,
      selfUserId: "saved-user-id",
      selfDisplayName: "Saved User",
      savedAt: "2026-07-22T00:00:00.000Z",
    });
    writeFileSync(sessionPath, originalSession, "utf8");

    class PendingListener extends EventEmitter {
      start!: () => Promise<void>;
      stop = vi.fn(async () => {});
    }
    const listener = new PendingListener();
    let signalListenerStart!: () => void;
    const listenerStarted = new Promise<void>((resolve) => { signalListenerStart = resolve; });
    let finishListenerStart!: () => void;
    const listenerCanFinish = new Promise<void>((resolve) => { finishListenerStart = resolve; });
    listener.start = vi.fn(async () => {
      signalListenerStart();
      await listenerCanFinish;
    });
    zcaBoundary.login.mockResolvedValueOnce({
      listener,
      getOwnId: () => "committed-user-id",
      getOwnName: () => "Committed User",
    });

    const gateway = new ZaloGatewayService();
    vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
    let stateAtReady: Record<string, unknown> | null = null;
    gateway.on("ready", () => {
      stateAtReady = {
        connected: gateway.getStatus().connected,
        activeRestoreGeneration: (gateway as any).activeRestoreGeneration,
      };
    });

    const restore = gateway.restoreSession();
    await listenerStarted;
    expect(readFileSync(sessionPath, "utf8")).toBe(originalSession);
    expect(existsSync(backupRoot)).toBe(false);
    finishListenerStart();
    await expect(restore).resolves.toBe(true);

    const committed = JSON.parse(readFileSync(sessionPath, "utf8"));
    expect(committed).toMatchObject({
      selfUserId: "committed-user-id",
      selfDisplayName: "Committed User",
      credentials,
    });
    expect(readdirSync(sessionDir).filter((name) => name.includes("staged"))).toEqual([]);
    expect(existsSync(backupRoot)).toBe(true);
    expect(stateAtReady).toEqual({ connected: true, activeRestoreGeneration: null });
  });

  it("preserves a genuinely pre-existing connected state when restore policy blocks", async () => {
    const credentials = {
      cookie: [{ key: "restore-key", value: "restore-value" }],
      imei: "restore-imei",
      userAgent: "restore-user-agent",
    };
    writeFileSync(
      join(sessionDir, "zalo-session.json"),
      JSON.stringify({ credentials, selfUserId: "saved-user-id", selfDisplayName: "Saved User" }),
      "utf8",
    );

    class ExistingListener extends EventEmitter {
      start = vi.fn(async () => {});
      stop = vi.fn(async () => {});
    }
    const existingListener = new ExistingListener();
    const existingApi = {
      listener: existingListener,
      getOwnId: () => "existing-user-id",
      getOwnName: () => "Existing User",
    };
    const existingCredentials = { cookie: [{ key: "existing-key", value: "existing-value" }] };
    const gateway = new ZaloGatewayService();
    (gateway as any).api = existingApi;
    (gateway as any).zalo = { existing: true };
    (gateway as any).savedCredentials = existingCredentials;
    const existingBindings = await (gateway as any).startListener();
    expect(existingBindings).toMatchObject({ listener: existingListener });
    expect(existingListener.start).toHaveBeenCalledOnce();
    (gateway as any).status = {
      ...(gateway as any).status,
      connected: true,
      connectionStatus: "connected",
      selfUserId: "existing-user-id",
      selfDisplayName: "Existing User",
    };

    zcaBoundary.login.mockResolvedValueOnce({
      listener: new EventEmitter(),
      getOwnId: () => "new-user-id",
      getOwnName: () => "New User",
    });
    let blocked = false;
    vi.spyOn(gateway, "getLoginSafetyDecision").mockImplementation(() => blocked
      ? { allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" }
      : { allowed: true, reason: null });
    const stageSession = vi.spyOn(gateway as any, "stageSessionOrThrow");
    let releasePersist!: () => void;
    const persistCanFinish = new Promise<void>((resolve) => { releasePersist = resolve; });
    stageSession.mockImplementation(async () => {
      await persistCanFinish;
    });
    const ready = vi.fn();
    gateway.on("ready", ready);

    const restore = gateway.restoreSession();
    // Block after the restore has replaced connection state but before persistence returns.
    await vi.waitFor(() => expect(stageSession).toHaveBeenCalledOnce());
    blocked = true;
    expect(gateway.getStatus()).toMatchObject({
      connected: true,
      connectionStatus: "connected",
    });
    releasePersist();
    await expect(restore).resolves.toBe(false);

    expect(gateway.getApi()).toBe(existingApi);
    expect((gateway as any).zalo).toEqual({ existing: true });
    expect((gateway as any).savedCredentials).toBe(existingCredentials);
    expect((gateway as any).listenerActive).toBe(true);
    expect((gateway as any).listenerBindings).toBe(existingBindings);
    expect(existingListener.stop).not.toHaveBeenCalled();
    for (const event of ["message", "reaction", "disconnected", "closed", "error"]) {
      expect(existingListener.listeners(event)).toContain(existingBindings[event]);
    }
    expect((gateway as any).activeRestoreGeneration).toBeNull();
    expect((gateway as any).activeRestoreOperation).toBeNull();
    expect(gateway.getStatus()).toMatchObject({ connected: true, connectionStatus: "connected" });
    expect(ready).not.toHaveBeenCalled();
  });

  it("keeps the existing listener owned when a staged restore blocks after new listener startup", async () => {
    const credentials = {
      cookie: [{ key: "staged-restore-key", value: "staged-restore-value" }],
      imei: "staged-restore-imei",
      userAgent: "staged-restore-agent",
    };
    const originalSession = JSON.stringify({
      credentials,
      selfUserId: "saved-user-id",
      selfDisplayName: "Saved User",
      savedAt: "2026-07-22T00:00:00.000Z",
    });
    const sessionPath = join(sessionDir, "zalo-session.json");
    writeFileSync(sessionPath, originalSession, "utf8");

    class FakeListener extends EventEmitter {
      start = vi.fn(async () => {});
      stop = vi.fn(async () => {});
    }

    const oldListener = new FakeListener();
    const oldApi = {
      listener: oldListener,
      getOwnId: () => "old-user-id",
      getOwnName: () => "Old User",
    };
    const oldCredentials = { cookie: [{ key: "old-key", value: "old-value" }] };
    const gateway = new ZaloGatewayService();
    (gateway as any).api = oldApi;
    (gateway as any).zalo = { owner: "old-zalo" };
    (gateway as any).savedCredentials = oldCredentials;
    const oldBindings = await (gateway as any).startListener();
    expect(oldBindings).toMatchObject({ listener: oldListener });
    (gateway as any).status = {
      ...(gateway as any).status,
      connected: true,
      connectionStatus: "connected",
      selfUserId: "old-user-id",
      selfDisplayName: "Old User",
    };

    const newListener = new FakeListener();
    const newListenerStarted = deferred<void>();
    const newListenerCanFinish = deferred<void>();
    newListener.start = vi.fn(async () => {
      newListenerStarted.resolve();
      await newListenerCanFinish.promise;
    });
    zcaBoundary.login.mockResolvedValueOnce({
      listener: newListener,
      getOwnId: () => "new-user-id",
      getOwnName: () => "New User",
    });

    let blocked = false;
    vi.spyOn(gateway, "getLoginSafetyDecision").mockImplementation(() => blocked
      ? { allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" }
      : { allowed: true, reason: null });

    const restore = gateway.restoreSession();
    await newListenerStarted.promise;

    // The staged restore must not replace or stop the currently active owner.
    expect(gateway.getApi()).toBe(oldApi);
    expect((gateway as any).zalo).toEqual({ owner: "old-zalo" });
    expect((gateway as any).savedCredentials).toBe(oldCredentials);
    expect((gateway as any).listenerBindings).toBe(oldBindings);
    expect((gateway as any).listenerActive).toBe(true);
    expect(oldListener.stop).not.toHaveBeenCalled();

    blocked = true;
    gateway.getStatus();
    newListenerCanFinish.resolve();
    await expect(restore).resolves.toBe(false);

    expect(gateway.getApi()).toBe(oldApi);
    expect((gateway as any).zalo).toEqual({ owner: "old-zalo" });
    expect((gateway as any).savedCredentials).toBe(oldCredentials);
    expect((gateway as any).listenerBindings).toBe(oldBindings);
    expect((gateway as any).listenerActive).toBe(true);
    expect(oldListener.stop).not.toHaveBeenCalled();
    expect(newListener.stop).toHaveBeenCalled();
    expect(readFileSync(sessionPath, "utf8")).toBe(originalSession);

    await (gateway as any).stopListener();
  });
});
