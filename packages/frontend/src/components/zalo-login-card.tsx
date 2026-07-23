"use client";

/**
 * ZaloLoginCard — Web QR Login (ZALO-WEB-LOGIN)
 *
 * Admin đã đăng nhập web → bấm "Tạo QR đăng nhập Zalo" → QR hiện ngay.
 * Không cần nhập username/password — browser tự inject Basic auth đã lưu.
 * Nếu chưa auth thì browser tự hiện WWW-Authenticate dialog (behavior chuẩn).
 *
 * Phases:
 *   checking  → status unknown; no mutation is available
 *   idle      → disconnected, nút "Tạo QR"
 *   starting  → start request in flight; cancel only
 *   pending   → QR hiển thị, polling 2s
 *   cancelling → cancel plus read-only status reconciliation in flight
 *   connected → scan thành công
 *   expired   → QR hết hạn, cho tạo lại
 *   blocked   → safety reason only; no direct retry
 *   error     → status unavailable; only a read-only status recheck
 */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  startZaloLogin,
  getZaloLoginStatus,
  getZaloLoginQR,
  cancelZaloLogin,
  type LoginStatusOutput,
} from "../lib/api-client";
import {
  beginZaloLoginStatusRequest,
  cancelAndReconcileZaloLogin,
  decideZaloLoginStatusRequestError,
  decideZaloLoginInitialState,
  decideZaloLoginPoll,
  finishZaloLoginStatusRequest,
  getZaloLoginSafetyBlockedReason,
  getZaloLoginPanelA11y,
  getZaloLoginUiActions,
  isCurrentZaloLoginFlow,
  isCurrentZaloLoginQrRequest,
  isIgnorableZaloLoginRequestError,
  runZaloLoginPollStep,
  type ZaloLoginUiPhase,
  ZALO_LOGIN_POLL_ERROR_MESSAGE,
} from "../lib/zalo-login-polling";

const POLL_MS = 2000;

// ── Badge helper ─────────────────────────────────────────────────────
function Badge({ color, children }: { color: "green" | "yellow" | "red" | "blue" | "slate"; children: React.ReactNode }) {
  const cls = {
    green: "border-green-800 bg-green-950/40 text-green-400",
    yellow: "border-yellow-800 bg-yellow-950/40 text-yellow-400",
    red: "border-red-800 bg-red-950/40 text-red-400",
    blue: "border-blue-800 bg-blue-950/40 text-blue-400",
    slate: "border-slate-700 bg-slate-800/60 text-slate-400",
  }[color];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

// ── Main ─────────────────────────────────────────────────────────────
export function ZaloLoginCard({ onConnected, backupAvailable }: { onConnected?: () => void; backupAvailable?: boolean }) {
  const [phase, setPhase] = useState<ZaloLoginUiPhase>("checking");
  const [status, setStatus] = useState<LoginStatusOutput | null>(null);
  const [qrDataURL, setQrDataURL] = useState<string | null>(null);
  const [qrUpdatedAt, setQrUpdatedAt] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRequestAbortRef = useRef<AbortController | null>(null);
  const statusRequestAbortRef = useRef<AbortController | null>(null);
  const qrRequestAbortRef = useRef<AbortController | null>(null);
  const cancelRequestAbortRef = useRef<AbortController | null>(null);
  const loginFlowGenerationRef = useRef(0);
  const qrRequestGenerationRef = useRef(0);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const abortStatusRequest = useCallback(() => {
    statusRequestAbortRef.current?.abort();
    statusRequestAbortRef.current = null;
  }, []);

  const invalidateLoginFlow = useCallback(() => {
    loginFlowGenerationRef.current += 1;
    startRequestAbortRef.current?.abort();
    startRequestAbortRef.current = null;
    cancelRequestAbortRef.current?.abort();
    cancelRequestAbortRef.current = null;
  }, []);

  const invalidateQrRequest = useCallback(() => {
    qrRequestGenerationRef.current += 1;
    qrRequestAbortRef.current?.abort();
    qrRequestAbortRef.current = null;
  }, []);

  const clearQr = useCallback(() => {
    invalidateQrRequest();
    setQrDataURL(null);
    setQrUpdatedAt(null);
  }, [invalidateQrRequest]);

  const endLoginFlow = useCallback((nextPhase: "blocked" | "expired" | "error" | "idle", message: string | null) => {
    invalidateLoginFlow();
    stopPolling();
    abortStatusRequest();
    clearQr();
    setErrMsg(message);
    setPhase(nextPhase);
  }, [abortStatusRequest, clearQr, invalidateLoginFlow, stopPolling]);

  // ── Poll status every 2s ─────────────────────────────────────────
  const pollStatus = useCallback(async () => {
    const flowGeneration = loginFlowGenerationRef.current;
    const controller = beginZaloLoginStatusRequest(statusRequestAbortRef);
    if (!controller) return;

    let nextStatus: LoginStatusOutput;
    try {
      nextStatus = await getZaloLoginStatus(controller.signal);
    } catch (error: unknown) {
      const errorDecision = decideZaloLoginStatusRequestError(error);
      if (
        statusRequestAbortRef.current === controller &&
        isCurrentZaloLoginFlow(flowGeneration, loginFlowGenerationRef.current, controller.signal) &&
        errorDecision.kind !== "ignore"
      ) {
        endLoginFlow(errorDecision.kind === "blocked" ? "blocked" : "error", errorDecision.message);
      }
      return;
    } finally {
      finishZaloLoginStatusRequest(statusRequestAbortRef, controller);
    }

    if (!isCurrentZaloLoginFlow(flowGeneration, loginFlowGenerationRef.current, controller.signal)) return;
    setStatus(nextStatus);
    const decision = decideZaloLoginPoll(nextStatus);
    if (decision.phase === "connected") {
      setPhase("connected");
      setErrMsg(null);
      stopPolling();
      clearQr();
      onConnectedRef.current?.();
      return;
    }
    if (decision.phase !== "pending") {
      endLoginFlow(decision.phase, decision.message);
      return;
    }

    setPhase("pending");
    setErrMsg(null);
    if (!decision.fetchQr || qrRequestAbortRef.current) return;

    const qrRequestGeneration = qrRequestGenerationRef.current + 1;
    qrRequestGenerationRef.current = qrRequestGeneration;
    const qrController = new AbortController();
    qrRequestAbortRef.current = qrController;
    const step = await runZaloLoginPollStep(
      nextStatus,
      () => getZaloLoginQR(qrController.signal),
    );
    if (qrRequestAbortRef.current === qrController) qrRequestAbortRef.current = null;
    if (
      !isCurrentZaloLoginFlow(flowGeneration, loginFlowGenerationRef.current, qrController.signal) ||
      !isCurrentZaloLoginQrRequest(qrRequestGeneration, qrRequestGenerationRef.current)
    ) return;

    if (step.decision.phase === "connected") {
      setPhase("connected");
      setErrMsg(null);
      stopPolling();
      clearQr();
      onConnectedRef.current?.();
      return;
    }
    if (step.decision.phase !== "pending") {
      endLoginFlow(step.decision.phase, step.decision.message);
      return;
    }
    if (step.qr) {
      setQrDataURL(step.qr.qrDataURL);
      setQrUpdatedAt(step.qr.updatedAt);
    }
  }, [clearQr, endLoginFlow, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    void pollStatus();
    pollRef.current = setInterval(pollStatus, POLL_MS);
  }, [pollStatus, stopPolling]);

  const applyKnownStatus = useCallback((nextStatus: LoginStatusOutput, notifyConnected = true) => {
    setStatus(nextStatus);
    const decision = decideZaloLoginInitialState(nextStatus);
    if (decision.phase === "connected") {
      setPhase("connected");
      setErrMsg(null);
      stopPolling();
      abortStatusRequest();
      clearQr();
      if (notifyConnected) onConnectedRef.current?.();
      return;
    }
    if (decision.phase === "pending") {
      setPhase("pending");
      setErrMsg(null);
      startPolling();
      return;
    }
    endLoginFlow(decision.phase, decision.message);
  }, [abortStatusRequest, clearQr, endLoginFlow, startPolling, stopPolling]);

  const checkCurrentStatus = useCallback(async () => {
    invalidateLoginFlow();
    const flowGeneration = loginFlowGenerationRef.current;
    stopPolling();
    abortStatusRequest();
    clearQr();
    setPhase("checking");
    setErrMsg(null);

    const controller = beginZaloLoginStatusRequest(statusRequestAbortRef);
    if (!controller) return;
    try {
      const nextStatus = await getZaloLoginStatus(controller.signal);
      if (
        statusRequestAbortRef.current !== controller ||
        !isCurrentZaloLoginFlow(flowGeneration, loginFlowGenerationRef.current, controller.signal)
      ) return;
      finishZaloLoginStatusRequest(statusRequestAbortRef, controller);
      applyKnownStatus(nextStatus, false);
    } catch (error: unknown) {
      const errorDecision = decideZaloLoginStatusRequestError(error);
      if (
        statusRequestAbortRef.current === controller &&
        isCurrentZaloLoginFlow(flowGeneration, loginFlowGenerationRef.current, controller.signal) &&
        errorDecision.kind !== "ignore"
      ) {
        endLoginFlow(errorDecision.kind === "blocked" ? "blocked" : "error", errorDecision.message);
      }
    } finally {
      finishZaloLoginStatusRequest(statusRequestAbortRef, controller);
    }
  }, [abortStatusRequest, applyKnownStatus, clearQr, endLoginFlow, invalidateLoginFlow, stopPolling]);

  // ── Mount: check current status ──────────────────────────────────
  useEffect(() => {
    void checkCurrentStatus();
    return () => {
      invalidateLoginFlow();
      stopPolling();
      abortStatusRequest();
      invalidateQrRequest();
    };
  }, [abortStatusRequest, checkCurrentStatus, invalidateLoginFlow, invalidateQrRequest, stopPolling]);

  // ── Tạo QR ──────────────────────────────────────────────────────
  const doStart = useCallback(async () => {
    invalidateLoginFlow();
    const flowGeneration = loginFlowGenerationRef.current;
    const controller = new AbortController();
    startRequestAbortRef.current = controller;
    stopPolling();
    abortStatusRequest();
    clearQr();
    setPhase("starting");
    setErrMsg(null);
    try {
      const r = await startZaloLogin(controller.signal);
      if (!isCurrentZaloLoginFlow(flowGeneration, loginFlowGenerationRef.current, controller.signal)) return;
      if (r.data.status === "already_connected" || r.data.status === "connected") {
        const nextStatus = await getZaloLoginStatus(controller.signal);
        if (!isCurrentZaloLoginFlow(flowGeneration, loginFlowGenerationRef.current, controller.signal)) return;
        applyKnownStatus(nextStatus);
        return;
      }
      setPhase("pending");
      startPolling();
    } catch (e: unknown) {
      if (
        !isCurrentZaloLoginFlow(flowGeneration, loginFlowGenerationRef.current, controller.signal) ||
        isIgnorableZaloLoginRequestError(e)
      ) return;
      const safetyReason = getZaloLoginSafetyBlockedReason(e);
      if (safetyReason) {
        endLoginFlow("blocked", safetyReason);
        return;
      }
      endLoginFlow("error", ZALO_LOGIN_POLL_ERROR_MESSAGE);
    } finally {
      if (startRequestAbortRef.current === controller) startRequestAbortRef.current = null;
    }
  }, [abortStatusRequest, applyKnownStatus, clearQr, endLoginFlow, invalidateLoginFlow, startPolling, stopPolling]);

  // ── Tạo QR mới (refresh) ─────────────────────────────────────────
  const doRefresh = useCallback(async () => {
    invalidateLoginFlow();
    const flowGeneration = loginFlowGenerationRef.current;
    const controller = new AbortController();
    cancelRequestAbortRef.current = controller;
    stopPolling();
    abortStatusRequest();
    clearQr();
    setPhase("cancelling");
    setErrMsg(null);

    const reconciliation = await cancelAndReconcileZaloLogin(
      () => cancelZaloLogin(controller.signal),
      () => getZaloLoginStatus(controller.signal),
    );
    if (!isCurrentZaloLoginFlow(flowGeneration, loginFlowGenerationRef.current, controller.signal)) return;
    if (cancelRequestAbortRef.current === controller) cancelRequestAbortRef.current = null;
    if (reconciliation.kind === "stale") return;
    if (reconciliation.kind === "blocked") {
      endLoginFlow("blocked", reconciliation.message);
      return;
    }
    if (reconciliation.kind === "unavailable") {
      endLoginFlow("error", reconciliation.message);
      return;
    }
    if (reconciliation.decision.phase === "idle" || reconciliation.decision.phase === "expired") {
      setStatus(reconciliation.status);
      await doStart();
      return;
    }
    applyKnownStatus(reconciliation.status);
  }, [abortStatusRequest, applyKnownStatus, clearQr, doStart, endLoginFlow, invalidateLoginFlow, stopPolling]);

  // ── Hủy ─────────────────────────────────────────────────────────
  const doCancel = useCallback(async () => {
    invalidateLoginFlow();
    const flowGeneration = loginFlowGenerationRef.current;
    const controller = new AbortController();
    cancelRequestAbortRef.current = controller;
    stopPolling();
    abortStatusRequest();
    clearQr();
    setPhase("cancelling");
    setErrMsg(null);
    const reconciliation = await cancelAndReconcileZaloLogin(
      () => cancelZaloLogin(controller.signal),
      () => getZaloLoginStatus(controller.signal),
    );
    if (!isCurrentZaloLoginFlow(flowGeneration, loginFlowGenerationRef.current, controller.signal)) return;
    if (cancelRequestAbortRef.current === controller) cancelRequestAbortRef.current = null;
    if (reconciliation.kind === "stale") return;
    if (reconciliation.kind === "blocked") {
      endLoginFlow("blocked", reconciliation.message);
      return;
    }
    if (reconciliation.kind === "unavailable") {
      endLoginFlow("error", reconciliation.message);
      return;
    }
    applyKnownStatus(reconciliation.status);
  }, [abortStatusRequest, applyKnownStatus, clearQr, endLoginFlow, invalidateLoginFlow, stopPolling]);

  const returnToIdle = useCallback(() => {
    invalidateLoginFlow();
    stopPolling();
    abortStatusRequest();
    clearQr();
    setPhase("idle");
    setErrMsg(null);
  }, [abortStatusRequest, clearQr, invalidateLoginFlow, stopPolling]);

  // ── Styles ───────────────────────────────────────────────────────
  const btnPrimary = "px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const btnSecondary = "px-3 py-1.5 border border-slate-700 text-slate-300 hover:bg-slate-700 text-xs rounded-md transition-colors";
  const btnDanger = "px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white text-xs rounded-md transition-colors";
  const actions = getZaloLoginUiActions(phase);
  const panelA11y = getZaloLoginPanelA11y(phase);

  if (phase === "checking") {
    return (
      <div
        aria-label="Checking Zalo login status"
        role={panelA11y.role}
        aria-live={panelA11y.live}
        aria-busy={panelA11y.busy}
        className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-3"
      >
        <p className="text-sm font-semibold text-slate-200">Zalo Login</p>
        <p className="text-xs text-slate-500">Đang kiểm tra trạng thái an toàn trước khi mở thao tác QR…</p>
      </div>
    );
  }

  if (phase === "cancelling") {
    return (
      <div
        aria-label="Cancelling Zalo login"
        role={panelA11y.role}
        aria-live={panelA11y.live}
        aria-busy={panelA11y.busy}
        className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-3"
      >
        <p className="text-sm font-semibold text-slate-200">Đang hủy generation QR…</p>
        <p className="text-xs text-slate-500">
          Đang đối chiếu trạng thái thật từ backend; thao tác QR tạm khóa.
        </p>
      </div>
    );
  }

  // ── Connected ────────────────────────────────────────────────────
  if (phase === "connected" && status?.connected) {
    return (
      <div className="rounded-lg border border-green-800 bg-green-950/20 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span>✅</span>
          <p className="text-sm font-semibold text-green-400">Zalo đã kết nối thành công</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-slate-500 uppercase tracking-wider text-[10px]">Bot UID</span>
            <p className="text-blue-400 font-mono mt-0.5">{status.selfUserId ?? "—"}</p>
          </div>
          <div>
            <span className="text-slate-500 uppercase tracking-wider text-[10px]">Display Name</span>
            <p className="text-slate-300 mt-0.5">{status.selfDisplayName ?? "—"}</p>
          </div>
          <div>
            <span className="text-slate-500 uppercase tracking-wider text-[10px]">Listener</span>
            <div className="mt-0.5">
              {status.listenerActive
                ? <Badge color="green">● Active</Badge>
                : <Badge color="red">○ Stopped</Badge>}
            </div>
          </div>
          <div>
            <span className="text-slate-500 uppercase tracking-wider text-[10px]">Session</span>
            <div className="mt-0.5"><Badge color="green">💾 Persisted</Badge></div>
          </div>
        </div>
        <div className="rounded-md border border-blue-800/50 bg-blue-950/20 px-3 py-2 text-xs text-blue-400">
          🔄 <strong>Auto reconnect enabled</strong> — PM2 restart tự restore, không cần QR lại.
        </div>
      </div>
    );
  }

  // ── Pending: QR đang hiển thị ────────────────────────────────────
  if (phase === "pending" || phase === "starting") {
    return (
      <div
        role={panelA11y.role}
        aria-live={panelA11y.live}
        aria-busy={panelA11y.busy}
        className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-4"
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-200">📱 Scan QR để đăng nhập Zalo</p>
          <Badge color="yellow">⏳ Đang chờ quét</Badge>
        </div>

        {/* QR Image */}
        <div className="flex flex-col items-center gap-3">
          {qrDataURL ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataURL}
                alt="Zalo QR Code — mở app Zalo và quét"
                className="w-60 h-60 rounded-xl border-4 border-white shadow-2xl"
              />
              {qrUpdatedAt && (
                <p className="text-[10px] text-slate-600">
                  QR tạo lúc {new Date(qrUpdatedAt).toLocaleTimeString("vi-VN")}
                </p>
              )}
            </>
          ) : (
            <div className="w-60 h-60 rounded-xl border border-slate-700 bg-slate-900 flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-slate-500">
                {phase === "starting" ? "Đang tạo QR…" : "Đang tải QR…"}
              </p>
            </div>
          )}

          <p className="text-xs text-slate-500 text-center max-w-[240px]">
            Mở <strong className="text-slate-300">app Zalo</strong> →{" "}
            biểu tượng QR → quét mã này để đăng nhập.
            <br />
            <span className="text-slate-600">Tự động cập nhật mỗi 2 giây.</span>
          </p>
        </div>

        <div className="flex gap-2 justify-center">
          {actions.includes("replace") && (
            <button onClick={doRefresh} className={btnSecondary}>🔄 Tạo QR mới</button>
          )}
          {actions.includes("cancel") && (
            <button onClick={doCancel} className={btnDanger}>✕ Hủy</button>
          )}
        </div>
      </div>
    );
  }

  // ── Expired ──────────────────────────────────────────────────────
  if (phase === "expired") {
    return (
      <div
        role={panelA11y.role}
        aria-live={panelA11y.live}
        aria-busy={panelA11y.busy}
        className="rounded-lg border border-yellow-800 bg-yellow-950/20 p-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <span>⏱️</span>
          <p className="text-sm font-semibold text-yellow-400">QR đã hết hạn</p>
        </div>
        <p className="text-xs text-slate-500">
          QR hết hiệu lực trước khi quét. Tạo mới để thử lại.
        </p>
        <div className="flex gap-2">
          <button onClick={doStart} className={btnPrimary}>
            🔄 Tạo QR mới
          </button>
          {actions.includes("return_idle") && (
            <button onClick={returnToIdle} className={btnSecondary}>Hủy</button>
          )}
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────
  if (phase === "blocked") {
    return (
      <div
        role={panelA11y.role}
        aria-live={panelA11y.live}
        aria-busy={panelA11y.busy}
        className="rounded-lg border border-red-800 bg-red-950/20 p-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <span>⚠️</span>
          <p className="text-sm font-semibold text-red-400">Đăng nhập bị chặn an toàn</p>
        </div>
        <p className="text-xs text-slate-400">
          Chính sách an toàn hiện không cho phép tạo hoặc quét QR.
        </p>
        {errMsg && (
          <p className="text-xs text-red-400 font-mono bg-red-950/30 rounded px-2 py-1">
            {errMsg}
          </p>
        )}
        <div className="flex gap-2">
          {actions.includes("return_idle") && (
            <button onClick={returnToIdle} className={btnSecondary}>Quay lại</button>
          )}
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div
        role={panelA11y.role}
        aria-live={panelA11y.live}
        aria-busy={panelA11y.busy}
        className="rounded-lg border border-red-800 bg-red-950/20 p-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <span>❌</span>
          <p className="text-sm font-semibold text-red-400">Trạng thái QR không khả dụng</p>
        </div>
        {errMsg && (
          <p className="text-xs text-red-400 font-mono bg-red-950/30 rounded px-2 py-1">
            {errMsg}
          </p>
        )}
        <div className="flex gap-2">
          {actions.includes("check_status") && (
            <button onClick={checkCurrentStatus} className={btnSecondary}>Kiểm tra lại trạng thái</button>
          )}
        </div>
      </div>
    );
  }

  // ── Idle: disconnected ───────────────────────────────────────────
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-200">Zalo Login</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Tạo QR và quét bằng app Zalo để kết nối bot.
          </p>
        </div>
        <Badge color="red">○ Chưa kết nối</Badge>
      </div>

      {status?.lastError && (
        <div className="rounded-md border border-red-800/40 bg-red-950/20 px-3 py-2 text-xs text-red-400">
          ⚠ {status.lastError}
        </div>
      )}

      {status && !status.connected && !backupAvailable && (
        <div className="rounded-md border border-yellow-800/40 bg-yellow-950/10 px-3 py-2 text-xs text-yellow-500">
          ⚠ Session chưa có hoặc đã hết hạn. Quét QR để kết nối lại.
        </div>
      )}

      {backupAvailable && (
        <div className="rounded-md border border-cyan-800/50 bg-cyan-950/20 px-3 py-2 text-xs text-cyan-400">
          ⟲ <strong>Có backup session khả dụng.</strong> Reconnect vẫn ở chế độ status-only; chỉ tạo QR mới khi cần một generation đăng nhập có kiểm soát.
        </div>
      )}

      {actions.includes("start") && (
        <button
          onClick={doStart}
          className={`${btnPrimary} w-full flex items-center justify-center gap-2`}
        >
          <span>📱</span>
          <span>Tạo QR đăng nhập Zalo</span>
        </button>
      )}
    </div>
  );
}
