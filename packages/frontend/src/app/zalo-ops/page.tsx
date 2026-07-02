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
import { ZaloLoginCard } from "../../components/zalo-login-card";
import { formatVnTime } from "../../components/ui/TimeText";

type ActionStatus =
  | { type: "idle" }
  | { type: "loading"; message: string }
  | { type: "ok"; message: string }
  | { type: "err"; message: string };

/* ── Helpers ──────────────────────────────────────────────────── */
function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-700 bg-slate-800/60 p-4 ${className}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">{title}</p>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-slate-600 uppercase tracking-wider">{label}</span>
      <span className="text-sm text-slate-300">{value}</span>
    </div>
  );
}

function Hb({ label, status, ageSeconds }: { label: string; status: string; ageSeconds: number | null }) {
  const colors = {
    ok: "border-green-800/60 bg-green-950/30",
    stale: "border-yellow-800/60 bg-yellow-950/30",
    down: "border-red-800/60 bg-red-950/30",
  };
  const dots = { ok: "bg-green-500", stale: "bg-yellow-500", down: "bg-red-500" };
  const textMap = { ok: "text-green-400", stale: "text-yellow-400", down: "text-red-400" };
  const k = (status as keyof typeof colors) in colors ? (status as keyof typeof colors) : "down";
  return (
    <div className={`flex items-center justify-between rounded-md border px-3 py-2.5 ${colors[k]}`}>
      <span className="text-xs text-slate-400">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${dots[k]} ${k === "ok" ? "animate-pulse" : ""}`} />
        <span className={`text-xs font-semibold ${textMap[k]}`}>
          {k.toUpperCase()}{ageSeconds != null ? <span className="text-slate-600 font-normal ml-1">({ageSeconds}s)</span> : ""}
        </span>
      </span>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────── */
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
    try { setStatus(await getZaloOpsStatus()); } catch { /* ignore */ }
  }, []);

  const fetchEvents = useCallback(async () => {
    try { setEvents(await getRecentEvents()); } catch { /* ignore */ }
  }, []);

  const fetchAll = useCallback(() => {
    Promise.all([fetchStatus(), fetchEvents()]).finally(() => setLoading(false));
  }, [fetchStatus, fetchEvents]);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 10_000);
    return () => clearInterval(t);
  }, [fetchAll]);

  const doReconnect = async () => {
    setAction({ type: "loading", message: "Đang kết nối lại Zalo…" });
    try {
      const r = await reconnectZalo();
      setAction(r.success ? { type: "ok", message: r.message } : { type: "err", message: r.message });
      fetchStatus();
    } catch (e: unknown) {
      setAction({ type: "err", message: e instanceof Error ? e.message : "Reconnect failed" });
    }
  };

  const doDisconnect = async () => {
    if (!confirm("⚠️ Ngắt kết nối Zalo? Listener sẽ dừng. OK?")) return;
    setAction({ type: "loading", message: "Đang ngắt kết nối…" });
    try {
      const r = await disconnectZalo();
      setAction(r.success ? { type: "ok", message: "Đã ngắt kết nối" } : { type: "err", message: r.status });
      fetchStatus();
    } catch (e: unknown) {
      setAction({ type: "err", message: e instanceof Error ? e.message : "Disconnect failed" });
    }
  };

  const doCheckQR = async () => {
    setAction({ type: "loading", message: "Đang kiểm tra QR…" });
    try {
      const q = await getZaloQRStatus();
      setQr(q);
      setAction({ type: "ok", message: q.status });
    } catch (e: unknown) {
      setAction({ type: "err", message: e instanceof Error ? e.message : "QR check failed" });
    }
  };

  const doTestDM = async () => {
    if (!testThreadId.trim()) { setTestResult({ allowed: false, reason: "Missing threadId" }); return; }
    setAction({ type: "loading", message: "Đang test DM…" });
    try {
      const r = await testDM(testThreadId.trim(), testContent || undefined);
      setTestResult(r);
      setAction(r.allowed ? { type: "ok", message: `Cho phép — taskId: ${r.agentTaskId ?? "—"}` } : { type: "err", message: r.reason ?? "Blocked" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Test DM failed";
      setTestResult({ allowed: false, reason: msg });
      setAction({ type: "err", message: msg });
    }
  };

  if (loading && !status) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-slate-100">Zalo Operations</h1>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-slate-800 border border-slate-700" />
          ))}
        </div>
      </div>
    );
  }

  const inp = "flex-1 min-w-[160px] rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none";
  const btnPrimary = "px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md transition-colors";
  const btnDanger = "px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs font-medium rounded-md transition-colors";
  const btnSecondary = "px-3 py-1.5 border border-slate-700 text-slate-300 hover:bg-slate-700 text-xs rounded-md transition-colors";

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Zalo Operations</h1>
          <p className="text-xs text-slate-500 mt-0.5">Connection status, session, heartbeats, test DM.</p>
        </div>
        <button onClick={fetchAll} className={btnSecondary}>🔄 Refresh</button>
      </div>

      {/* Action feedback */}
      {action.type !== "idle" && (
        <div className={`rounded-md border px-4 py-2.5 text-sm flex items-center justify-between ${
          action.type === "loading" ? "border-blue-800 bg-blue-950/40 text-blue-400" :
          action.type === "ok" ? "border-green-800 bg-green-950/40 text-green-400" :
          "border-red-800 bg-red-950/40 text-red-400"
        }`}>
          <span>{action.message}</span>
          {action.type !== "loading" && (
            <button onClick={() => setAction({ type: "idle" })} className="text-slate-600 hover:text-slate-400 ml-3">×</button>
          )}
        </div>
      )}

      {/* QR warning */}
      {status?.session.qrAvailable && (
        <div className="rounded-md border border-yellow-800 bg-yellow-950/40 px-4 py-3 text-sm text-yellow-400 flex items-center gap-2">
          <span className="text-lg">⚠</span>
          <div>
            <strong>QR Login required</strong> — session đã hết hạn hoặc cần đăng nhập lại.
            <button onClick={doCheckQR} className="ml-3 underline text-yellow-300 text-xs hover:text-yellow-100">Kiểm tra QR →</button>
          </div>
        </div>
      )}

      {/* Zalo Login Card — shown when disconnected */}
      {!status?.connected && (
        <ZaloLoginCard onConnected={fetchAll} />
      )}

      {/* Connection */}
      <Card title="Connection">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
          <Stat label="Status" value={
            <span className={status?.connected ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>
              {status?.connected ? "● Connected" : "○ Disconnected"}
            </span>
          } />
          <Stat label="Listener" value={
            status?.listenerActive
              ? <span className="text-green-400">● Active</span>
              : <span className="text-red-400">○ Stopped</span>
          } />
          <Stat label="Dry Run" value={
            status?.dryRun
              ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border bg-amber-950 text-amber-400 border-amber-800">🛡 ON</span>
              : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border bg-red-950 text-red-400 border-red-800">⚡ OFF</span>
          } />
          <Stat label="Connection Detail" value={<span className="text-slate-400 text-xs">{status?.connectionStatus ?? "—"}</span>} />
          <Stat label="Bot UID" value={<code className="font-mono text-[11px] text-blue-400">{status?.selfUserId ?? "—"}</code>} />
          <Stat label="Bot Name" value={status?.selfDisplayName ?? "—"} />
          <Stat label="Connected At" value={status?.lastConnectedAt ? formatVnTime(status.lastConnectedAt) : "—"} />
          <Stat label="Last Message" value={status?.lastMessageAt ? formatVnTime(status.lastMessageAt) : "—"} />
          <Stat label="Inbound 24h" value={<span className="text-blue-400 font-semibold">{status?.inbound24h ?? "—"}</span>} />
          <Stat label="Outbound 24h" value={<span className="text-green-400 font-semibold">{status?.outbound24h ?? "—"}</span>} />
          <Stat label="Cooldown" value={`${status?.cooldownSeconds ?? "?"}s`} />
          {status?.lastError && <Stat label="Last Error" value={<span className="text-red-400 text-xs truncate">{status.lastError}</span>} />}
        </div>
      </Card>

      {/* Session */}
      <Card title="Session">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <Stat label="File" value={
            status?.session.exists
              ? <span className="text-green-400">● Present</span>
              : <span className="text-red-400">○ Missing</span>
          } />
          <Stat label="Age" value={status?.session.age ?? "—"} />
          <Stat label="QR Available" value={status?.session.qrAvailable ? <span className="text-yellow-400">⚠ Yes</span> : "No"} />
        </div>
        {status?.session.warning && (
          <div className="rounded-md border border-yellow-800 bg-yellow-950/30 px-3 py-2 text-xs text-yellow-400 mb-3">
            ⚠ {status.session.warning}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={doReconnect} className={btnPrimary}>🔄 Reconnect</button>
          <button onClick={doDisconnect} className={btnDanger}>○ Disconnect</button>
          <button onClick={doCheckQR} className={btnSecondary}>📱 Check QR</button>
        </div>
        {qr && (
          <div className="mt-3 rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-400">
            QR: <strong className="text-slate-300">{qr.status}</strong> — {qr.message}
          </div>
        )}
      </Card>

      {/* Heartbeats */}
      <Card title="Heartbeats">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {status ? (
            <>
              <Hb label="Zalo Connection" status={status.heartbeats.zaloConnection.status} ageSeconds={status.heartbeats.zaloConnection.ageSeconds} />
              <Hb label="Zalo Listener" status={status.heartbeats.zaloListener.status} ageSeconds={status.heartbeats.zaloListener.ageSeconds} />
              <Hb label="Message Pipeline" status={status.heartbeats.messagePipeline.status} ageSeconds={status.heartbeats.messagePipeline.ageSeconds} />
            </>
          ) : (
            <p className="text-slate-600 text-xs col-span-3">Loading…</p>
          )}
        </div>
      </Card>

      {/* Allowed Threads */}
      <Card title="Allowed Threads">
        {status?.allowedThreads && status.allowedThreads.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {status.allowedThreads.map((t) => (
              <code key={t} className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-[11px] font-mono text-blue-400">{t}</code>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-600">Chưa cấu hình thread nào.</p>
        )}
      </Card>

      {/* Test DM */}
      <Card title="Test DM (dry-run only)">
        <div className="flex flex-wrap gap-2 mb-3">
          <input type="text" placeholder="Thread ID" value={testThreadId} onChange={(e) => setTestThreadId(e.target.value)} className={inp} />
          <input type="text" placeholder="Content (optional)" value={testContent} onChange={(e) => setTestContent(e.target.value)} className={inp} />
          <button onClick={doTestDM} className="px-4 py-1.5 bg-violet-700 hover:bg-violet-600 text-white text-xs font-medium rounded-md transition-colors">🧪 Test</button>
        </div>
        {testResult && (
          <div className={`rounded-md border px-3 py-2 text-xs ${testResult.allowed ? "border-green-800 bg-green-950/30 text-green-400" : "border-red-800 bg-red-950/30 text-red-400"}`}>
            {testResult.allowed ? `✅ Allowed — taskId: ${testResult.agentTaskId ?? "—"}` : `🚫 ${testResult.reason}`}
          </div>
        )}
      </Card>

      {/* Recent Events */}
      <Card title="Recent Events">
        <div className="space-y-4">
          {/* Inbound */}
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">Inbound ({events?.inbound.length ?? 0})</p>
            <div className="max-h-44 overflow-y-auto space-y-1">
              {events?.inbound.map((ev, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md bg-slate-900 border border-slate-700/50 px-2.5 py-1.5 text-xs">
                  <span className="text-slate-600 shrink-0 font-mono">{formatVnTime(ev.timestamp, { showDate: false, showUtcLabel: false })}</span>
                  <span className="text-slate-600 shrink-0 font-mono">[…{ev.threadId?.slice(-6)}]</span>
                  <span className="text-slate-400 truncate">{ev.senderName}: {ev.content}</span>
                </div>
              ))}
              {(!events || events.inbound.length === 0) && <p className="text-xs text-slate-600 px-1">Không có tin đến gần đây</p>}
            </div>
          </div>
          {/* Outbound */}
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">Outbound ({events?.outbound.length ?? 0})</p>
            <div className="max-h-44 overflow-y-auto space-y-1">
              {events?.outbound.map((ev, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md bg-slate-900 border border-slate-700/50 px-2.5 py-1.5 text-xs">
                  <span className="text-slate-600 shrink-0 font-mono">{formatVnTime(ev.timestamp, { showDate: false, showUtcLabel: false })}</span>
                  <span className="text-slate-600 shrink-0 font-mono">[…{ev.threadId?.slice(-6)}]</span>
                  <span className="text-slate-400 truncate">{ev.detail}</span>
                  {ev.errorCode && <span className="text-red-400 shrink-0 font-medium">{ev.errorCode}</span>}
                </div>
              ))}
              {(!events || events.outbound.length === 0) && <p className="text-xs text-slate-600 px-1">Không có outbound gần đây</p>}
            </div>
          </div>
          {/* Errors */}
          <div>
            <p className="text-[10px] text-red-700 uppercase tracking-widest font-semibold mb-2">Errors ({events?.errors.length ?? 0})</p>
            <div className="max-h-36 overflow-y-auto space-y-1">
              {events?.errors.map((ev, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md bg-red-950/20 border border-red-800/40 px-2.5 py-1.5 text-xs">
                  <span className="text-red-600 shrink-0 font-mono">{formatVnTime(ev.timestamp, { showDate: false, showUtcLabel: false })}</span>
                  <span className="text-red-400 truncate">{ev.detail}</span>
                </div>
              ))}
              {(!events || events.errors.length === 0) && <p className="text-xs text-slate-600 px-1">✨ No recent errors</p>}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
