"use client";

/**
 * ZaloLoginCard — Web QR Login (ZALO-WEB-LOGIN)
 *
 * Shows when Zalo is disconnected. Admin can:
 *   - Enter credentials (stored in sessionStorage, never sent to any log)
 *   - Start QR login → poll status every 2s
 *   - See QR image, refresh it, cancel it
 *   - See connected state with selfUserId / listenerActive / session persisted
 */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  startZaloLogin,
  getZaloLoginStatus,
  getZaloLoginQR,
  cancelZaloLogin,
  setAdminCredentials,
  hasAdminCredentials,
  type LoginStatusOutput,
} from "../lib/api-client";

type LoginPhase =
  | "idle"           // Not started
  | "creds"          // Asking for admin credentials
  | "pending"        // QR shown, waiting for scan
  | "connected"      // Scan succeeded
  | "expired"        // QR expired
  | "error";         // Error

const POLL_INTERVAL_MS = 2000;

// ── Helpers ─────────────────────────────────────────────────────────
function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  const map: Record<string, string> = {
    green: "border-green-800 bg-green-950/40 text-green-400",
    yellow: "border-yellow-800 bg-yellow-950/40 text-yellow-400",
    red: "border-red-800 bg-red-950/40 text-red-400",
    blue: "border-blue-800 bg-blue-950/40 text-blue-400",
    slate: "border-slate-700 bg-slate-800/60 text-slate-400",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${map[color] ?? map.slate}`}>
      {children}
    </span>
  );
}

// ── Main Component ───────────────────────────────────────────────────
export function ZaloLoginCard({ onConnected }: { onConnected?: () => void }) {
  const [phase, setPhase] = useState<LoginPhase>("idle");
  const [status, setStatus] = useState<LoginStatusOutput | null>(null);
  const [qrDataURL, setQrDataURL] = useState<string | null>(null);
  const [qrUpdatedAt, setQrUpdatedAt] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [starting, setStarting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Poll login status ─────────────────────────────────────────────
  const pollStatus = useCallback(async () => {
    try {
      const s = await getZaloLoginStatus();
      setStatus(s);

      if (s.connected) {
        setPhase("connected");
        stopPolling();
        onConnected?.();
        return;
      }

      if (!s.qrAvailable && phase === "pending") {
        // QR disappeared but not connected → expired
        setPhase("expired");
        setQrDataURL(null);
        stopPolling();
        return;
      }
    } catch {
      // Non-fatal — will retry
    }
  }, [phase, onConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(pollStatus, POLL_INTERVAL_MS);
  }, [pollStatus]);

  useEffect(() => {
    // On mount: check current status
    getZaloLoginStatus().then((s) => {
      setStatus(s);
      if (s.connected) setPhase("connected");
    }).catch(() => {});

    return () => stopPolling();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load QR image ─────────────────────────────────────────────────
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
      } else if (msg.includes("QR_NOT_FOUND")) {
        // Not ready yet, will retry via poll
      } else {
        setErrMsg(msg);
      }
    }
  }, []);

  // ── Start login ───────────────────────────────────────────────────
  const doStart = async () => {
    if (!username.trim() || !password.trim()) {
      setErrMsg("Nhập username và password admin.");
      return;
    }
    setAdminCredentials(username.trim(), password.trim());
    setStarting(true);
    setErrMsg(null);

    try {
      const r = await startZaloLogin();
      if (r.data.status === "already_connected") {
        const s = await getZaloLoginStatus();
        setStatus(s);
        setPhase("connected");
        setStarting(false);
        return;
      }
      setPhase("pending");
      startPolling();
      await loadQR();
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "Không thể tạo QR. Thử lại.");
      setPhase("error");
    } finally {
      setStarting(false);
    }
  };

  // ── Refresh QR ────────────────────────────────────────────────────
  const doRefreshQR = async () => {
    setRefreshing(true);
    stopPolling();
    setErrMsg(null);
    setPhase("idle");
    setQrDataURL(null);
    await doStart();
    setRefreshing(false);
  };

  // ── Cancel login ──────────────────────────────────────────────────
  const doCancel = async () => {
    stopPolling();
    try { await cancelZaloLogin(); } catch { /* ignore */ }
    setPhase("idle");
    setQrDataURL(null);
    setErrMsg(null);
  };

  // ── Styles ────────────────────────────────────────────────────────
  const btnPrimary = "px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const btnSecondary = "px-3 py-1.5 border border-slate-700 text-slate-300 hover:bg-slate-700 text-xs rounded-md transition-colors";
  const btnDanger = "px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white text-xs rounded-md transition-colors";
  const inp = "w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none";

  // ── Render: Connected ─────────────────────────────────────────────
  if (phase === "connected" && status?.connected) {
    return (
      <div className="rounded-lg border border-green-800 bg-green-950/20 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">✅</span>
          <p className="text-sm font-semibold text-green-400">Zalo đã kết nối thành công</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-slate-500 uppercase tracking-wider">Bot UID</span>
            <p className="text-blue-400 font-mono mt-0.5">{status.selfUserId ?? "—"}</p>
          </div>
          <div>
            <span className="text-slate-500 uppercase tracking-wider">Display Name</span>
            <p className="text-slate-300 mt-0.5">{status.selfDisplayName ?? "—"}</p>
          </div>
          <div>
            <span className="text-slate-500 uppercase tracking-wider">Listener</span>
            <div className="mt-0.5">
              {status.listenerActive
                ? <Badge color="green">● Active</Badge>
                : <Badge color="red">○ Stopped</Badge>}
            </div>
          </div>
          <div>
            <span className="text-slate-500 uppercase tracking-wider">Session</span>
            <div className="mt-0.5">
              <Badge color="green">💾 Persisted</Badge>
            </div>
          </div>
        </div>
        <div className="rounded-md border border-blue-800/50 bg-blue-950/20 px-3 py-2 text-xs text-blue-400">
          🔄 <strong>Auto reconnect enabled</strong> — PM2 restart sẽ tự restore session, không cần QR lại.
        </div>
      </div>
    );
  }

  // ── Render: Pending QR ────────────────────────────────────────────
  if (phase === "pending") {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-200">📱 Scan QR để đăng nhập Zalo</p>
          <Badge color="yellow">⏳ Waiting for scan</Badge>
        </div>

        {/* QR Image */}
        <div className="flex justify-center">
          {qrDataURL ? (
            <div className="space-y-2 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataURL}
                alt="Zalo QR Code"
                className="w-56 h-56 rounded-lg border-4 border-white shadow-xl"
              />
              {qrUpdatedAt && (
                <p className="text-[10px] text-slate-600">
                  Updated: {new Date(qrUpdatedAt).toLocaleTimeString("vi-VN")}
                </p>
              )}
            </div>
          ) : (
            <div className="w-56 h-56 rounded-lg border border-slate-700 bg-slate-900 flex items-center justify-center">
              <div className="text-center space-y-2">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-slate-500">Đang tải QR…</p>
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-500 text-center">
          Mở app Zalo → Quét mã QR để đăng nhập.
          <br />
          QR tự động cập nhật mỗi vài giây.
        </p>

        <div className="flex gap-2 justify-center">
          <button onClick={loadQR} disabled={refreshing} className={btnSecondary}>
            🔄 Refresh QR
          </button>
          <button onClick={doCancel} className={btnDanger}>
            ✕ Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Expired ───────────────────────────────────────────────
  if (phase === "expired") {
    return (
      <div className="rounded-lg border border-yellow-800 bg-yellow-950/20 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">⏱️</span>
          <p className="text-sm font-semibold text-yellow-400">QR đã hết hạn</p>
        </div>
        <p className="text-xs text-slate-500">QR code hết hiệu lực trước khi scan. Tạo mới để thử lại.</p>
        <div className="flex gap-2">
          <button onClick={doRefreshQR} disabled={refreshing} className={btnPrimary}>
            {refreshing ? "Đang tạo…" : "🔄 Tạo QR mới"}
          </button>
          <button onClick={() => setPhase("idle")} className={btnSecondary}>Hủy</button>
        </div>
      </div>
    );
  }

  // ── Render: Error ─────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <div className="rounded-lg border border-red-800 bg-red-950/20 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">❌</span>
          <p className="text-sm font-semibold text-red-400">Lỗi đăng nhập</p>
        </div>
        {errMsg && <p className="text-xs text-red-400 font-mono">{errMsg}</p>}
        <button onClick={() => { setPhase("idle"); setErrMsg(null); }} className={btnSecondary}>
          Thử lại
        </button>
      </div>
    );
  }

  // ── Render: Creds form ────────────────────────────────────────────
  if (phase === "creds") {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-4">
        <p className="text-sm font-semibold text-slate-200">🔐 Admin Authentication</p>
        <p className="text-xs text-slate-500">
          Nhập thông tin admin để tạo QR đăng nhập. Credentials chỉ lưu trong tab này, không log.
        </p>
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Admin username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className={inp}
          />
          <input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            onKeyDown={(e) => { if (e.key === "Enter") doStart(); }}
            className={inp}
          />
        </div>
        {errMsg && (
          <div className="rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-xs text-red-400">
            {errMsg}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={doStart} disabled={starting} className={btnPrimary}>
            {starting ? "Đang tạo QR…" : "📱 Tạo QR Login"}
          </button>
          <button onClick={() => setPhase("idle")} className={btnSecondary}>Hủy</button>
        </div>
      </div>
    );
  }

  // ── Render: Idle (disconnected) ───────────────────────────────────
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-200">Zalo Login</p>
          <p className="text-xs text-slate-500 mt-0.5">Đăng nhập Zalo bằng QR ngay trên web — không cần terminal.</p>
        </div>
        <Badge color="red">○ Disconnected</Badge>
      </div>

      {status?.lastError && (
        <div className="rounded-md border border-red-800/50 bg-red-950/20 px-3 py-2 text-xs text-red-400">
          ⚠ Last error: {status.lastError}
        </div>
      )}

      {/* Session missing warning */}
      {status && !status.connected && (
        <div className="rounded-md border border-yellow-800/40 bg-yellow-950/10 px-3 py-2 text-xs text-yellow-500">
          ⚠ Session chưa có hoặc đã hết hạn. Cần đăng nhập QR để kết nối lại.
        </div>
      )}

      <button
        onClick={() => {
          setErrMsg(null);
          setPhase(hasAdminCredentials() ? "creds" : "creds");
        }}
        className={`${btnPrimary} w-full flex items-center justify-center gap-2`}
      >
        <span>📱</span>
        <span>Login with QR</span>
      </button>
    </div>
  );
}
