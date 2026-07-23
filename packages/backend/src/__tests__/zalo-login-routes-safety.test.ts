import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const fsBoundary = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
  readdirSync: vi.fn(),
}));

const gateway = vi.hoisted(() => ({
  startLogin: vi.fn(),
  getLoginSafetyDecision: vi.fn(),
  enforceLoginSafety: vi.fn(),
  getStatus: vi.fn(),
  readCurrentQr: vi.fn(),
  cancelLogin: vi.fn(),
  persistSession: vi.fn(),
  getApi: vi.fn(),
  isConnected: vi.fn(),
  isListenerActive: vi.fn(),
  beginReconnect: vi.fn(),
  endReconnect: vi.fn(),
  restoreSession: vi.fn(),
  getLastRestoreSource: vi.fn(),
  scheduleReconnect: vi.fn(),
}));

const findLatestSessionBackup = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: fsBoundary.existsSync,
    readFileSync: fsBoundary.readFileSync,
    statSync: fsBoundary.statSync,
    readdirSync: fsBoundary.readdirSync,
  };
});

vi.mock("../services/zalo-gateway.service.js", () => ({
  getZaloGateway: vi.fn(() => gateway),
  findLatestSessionBackup,
}));

describe("Zalo login route safety", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { zaloRoutes } = await import("../routes/zalo.js");
    app = Fastify({ logger: false });
    await app.register(zaloRoutes, { prefix: "/api" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    gateway.startLogin.mockResolvedValue({ status: "connecting" });
    gateway.getLoginSafetyDecision.mockReturnValue({ allowed: true, reason: null });
    gateway.enforceLoginSafety.mockReturnValue({ allowed: true, reason: null });
    gateway.getStatus.mockReturnValue({
      connected: false,
      connectionStatus: "connecting",
      qrAvailable: false,
      qrUpdatedAt: null,
    });
    gateway.readCurrentQr.mockResolvedValue({ status: "not_found" });
    gateway.cancelLogin.mockReturnValue({ cancelled: false, message: "No login in progress" });
    gateway.persistSession.mockResolvedValue({ ok: false, message: "not connected" });
    gateway.getApi.mockReturnValue(null);
    gateway.isConnected.mockReturnValue(false);
    gateway.isListenerActive.mockReturnValue(false);
    gateway.beginReconnect.mockReturnValue(true);
    gateway.endReconnect.mockReturnValue(undefined);
    gateway.restoreSession.mockResolvedValue(false);
    gateway.getLastRestoreSource.mockReturnValue(null);
    gateway.scheduleReconnect.mockReturnValue(undefined);
    findLatestSessionBackup.mockReturnValue(null);
    fsBoundary.existsSync.mockReturnValue(false);
    fsBoundary.readFileSync.mockReturnValue(Buffer.from("qr-image"));
    fsBoundary.statSync.mockReturnValue({
      size: 1,
      mtimeMs: Date.now(),
      mtime: new Date(),
    });
    fsBoundary.readdirSync.mockReturnValue([]);
  });

  it("maps a blocked login start to the stable 409 envelope", async () => {
    gateway.startLogin.mockResolvedValue({
      status: "blocked",
      reason: "STATIC_DRY_RUN_ENABLED",
    });

    const response = await app.inject({ method: "POST", url: "/api/zalo/login/start" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "LOGIN_SAFETY_BLOCKED",
        message: "STATIC_DRY_RUN_ENABLED",
      },
    });
  });

  it("reports a fresh blocked login status instead of advertising idle QR", async () => {
    gateway.getLoginSafetyDecision.mockReturnValue({
      allowed: false,
      reason: "STATIC_DRY_RUN_ENABLED",
    });
    gateway.enforceLoginSafety.mockReturnValue({
      allowed: false,
      reason: "STATIC_DRY_RUN_ENABLED",
    });
    gateway.getStatus.mockReturnValue({
      connected: false,
      connectionStatus: "disconnected",
      lastConnectedAt: null,
      selfUserId: null,
      selfDisplayName: null,
      qrAvailable: false,
      qrUpdatedAt: null,
      lastError: null,
      dryRun: true,
    });

    const response = await app.inject({ method: "GET", url: "/api/zalo/login/status" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      connected: false,
      connectionStatus: "blocked",
      lastConnectedAt: null,
      selfUserId: null,
      selfDisplayName: null,
      listenerActive: false,
      qrAvailable: false,
      qrUpdatedAt: null,
      lastError: "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED",
      dryRun: expect.any(Boolean),
    });
    expect(gateway.enforceLoginSafety).toHaveBeenCalledOnce();
    expect(gateway.isListenerActive).toHaveBeenCalledOnce();
  });

  it("reports the listener state for an allowed login status", async () => {
    gateway.isListenerActive.mockReturnValue(true);
    gateway.getStatus.mockReturnValue({
      connected: false,
      connectionStatus: "connecting",
      lastConnectedAt: null,
      selfUserId: null,
      selfDisplayName: null,
      qrAvailable: false,
      qrUpdatedAt: null,
      lastError: null,
      dryRun: false,
    });

    const response = await app.inject({ method: "GET", url: "/api/zalo/login/status" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      connected: false,
      connectionStatus: "connecting",
      lastConnectedAt: null,
      selfUserId: null,
      selfDisplayName: null,
      listenerActive: true,
      qrAvailable: false,
      qrUpdatedAt: null,
      lastError: null,
      dryRun: expect.any(Boolean),
    });
    expect(gateway.isListenerActive).toHaveBeenCalledOnce();
  });

  it("reports a fresh blocked generic Zalo status without mutating idle gateway state", async () => {
    gateway.enforceLoginSafety.mockReturnValue({
      allowed: false,
      reason: "STATIC_DRY_RUN_ENABLED",
    });
    gateway.getStatus.mockReturnValue({
      connected: false,
      connectionStatus: "disconnected",
      qrAvailable: false,
      qrUpdatedAt: null,
      lastError: null,
      dryRun: true,
    });

    const response = await app.inject({ method: "GET", url: "/api/zalo/status" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      connected: false,
      connectionStatus: "blocked",
      qrAvailable: false,
      qrUpdatedAt: null,
      lastError: "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED",
    });
    expect(gateway.enforceLoginSafety).toHaveBeenCalledOnce();
  });

  it("blocks QR retrieval before touching a stale file", async () => {
    gateway.readCurrentQr.mockResolvedValue({
      status: "blocked",
      reason: "STATIC_DRY_RUN_ENABLED",
    });

    const response = await app.inject({ method: "GET", url: "/api/zalo/login/qr" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "LOGIN_SAFETY_BLOCKED",
        message: "STATIC_DRY_RUN_ENABLED",
      },
    });
    expect(fsBoundary.existsSync).not.toHaveBeenCalled();
    expect(fsBoundary.readFileSync).not.toHaveBeenCalled();
  });

  it("returns QR_NOT_FOUND without reading a stale non-current file", async () => {
    gateway.readCurrentQr.mockResolvedValue({ status: "not_found" });
    fsBoundary.existsSync.mockReturnValue(true);

    const response = await app.inject({ method: "GET", url: "/api/zalo/login/qr" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "QR_NOT_FOUND" } });
    expect(fsBoundary.existsSync).not.toHaveBeenCalled();
    expect(fsBoundary.readFileSync).not.toHaveBeenCalled();
  });

  it("returns the QR image only for a valid current generation", async () => {
    gateway.readCurrentQr.mockResolvedValue({
      status: "ok",
      data: Buffer.from("current-qr"),
      updatedAt: "2026-07-22T04:00:00.000Z",
    });
    fsBoundary.existsSync.mockReturnValue(true);
    fsBoundary.readFileSync.mockReturnValue(Buffer.from("current-qr"));

    const response = await app.inject({ method: "GET", url: "/api/zalo/login/qr" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      qrDataURL: `data:image/png;base64,${Buffer.from("current-qr").toString("base64")}`,
      updatedAt: "2026-07-22T04:00:00.000Z",
    });
    expect(gateway.readCurrentQr).toHaveBeenCalledOnce();
    expect(fsBoundary.existsSync).not.toHaveBeenCalled();
    expect(fsBoundary.readFileSync).not.toHaveBeenCalled();
  });

  it("returns canonical QR_NOT_FOUND when the current QR disappears before read", async () => {
    gateway.readCurrentQr.mockResolvedValue({ status: "not_found" });

    const response = await app.inject({ method: "GET", url: "/api/zalo/login/qr" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "QR_NOT_FOUND" } });
    expect(fsBoundary.existsSync).not.toHaveBeenCalled();
    expect(fsBoundary.readFileSync).not.toHaveBeenCalled();
  });

  it("maps a safety block returned after a delayed gateway read to 409", async () => {
    gateway.readCurrentQr.mockResolvedValue({
      status: "blocked",
      reason: "OUTBOUND_DRY_RUN_REQUIRED",
    });
    fsBoundary.existsSync.mockReturnValue(true);

    const response = await app.inject({ method: "GET", url: "/api/zalo/login/qr" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "LOGIN_SAFETY_BLOCKED",
        message: "OUTBOUND_DRY_RUN_REQUIRED",
      },
    });
    expect(fsBoundary.existsSync).not.toHaveBeenCalled();
    expect(fsBoundary.readFileSync).not.toHaveBeenCalled();
  });

  it("blocks reconnect before claiming the mutex or scheduling gateway work", async () => {
    gateway.enforceLoginSafety.mockReturnValue({
      allowed: false,
      reason: "STATIC_DRY_RUN_ENABLED",
    });

    const response = await app.inject({ method: "POST", url: "/api/zalo/ops/reconnect" });

    expect(response.json()).toMatchObject({
      success: false,
      status: "login_safety_blocked",
      message: "STATIC_DRY_RUN_ENABLED",
    });
    expect(gateway.enforceLoginSafety).toHaveBeenCalledOnce();
    expect(gateway.getLoginSafetyDecision).not.toHaveBeenCalled();
    expect(gateway.beginReconnect).not.toHaveBeenCalled();
    expect(gateway.restoreSession).not.toHaveBeenCalled();
    expect(gateway.startLogin).not.toHaveBeenCalled();
    expect(gateway.scheduleReconnect).not.toHaveBeenCalled();
  });

  it("returns login_safety_blocked when policy flips while startLogin resolves", async () => {
    gateway.enforceLoginSafety
      .mockReturnValueOnce({ allowed: true, reason: null })
      .mockReturnValue({ allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" });
    gateway.startLogin.mockResolvedValue({ status: "connecting" });

    const response = await app.inject({ method: "POST", url: "/api/zalo/ops/reconnect" });

    expect(response.json()).toMatchObject({
      success: false,
      status: "login_safety_blocked",
      message: "OUTBOUND_DRY_RUN_REQUIRED",
    });
    expect(gateway.beginReconnect).toHaveBeenCalledOnce();
    expect(gateway.restoreSession).not.toHaveBeenCalled();
    expect(gateway.startLogin).toHaveBeenCalledOnce();
    expect(gateway.enforceLoginSafety).toHaveBeenCalledTimes(2);
    expect(gateway.endReconnect).toHaveBeenCalledOnce();
    expect(gateway.scheduleReconnect).not.toHaveBeenCalled();
  });

  it("returns login_safety_blocked when startLogin throws after policy flips", async () => {
    gateway.enforceLoginSafety
      .mockReturnValueOnce({ allowed: true, reason: null })
      .mockReturnValue({ allowed: false, reason: "STATIC_DRY_RUN_ENABLED" });
    gateway.startLogin.mockRejectedValue(new Error("start exploded"));

    const response = await app.inject({ method: "POST", url: "/api/zalo/ops/reconnect" });

    expect(response.json()).toMatchObject({
      success: false,
      status: "login_safety_blocked",
      message: "STATIC_DRY_RUN_ENABLED",
    });
    expect(gateway.enforceLoginSafety).toHaveBeenCalledTimes(2);
    expect(gateway.endReconnect).toHaveBeenCalledOnce();
    expect(gateway.scheduleReconnect).not.toHaveBeenCalled();
  });

  it("returns login_safety_blocked when restore throws after policy flips", async () => {
    fsBoundary.existsSync.mockReturnValue(true);
    gateway.enforceLoginSafety
      .mockReturnValueOnce({ allowed: true, reason: null })
      .mockReturnValue({ allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" });
    gateway.restoreSession.mockRejectedValue(new Error("restore exploded"));

    const response = await app.inject({ method: "POST", url: "/api/zalo/ops/reconnect" });

    expect(response.json()).toMatchObject({
      success: false,
      status: "login_safety_blocked",
      message: "OUTBOUND_DRY_RUN_REQUIRED",
    });
    expect(gateway.restoreSession).toHaveBeenCalledOnce();
    expect(gateway.enforceLoginSafety).toHaveBeenCalledTimes(2);
    expect(gateway.startLogin).not.toHaveBeenCalled();
    expect(gateway.endReconnect).toHaveBeenCalledOnce();
    expect(gateway.scheduleReconnect).not.toHaveBeenCalled();
  });
});
