"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getZaloOpsStatus,
  reconnectZalo,
  disconnectZalo,
  getZaloQRStatus,
  testDM,
  getRecentEvents,
  type ZaloOpsStatus,
  type QRStatusOutput,
  type TestDMResult,
  type RecentEventsResponse,
} from "../../lib/api-client";
import { formatVnTime } from "../../components/ui/TimeText";

type ActionStatus =
  | { type: "idle" }
  | { type: "loading"; message: string }
  | { type: "ok"; message: string }
  | { type: "err"; message: string };

export default function ZaloOpsPage() {
  const [status, setStatus] = useState<ZaloOpsStatus | null>(null);
  const [events, setEvents] = useState<RecentEventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<ActionStatus>({ type: "idle" });
  const [qr, setQr] = useState<QRStatusOutput | null>(null);
  const [testThreadId, setTestThreadId] = useState("");
  const [testContent, setTestContent] = useState("");
  const [testResult, setTestResult] = useState<TestDMResult | null>(null);

  const fetchStatus = useCallback(async () => {
    try { const s = await getZaloOpsStatus(); setStatus(s); } catch { /* ignore */ }
  }, []);

  const fetchEvents = useCallback(async () => {
    try { const e = await getRecentEvents(); setEvents(e); } catch { /* ignore */ }
  }, []);

  const fetchAll = useCallback(() => {
    Promise.all([fetchStatus(), fetchEvents()]).finally(() => setLoading(false));
  }, [fetchStatus, fetchEvents]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const doReconnect = async () => {
    setAction({ type: "loading", message: "Đang kết nối lại Zalo..." });
    try {
      const r = await reconnectZalo();
      setAction(r.success ? { type: "ok", message: `✅ ${r.message}` } : { type: "err", message: `❌ ${r.message}` });
      fetchStatus();
    } catch (e: any) {
      setAction({ type: "err", message: e?.message ?? "Reconnect failed" });
    }
  };

  const doDisconnect = async () => {
    if (!confirm("⚠️ Ngắt kết nối Zalo? Listener sẽ dừng. OK?")) return;
    setAction({ type: "loading", message: "Đang ngắt kết nối..." });
    try {
      const r = await disconnectZalo();
      setAction(r.success ? { type: "ok", message: "✅ Đã ngắt kết nối" } : { type: "err", message: `❌ ${r.status}` });
      fetchStatus();
    } catch (e: any) {
      setAction({ type: "err", message: e?.message ?? "Disconnect failed" });
    }
  };

  const doCheckQR = async () => {
    setAction({ type: "loading", message: "Đang kiểm tra QR..." });
    try {
      const q = await getZaloQRStatus();
      setQr(q);
      setAction({ type: "ok", message: q.status });
    } catch (e: any) {
      setAction({ type: "err", message: e?.message ?? "QR check failed" });
    }
  };

  const doTestDM = async () => {
    if (!testThreadId.trim()) { setTestResult({ allowed: false, reason: "Missing threadId" }); return; }
    setAction({ type: "loading", message: "Đang test DM..." });
    try {
      const r = await testDM(testThreadId.trim(), testContent || undefined);
      setTestResult(r);
      setAction(r.allowed ? { type: "ok", message: `✅ Test DM allowed` } : { type: "err", message: `🚫 ${r.reason}` });
    } catch (e: any) {
      setTestResult({ allowed: false, reason: e?.message ?? "Test DM failed" });
      setAction({ type: "err", message: e?.message ?? "Test DM failed" });
    }
  };

  if (loading && !status) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-slate-800">📡 Zalo Operations</h1>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-slate-100 border border-slate-200" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Zalo Operations</h1>
          <p className="text-xs text-slate-500 mt-0.5">Trạng thái kết nối Zalo, session, heartbeat, test DM.</p>
        </div>
        <button onClick={fetchAll} className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200 transition-colors">
          🔄 Làm mới
        </button>
      </div>

      {/* Action feedback */}
      {action.type !== "idle" && (
        <div className={`rounded-lg border p-3 text-sm ${
          action.type === "loading" ? "border-blue-200 bg-blue-50 text-blue-700" :
          action.type === "ok" ? "border-green-200 bg-green-50 text-green-700" :
          "border-red-200 bg-red-50 text-red-700"
        }`}>
          {action.message}
          {action.type !== "loading" && (
            <button onClick={() => setAction({ type: "idle" })} className="ml-3 text-xs opacity-60 hover:opacity-100">✕</button>
          )}
        </div>
      )}

      {/* Connection Card */}
      <Card title="🔌 Kết nối">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <Stat label="Trạng thái" value={
            <span className={`font-semibold ${status?.connected ? "text-success" : "text-danger"}`}>
              {status?.connected ? "✅ Đã kết nối" : "❌ Mất kết nối"}
            </span>
          } />
          <Stat label="Kết nối" value={status?.connectionStatus ?? "—"} />
          <Stat label="Listener" value={
            status?.listenerActive
              ? <span className="text-success font-medium">✅ Đang chạy</span>
              : <span className="text-danger font-medium">❌ Đã dừng</span>
          } />
          <Stat label="Dry Run" value={
            status?.dryRun
              ? <Badge color="warning">⚠️ DRY RUN</Badge>
              : <Badge color="danger">🔴 LIVE</Badge>
          } />
          <Stat label="Bot UID" value={<code className="text-xs font-mono text-slate-600">{status?.selfUserId ?? "—"}</code>} />
          <Stat label="Tên Bot" value={status?.selfDisplayName ?? "—"} />
          <Stat label="Kết nối lúc" value={status?.lastConnectedAt ? formatVnTime(status.lastConnectedAt) : "—"} />
          <Stat label="Tin cuối" value={status?.lastMessageAt ? formatVnTime(status.lastMessageAt) : "—"} />
          <Stat label="Cooldown" value={`${status?.cooldownSeconds ?? "?"}s`} />
          <Stat label="Lỗi cuối" value={status?.lastError ? <span className="text-danger text-xs">{status.lastError}</span> : "Không"} />
          <Stat label="Inbound 24h" value={String(status?.inbound24h ?? "—")} />
          <Stat label="Outbound 24h" value={String(status?.outbound24h ?? "—")} />
        </div>
      </Card>

      {/* Session Card */}
      <Card title="💾 Session">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="File Session" value={
            status?.session.exists
              ? <span className="text-success font-medium">✅ Tồn tại</span>
              : <span className="text-danger font-medium">❌ Thiếu</span>
          } />
          <Stat label="Tuổi" value={status?.session.age ?? "—"} />
          <Stat label="QR sẵn sàng" value={status?.session.qrAvailable ? "✅ Có" : "❌ Không"} />
        </div>
        {status?.session.warning && (
          <div className="mt-3 rounded-md border border-warning-light bg-warning-light/50 p-2.5 text-xs text-warning">
            ⚠️ {status.session.warning}
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <button onClick={doReconnect} className="px-3 py-1.5 text-xs font-medium bg-brand text-white hover:bg-brand-dark rounded-md transition-colors">
            🔄 Kết nối lại
          </button>
          <button onClick={doDisconnect} className="px-3 py-1.5 text-xs font-medium bg-danger text-white hover:bg-red-700 rounded-md transition-colors">
            🔌 Ngắt kết nối
          </button>
          <button onClick={doCheckQR} className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md transition-colors">
            📱 Kiểm tra QR
          </button>
        </div>
        {qr && (
          <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 p-2 text-xs text-slate-500">
            QR: {qr.status} — {qr.message}
          </div>
        )}
      </Card>

      {/* Heartbeats Card */}
      <Card title="💓 Heartbeats">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {status && (
            <>
              <HeartbeatStat label="Zalo Connection" hb={status.heartbeats.zaloConnection} />
              <HeartbeatStat label="Zalo Listener" hb={status.heartbeats.zaloListener} />
              <HeartbeatStat label="Message Pipeline" hb={status.heartbeats.messagePipeline} />
            </>
          )}
        </div>
      </Card>

      {/* Allowed Threads */}
      <Card title="🔒 Allowed Threads">
        {status?.allowedThreads && status.allowedThreads.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {status.allowedThreads.map((t) => (
              <code key={t} className="rounded-md bg-slate-50 border border-slate-200 px-2 py-1 text-[11px] font-mono text-slate-600">{t}</code>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Chưa cấu hình thread nào.</p>
        )}
      </Card>

      {/* Test DM */}
      <Card title="🧪 Test DM (Dry-Run)">
        <div className="flex flex-wrap gap-2">
          <input
            type="text" placeholder="Thread ID" value={testThreadId}
            onChange={(e) => setTestThreadId(e.target.value)}
            className="flex-1 min-w-[180px] rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          <input
            type="text" placeholder="Nội dung (tùy chọn)" value={testContent}
            onChange={(e) => setTestContent(e.target.value)}
            className="flex-1 min-w-[180px] rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          <button onClick={doTestDM} className="px-4 py-1.5 text-xs font-medium bg-violet-600 text-white hover:bg-violet-700 rounded-md transition-colors">
            🧪 Test
          </button>
        </div>
        {testResult && (
          <div className={`mt-3 rounded-md p-3 text-xs ${testResult.allowed ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {testResult.allowed ? `✅ Cho phép — agentTaskId: ${testResult.agentTaskId ?? "—"}` : `🚫 ${testResult.reason}`}
          </div>
        )}
      </Card>

      {/* Recent Events */}
      <Card title="📋 Sự kiện gần đây">
        <div className="space-y-4">
          {/* Inbound */}
          <div>
            <h4 className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">📨 Inbound ({events?.inbound.length ?? 0})</h4>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {events?.inbound.map((ev, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md bg-slate-50 border border-slate-100 p-2 text-xs">
                  <span className="text-slate-400 shrink-0 font-mono">{formatVnTime(ev.timestamp, { showDate: false })}</span>
                  <span className="text-slate-400 shrink-0 font-mono">[{ev.threadId?.slice(-8)}]</span>
                  <span className="text-slate-600 truncate">{ev.senderName}: {ev.content}</span>
                </div>
              ))}
              {(!events || events.inbound.length === 0) && <p className="text-xs text-slate-400 p-2">Không có tin nhắn đến gần đây</p>}
            </div>
          </div>
          {/* Outbound */}
          <div>
            <h4 className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">📤 Outbound ({events?.outbound.length ?? 0})</h4>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {events?.outbound.map((ev, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md bg-slate-50 border border-slate-100 p-2 text-xs">
                  <span className="text-slate-400 shrink-0 font-mono">{formatVnTime(ev.timestamp, { showDate: false })}</span>
                  <span className="text-slate-400 shrink-0 font-mono">[{ev.threadId?.slice(-8)}]</span>
                  <span className="text-slate-600 truncate">{ev.detail}</span>
                  {ev.errorCode && <span className="text-danger shrink-0 font-medium">{ev.errorCode}</span>}
                </div>
              ))}
              {(!events || events.outbound.length === 0) && <p className="text-xs text-slate-400 p-2">Không có outbound gần đây</p>}
            </div>
          </div>
          {/* Errors */}
          <div>
            <h4 className="text-xs font-semibold text-danger mb-2 uppercase tracking-wider">🚨 Lỗi ({events?.errors.length ?? 0})</h4>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {events?.errors.map((ev, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md bg-red-50 border border-red-100 p-2 text-xs">
                  <span className="text-red-500 shrink-0 font-mono">{formatVnTime(ev.timestamp, { showDate: false })}</span>
                  <span className="text-red-600 truncate">{ev.detail}</span>
                </div>
              ))}
              {(!events || events.errors.length === 0) && <p className="text-xs text-slate-400 p-2">✨ Không có lỗi gần đây</p>}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-card p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400 mb-0.5">{label}</p>
      <p className="text-sm text-slate-700">{value}</p>
    </div>
  );
}

function Badge({ color, children }: { color: "success" | "warning" | "danger" | "info"; children: React.ReactNode }) {
  const colors = {
    success: "bg-success-light text-success border-green-200",
    warning: "bg-warning-light text-warning border-yellow-200",
    danger: "bg-danger-light text-danger border-red-200",
    info: "bg-info-light text-info border-cyan-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border ${colors[color]}`}>
      {children}
    </span>
  );
}

function HeartbeatStat({ label, hb }: { label: string; hb: { status: string; lastBeatAt: string | null; ageSeconds: number | null } }) {
  const colors = {
    ok: "border-green-200 bg-green-50",
    stale: "border-yellow-200 bg-yellow-50",
    down: "border-red-200 bg-red-50",
  };
  const dots = { ok: "bg-success", stale: "bg-warning", down: "bg-danger" };
  const color = colors[hb.status as keyof typeof colors] ?? colors.down;
  const dot = dots[hb.status as keyof typeof dots] ?? dots.down;

  return (
    <div className={`flex items-center justify-between rounded-md border p-3 ${color}`}>
      <span className="text-xs text-slate-600 font-medium">{label}</span>
      <span className="inline-flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${dot} ${hb.status === "ok" ? "animate-pulse" : ""}`} />
        <span className="text-[11px] font-semibold text-slate-700">
          {hb.status === "ok" ? "OK" : hb.status === "stale" ? "Stale" : "Down"}
          {hb.ageSeconds != null && <span className="text-slate-400 font-normal ml-0.5">({hb.ageSeconds}s)</span>}
        </span>
      </span>
    </div>
  );
}
