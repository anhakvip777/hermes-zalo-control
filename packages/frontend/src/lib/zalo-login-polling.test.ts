import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZaloLoginCard } from "../components/zalo-login-card";
import {
  beginZaloLoginStatusRequest,
  cancelAndReconcileZaloLogin,
  decideZaloLoginInitialState,
  decideZaloLoginPoll,
  finishZaloLoginStatusRequest,
  getZaloLoginCardReconcileKey,
  getZaloLoginUiActions,
  getZaloLoginPanelA11y,
  getZaloLoginSafetyBlockedReason,
  decideZaloLoginStatusRequestError,
  isIgnorableZaloLoginRequestError,
  isCurrentZaloLoginFlow,
  isCurrentZaloLoginQrRequest,
  runZaloLoginPollStep,
} from "./zalo-login-polling";
import type { LoginStatusOutput, QRImageResult } from "./api-client";

function loginStatus(overrides: Partial<LoginStatusOutput> = {}): LoginStatusOutput {
  return {
    connected: false,
    connectionStatus: "connecting",
    dryRun: false,
    selfUserId: null,
    selfDisplayName: null,
    listenerActive: false,
    qrAvailable: false,
    qrUpdatedAt: null,
    lastConnectedAt: null,
    lastError: null,
    ...overrides,
  };
}

function apiFailure(code: string) {
  return Object.assign(new Error(code), { code });
}

function opsReconcileState(overrides: Record<string, unknown> = {}) {
  return {
    connectionStatus: "disconnected" as const,
    connectionDetail: "qr_required" as const,
    lastError: null,
    session: {
      exists: false,
      qrUpdatedAt: null,
      updatedAt: null,
      backupAvailable: false,
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decideZaloLoginPoll", () => {
  it("renders a fail-closed checking state before the initial status is known", () => {
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(React.createElement(ZaloLoginCard));

    expect(html).toContain('aria-label="Checking Zalo login status"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Tạo QR đăng nhập Zalo");
  });

  it("keeps polling while QR is not generated yet", () => {
    expect(decideZaloLoginPoll({ connected: false, connectionStatus: "connecting", qrAvailable: false, lastError: null }))
      .toEqual({ phase: "pending", fetchQr: false, stopPolling: false, clearQr: false, message: null });
  });

  it.each(["error", "unexpected_status"] as const)(
    "treats connected=true as terminal even when connection status is %s",
    (connectionStatus) => {
      expect(decideZaloLoginPoll({
        connected: true,
        connectionStatus: connectionStatus as LoginStatusOutput["connectionStatus"],
        qrAvailable: true,
        lastError: "STALE_STATUS",
      })).toEqual({
        phase: "connected",
        fetchQr: false,
        stopPolling: true,
        clearQr: true,
        message: null,
      });
    },
  );

  it("fails closed on an error status without fetching QR", () => {
    expect(decideZaloLoginPoll({
      connected: false,
      connectionStatus: "error",
      qrAvailable: true,
      lastError: "RESTORE_FAILED",
    })).toEqual({
      phase: "error",
      fetchQr: false,
      stopPolling: true,
      clearQr: true,
      message: "LOGIN_STATUS_UNAVAILABLE",
    });
  });

  it("stops and clears QR when safety blocks", () => {
    expect(decideZaloLoginPoll({
      connected: false,
      connectionStatus: "blocked",
      qrAvailable: true,
      lastError: "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED",
    })).toEqual({ phase: "blocked", fetchQr: false, stopPolling: true, clearQr: true, message: "STATIC_DRY_RUN_ENABLED" });
  });

  it("restores an initial safety block as a terminal state", () => {
    expect(decideZaloLoginInitialState({
      connected: false,
      connectionStatus: "blocked",
      qrAvailable: true,
      lastError: "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED",
    })).toEqual({
      phase: "blocked",
      fetchQr: false,
      startPolling: false,
      stopPolling: true,
      clearQr: true,
      message: "STATIC_DRY_RUN_ENABLED",
    });
  });

  it("restores an initial expiry as a terminal state", () => {
    expect(decideZaloLoginInitialState({
      connected: false,
      connectionStatus: "expired",
      qrAvailable: true,
      lastError: null,
    })).toEqual({
      phase: "expired",
      fetchQr: false,
      startPolling: false,
      stopPolling: true,
      clearQr: true,
      message: null,
    });
  });

  it("classifies a login-start safety response as blocked", () => {
    const error = Object.assign(new Error("STATIC_DRY_RUN_ENABLED"), {
      status: 409,
      code: "LOGIN_SAFETY_BLOCKED",
    });

    expect(getZaloLoginSafetyBlockedReason(error)).toBe("STATIC_DRY_RUN_ENABLED");
  });

  it("rejects a delayed QR response from a superseded request", () => {
    expect(isCurrentZaloLoginQrRequest(4, 5)).toBe(false);
    expect(isCurrentZaloLoginQrRequest(5, 5)).toBe(true);
  });

  it("rejects a delayed start response after cancel or unmount", () => {
    expect(isCurrentZaloLoginFlow(4, 5)).toBe(false);
    expect(isCurrentZaloLoginFlow(5, 5)).toBe(true);
  });

  it("rejects a cancel response after its request is aborted", () => {
    const controller = new AbortController();
    expect(isCurrentZaloLoginFlow(5, 5, controller.signal)).toBe(true);

    controller.abort();

    expect(isCurrentZaloLoginFlow(5, 5, controller.signal)).toBe(false);
  });

  it("skips an overlapping status tick without aborting the active request", () => {
    const slot = { current: null as AbortController | null };
    const first = beginZaloLoginStatusRequest(slot);
    const overlapping = beginZaloLoginStatusRequest(slot);

    expect(first).toBeInstanceOf(AbortController);
    expect(overlapping).toBeNull();
    expect(first?.signal.aborted).toBe(false);

    finishZaloLoginStatusRequest(slot, first!);
    expect(beginZaloLoginStatusRequest(slot)).toBeInstanceOf(AbortController);
  });

  it("does not let an older status request clear a newer request slot", () => {
    const first = new AbortController();
    const newer = new AbortController();
    const slot = { current: newer as AbortController | null };

    finishZaloLoginStatusRequest(slot, first);

    expect(slot.current).toBe(newer);
    expect(newer.signal.aborted).toBe(false);
  });

  it("keeps QR_NOT_FOUND transient so a later poll can deliver the QR", async () => {
    const qr: QRImageResult = {
      qrDataURL: "data:image/png;base64,ZmFrZQ==",
      updatedAt: "2026-07-22T00:00:00.000Z",
    };
    const loadQr = vi.fn()
      .mockRejectedValueOnce(apiFailure("QR_NOT_FOUND"))
      .mockResolvedValueOnce(qr);
    const status = loginStatus({ connectionStatus: "waiting_qr_scan", qrAvailable: true });

    await expect(runZaloLoginPollStep(status, loadQr)).resolves.toMatchObject({
      decision: { phase: "pending", stopPolling: false },
      qr: null,
    });
    await expect(runZaloLoginPollStep(status, loadQr)).resolves.toEqual({
      decision: decideZaloLoginPoll(status),
      qr,
    });
    expect(loadQr).toHaveBeenCalledTimes(2);
  });

  it("does not call the QR loader after a blocked status decision", async () => {
    const loadQr = vi.fn();
    const status = loginStatus({
      connectionStatus: "blocked",
      qrAvailable: true,
      lastError: "LOGIN_SAFETY_BLOCKED:OUTBOUND_DRY_RUN_REQUIRED",
    });

    await expect(runZaloLoginPollStep(status, loadQr)).resolves.toEqual({
      decision: decideZaloLoginPoll(status),
      qr: null,
    });
    expect(loadQr).not.toHaveBeenCalled();
  });

  it.each(["REQUEST_ABORTED", "STALE_RESPONSE"] as const)(
    "ignores %s from a QR request without turning the poll into a UI error",
    async (code) => {
      const status = loginStatus({ connectionStatus: "waiting_qr_scan", qrAvailable: true });
      const loadQr = vi.fn().mockRejectedValue(apiFailure(code));

      await expect(runZaloLoginPollStep(status, loadQr)).resolves.toMatchObject({
        decision: { phase: "pending", stopPolling: false, clearQr: false },
        qr: null,
        ignored: true,
      });
    },
  );

  it("serializes cancel before status reconciliation and trusts status over cancelled:false", async () => {
    const order: string[] = [];
    let releaseCancel!: () => void;
    const cancelSettled = new Promise<void>((resolve) => { releaseCancel = resolve; });
    const cancel = vi.fn(async () => {
      order.push("cancel");
      await cancelSettled;
      return { data: { cancelled: false, message: "No login in progress" } };
    });
    const status = vi.fn(async () => {
      order.push("status");
      return loginStatus({ connectionStatus: "waiting_qr_scan", qrAvailable: true });
    });

    const pending = cancelAndReconcileZaloLogin(cancel, status);
    await Promise.resolve();
    expect(order).toEqual(["cancel"]);
    releaseCancel();

    await expect(pending).resolves.toMatchObject({
      kind: "known",
      decision: { phase: "pending" },
    });
    expect(order).toEqual(["cancel", "status"]);
  });

  it("reconciles server truth after a cancel network error", async () => {
    const connected = loginStatus({ connected: true, connectionStatus: "connected" });

    await expect(cancelAndReconcileZaloLogin(
      async () => { throw apiFailure("NETWORK_ERROR"); },
      async () => connected,
    )).resolves.toMatchObject({
      kind: "known",
      status: connected,
      decision: { phase: "connected" },
    });
  });

  it("reports cancellation truth as unavailable when status cannot be known", async () => {
    await expect(cancelAndReconcileZaloLogin(
      async () => ({ data: { cancelled: true, message: "Login cancelled" } }),
      async () => { throw apiFailure("REQUEST_TIMEOUT"); },
    )).resolves.toEqual({ kind: "unavailable", message: "LOGIN_STATUS_UNAVAILABLE" });
  });

  it.each(["REQUEST_ABORTED", "STALE_RESPONSE"] as const)(
    "does not start status reconciliation after an ignored cancel result: %s",
    async (code) => {
      const loadStatus = vi.fn(async () => loginStatus());

      await expect(cancelAndReconcileZaloLogin(
        async () => { throw apiFailure(code); },
        loadStatus,
      )).resolves.toEqual({ kind: "stale" });
      expect(loadStatus).not.toHaveBeenCalled();
    },
  );

  it("preserves a blocked server decision during cancel reconciliation", async () => {
    const blocked = loginStatus({
      connectionStatus: "blocked",
      qrAvailable: false,
      lastError: "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED",
    });

    await expect(cancelAndReconcileZaloLogin(
      async () => ({ data: { cancelled: true, message: "Login cancelled" } }),
      async () => blocked,
    )).resolves.toMatchObject({
      kind: "known",
      status: blocked,
      decision: {
        phase: "blocked",
        stopPolling: true,
        clearQr: true,
        message: "STATIC_DRY_RUN_ENABLED",
      },
    });
  });

  it("classifies a direct safety block during status reconciliation as blocked", async () => {
    const safetyError = Object.assign(apiFailure("LOGIN_SAFETY_BLOCKED"), {
      status: 409,
      message: "OUTBOUND_DRY_RUN_REQUIRED",
    });

    await expect(cancelAndReconcileZaloLogin(
      async () => ({ data: { cancelled: true, message: "Login cancelled" } }),
      async () => { throw safetyError; },
    )).resolves.toEqual({
      kind: "blocked",
      message: "OUTBOUND_DRY_RUN_REQUIRED",
    });
  });

  it("classifies a direct safety block during periodic status polling as blocked", () => {
    const safetyError = Object.assign(apiFailure("LOGIN_SAFETY_BLOCKED"), {
      status: 409,
      message: "OUTBOUND_DRY_RUN_REQUIRED",
    });

    expect(decideZaloLoginStatusRequestError(safetyError)).toEqual({
      kind: "blocked",
      message: "OUTBOUND_DRY_RUN_REQUIRED",
    });
  });

  it.each([
    ["REQUEST_ABORTED", true],
    ["STALE_RESPONSE", true],
    ["NETWORK_ERROR", false],
    ["REQUEST_TIMEOUT", false],
    ["INVALID_RESPONSE", false],
  ] as const)("classifies %s as ignorable=%s", (code, expected) => {
    expect(isIgnorableZaloLoginRequestError(apiFailure(code))).toBe(expected);
  });

  it("keeps unknown, unavailable, and cancelling phases free of QR mutations", () => {
    expect(getZaloLoginUiActions("checking")).toEqual([]);
    expect(getZaloLoginUiActions("cancelling")).toEqual([]);
    expect(getZaloLoginUiActions("error")).toEqual(["check_status"]);
  });

  it("exposes only the phase-appropriate controlled QR actions", () => {
    expect(getZaloLoginUiActions("idle")).toEqual(["start"]);
    expect(getZaloLoginUiActions("pending")).toEqual(["replace", "cancel"]);
    expect(getZaloLoginUiActions("expired")).toEqual(["start", "return_idle"]);
    expect(getZaloLoginUiActions("blocked")).toEqual(["return_idle"]);
    expect(getZaloLoginUiActions("connected")).toEqual([]);
  });

  it("provides terminal/live-region semantics for every async QR panel", () => {
    expect(getZaloLoginPanelA11y("checking")).toEqual({ role: "status", live: "polite", busy: "true" });
    expect(getZaloLoginPanelA11y("cancelling")).toEqual({ role: "status", live: "polite", busy: "true" });
    expect(getZaloLoginPanelA11y("blocked")).toEqual({ role: "alert", live: "assertive", busy: "false" });
    expect(getZaloLoginPanelA11y("error")).toEqual({ role: "alert", live: "assertive", busy: "false" });
    expect(getZaloLoginPanelA11y("expired")).toEqual({ role: "alert", live: "assertive", busy: "false" });
  });

  it("keeps the login card reconciliation key stable for identical ops refreshes", () => {
    const first = opsReconcileState();
    const identicalRefresh = opsReconcileState();

    expect(getZaloLoginCardReconcileKey(first)).toBe(getZaloLoginCardReconcileKey(identicalRefresh));
  });

  it("ignores transient last-error changes while ops is not safety-blocked", () => {
    const first = opsReconcileState({ lastError: "STATUS_POLL_TIMEOUT" });
    const retry = opsReconcileState({ lastError: "STATUS_POLL_UNAVAILABLE" });

    expect(getZaloLoginCardReconcileKey(first)).toBe(getZaloLoginCardReconcileKey(retry));
  });

  it("changes the reconciliation key when ops becomes safety-blocked", () => {
    const idle = opsReconcileState();
    const blocked = opsReconcileState({
      connectionStatus: "blocked",
      connectionDetail: "login_safety_blocked",
      lastError: "LOGIN_SAFETY_BLOCKED:OUTBOUND_DRY_RUN_REQUIRED",
    });

    expect(getZaloLoginCardReconcileKey(blocked)).not.toBe(getZaloLoginCardReconcileKey(idle));
  });

  it("changes the reconciliation key when the canonical safety-block reason changes", () => {
    const staticDryRunBlock = opsReconcileState({
      connectionStatus: "blocked",
      connectionDetail: "login_safety_blocked",
      lastError: "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED",
    });
    const outboundDryRunBlock = opsReconcileState({
      connectionStatus: "blocked",
      connectionDetail: "login_safety_blocked",
      lastError: "LOGIN_SAFETY_BLOCKED:OUTBOUND_DRY_RUN_REQUIRED",
    });

    expect(getZaloLoginCardReconcileKey(staticDryRunBlock))
      .not.toBe(getZaloLoginCardReconcileKey(outboundDryRunBlock));
  });

  it("changes the reconciliation key only when session generation evidence changes", () => {
    const initial = opsReconcileState();
    const nextGeneration = opsReconcileState({
      session: {
        exists: true,
        qrUpdatedAt: "2026-07-22T08:00:00.000Z",
        updatedAt: "2026-07-22T08:00:01.000Z",
        backupAvailable: false,
      },
    });

    expect(getZaloLoginCardReconcileKey(nextGeneration)).not.toBe(getZaloLoginCardReconcileKey(initial));
  });
});
