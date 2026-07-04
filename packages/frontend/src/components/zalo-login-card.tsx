"use client";

/**
 * ZaloLoginCard — Web QR Login (ZALO-WEB-LOGIN)
 *
 * Admin đã đăng nhập web → bấm "Tạo QR đăng nhập Zalo" → QR hiện ngay.
 * Không cần nhập username/password — browser tự inject Basic auth đã lưu.
 * Nếu chưa auth thì browser tự hiện WWW-Authenticate dialog (behavior chuẩn).
 *
 * Phases:
 *   idle      → disconnected, nút "Tạo QR"
 *   pending   → QR hiển thị, polling 2s
 *   connected → scan thành công
 *   expired   → QR hết hạn, cho tạo lại
 *   error     → lỗi, cho thử lại
 */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  startZaloLogin,
  getZaloLoginStatus,
  getZaloLoginQR,
  cancelZaloLogin,
  type LoginStatusOutput,
} from "../lib/api-client";

type LoginPhase = "idle" | "starting" | "pending" | "connected" | "expired" | "error";

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
  const [phase, setPhase] = useState<LoginPhase>("idle");
  const [status, setStatus] = useState<LoginStatusOutput | null>(null);
  const [qrDataURL, setQrDataURL] = useState<string | null>(null);
  const [qrUpdatedAt, setQrUpdatedAt] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  // ── Fetch QR image ───────────────────────────────────────────────
  const loadQR = useCallback(async () => {
    try {
      const r = await getZaloLoginQR();
      setQrDataURL(r.qrDataURL);
      setQrUpdatedAt(r.updatedAt);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("QR_EXPIRED")) {
        setPhase("expired");
        setQrDataURL(null);
        stopPolling();
      }
      // QR_NOT_FOUND: QR đang sinh, sẽ retry qua poll
    }
  }, []);

  // ── Poll status every 2s ─────────────────────────────────────────
  const pollStatus = useCallback(async () => {
    try {
      const s = await getZaloLoginStatus();
      setStatus(s);
      if (s.connected) {
        setPhase("connected");
        setQrDataURL(null);
        stopPolling();
        onConnected?.();
        return;
      }
      // Refresh QR if still pending
      if (!s.qrAvailable && phase === "pending") {
        setPhase("expired");
        setQrDataURL(null);
        stopPolling();
        return;
      }
      if (s.qrAvailable) {
        await loadQR();
      }
    } catch { /* retry next tick */ }
  }, [phase, loadQR, onConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(pollStatus, POLL_MS);
  }, [pollStatus]);

  // ── Mount: check current status ──────────────────────────────────
  useEffect(() => {
    getZaloLoginStatus()
      .then((s) => {
        setStatus(s);
        if (s.connected) {
          setPhase("connected");
        } else if (s.qrAvailable && s.connectionStatus === "waiting_qr_scan") {
          // QR already available (e.g. page reload mid-login) — jump straight to pending + fetch
          setPhase("pending");
          void loadQR();
          pollRef.current = setInterval(pollStatus, POLL_MS);
        }
      })
      .catch(() => {});
    return () => stopPolling();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tạo QR ──────────────────────────────────────────────────────
  const doStart = useCallback(async () => {
    setPhase("starting");
    setErrMsg(null);
    setQrDataURL(null);
    try {
      let r = await startZaloLogin();
      // If a previous login is still pending, cancel it first then retry
      if (r.data.status === "already_in_progress") {
        await cancelZaloLogin().catch(() => {});
        await new Promise((res) => setTimeout(res, 500));
        r = await startZaloLogin();
      }
      if (r.data.status === "already_connected" || r.data.status === "connected") {
        const s = await getZaloLoginStatus();
        setStatus(s);
        setPhase("connected");
        return;
      }
      setPhase("pending");
      startPolling();
      // QR may take a few seconds to generate — try now; poll will retry if not ready
      await loadQR();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Không thể tạo QR — kiểm tra kết nối backend.";
      setErrMsg(msg);
      setPhase("error");
    }
  }, [startPolling, loadQR]);

  // ── Tạo QR mới (refresh) ─────────────────────────────────────────
  const doRefresh = useCallback(async () => {
    stopPolling();
    await doStart();
  }, [doStart]);

  // ── Hủy ─────────────────────────────────────────────────────────
  const doCancel = useCallback(async () => {
    stopPolling();
    try { await cancelZaloLogin(); } catch { /* non-critical */ }
    setPhase("idle");
    setQrDataURL(null);
    setErrMsg(null);
  }, []);

  // ── Styles ───────────────────────────────────────────────────────
  const btnPrimary = "px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const btnSecondary = "px-3 py-1.5 border border-slate-700 text-slate-300 hover:bg-slate-700 text-xs rounded-md transition-colors";
  const btnDanger = "px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white text-xs rounded-md transition-colors";

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
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-4">
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
          <button onClick={doRefresh} className={btnSecondary} disabled={phase === "starting"}>
            🔄 Tạo QR mới
          </button>
          <button onClick={doCancel} className={btnDanger}>
            ✕ Hủy
          </button>
        </div>
      </div>
    );
  }

  // ── Expired ──────────────────────────────────────────────────────
  if (phase === "expired") {
    return (
      <div className="rounded-lg border border-yellow-800 bg-yellow-950/20 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span>⏱️</span>
          <p className="text-sm font-semibold text-yellow-400">QR đã hết hạn</p>
        </div>
        <p className="text-xs text-slate-500">
          QR hết hiệu lực trước khi quét. Tạo mới để thử lại.
        </p>
        <div className="flex gap-2">
          <button onClick={doRefresh} className={btnPrimary}>
            🔄 Tạo QR mới
          </button>
          <button onClick={() => setPhase("idle")} className={btnSecondary}>Hủy</button>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <div className="rounded-lg border border-red-800 bg-red-950/20 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span>❌</span>
          <p className="text-sm font-semibold text-red-400">Lỗi tạo QR</p>
        </div>
        {errMsg && (
          <p className="text-xs text-red-400 font-mono bg-red-950/30 rounded px-2 py-1">
            {errMsg}
          </p>
        )}
        <div className="flex gap-2">
          <button onClick={doStart} className={btnPrimary}>Thử lại</button>
          <button onClick={() => { setPhase("idle"); setErrMsg(null); }} className={btnSecondary}>
            Hủy
          </button>
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
          ⟲ <strong>Có backup session khả dụng.</strong> Bấm <strong>Reconnect</strong> ở mục Session để khôi phục mà không cần quét QR. Chỉ tạo QR mới nếu backup lỗi.
        </div>
      )}

      <button
        onClick={doStart}
        className={`${btnPrimary} w-full flex items-center justify-center gap-2`}
      >
        <span>📱</span>
        <span>Tạo QR đăng nhập Zalo</span>
      </button>
    </div>
  );
}
