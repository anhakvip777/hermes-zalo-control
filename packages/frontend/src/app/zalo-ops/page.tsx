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
  type ReconnectResult,
  type DisconnectResult,
  type QRStatusOutput,
  type TestDMResult,
  type RecentEventsResponse,
} from "../../lib/api-client";
import { StatusBadge } from "../../components/status-badge";

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

  // Test DM state
  const [testThreadId, setTestThreadId] = useState("");
  const [testContent, setTestContent] = useState("");
  const [testResult, setTestResult] = useState<TestDMResult | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await getZaloOpsStatus();
      setStatus(s);
    } catch { /* ignore */ }
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const e = await getRecentEvents();
      setEvents(e);
    } catch { /* ignore */ }
  }, []);

  const fetchAll = useCallback(() => {
    Promise.all([fetchStatus(), fetchEvents()])
      .finally(() => setLoading(false));
  }, [fetchStatus, fetchEvents]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const doReconnect = async () => {
    setAction({ type: "loading", message: "Reconnecting Zalo..." });
    try {
      const r = await reconnectZalo();
      if (r.success) {
        setAction({ type: "ok", message: `✅ ${r.status}: ${r.message}` });
      } else {
        setAction({ type: "err", message: `❌ ${r.status}: ${r.message}` });
      }
      fetchStatus();
    } catch (e: any) {
      setAction({ type: "err", message: e?.message ?? "Reconnect failed" });
    }
  };

  const doDisconnect = async () => {
    if (!confirm("⚠️ Disconnect Zalo? Listener will stop. OK?")) return;
    setAction({ type: "loading", message: "Disconnecting Zalo..." });
    try {
      const r = await disconnectZalo();
      if (r.success) {
        setAction({ type: "ok", message: "✅ Disconnected" });
      } else {
        setAction({ type: "err", message: `❌ ${r.status}` });
      }
      fetchStatus();
    } catch (e: any) {
      setAction({ type: "err", message: e?.message ?? "Disconnect failed" });
    }
  };

  const doCheckQR = async () => {
    setAction({ type: "loading", message: "Checking QR..." });
    try {
      const q = await getZaloQRStatus();
      setQr(q);
      setAction({ type: "ok", message: q.status });
    } catch (e: any) {
      setAction({ type: "err", message: e?.message ?? "QR check failed" });
    }
  };

  const doTestDM = async () => {
    if (!testThreadId.trim()) {
      setTestResult({ allowed: false, reason: "Missing threadId" });
      return;
    }
    setAction({ type: "loading", message: "Testing DM..." });
    try {
      const r = await testDM(testThreadId.trim(), testContent || undefined);
      setTestResult(r);
      if (r.allowed) {
        setAction({ type: "ok", message: `✅ Test DM allowed (agentTaskId: ${r.agentTaskId?.slice(-8)})` });
      } else {
        setAction({ type: "err", message: `🚫 ${r.reason}` });
      }
    } catch (e: any) {
      setTestResult({ allowed: false, reason: e?.message ?? "Test DM failed" });
      setAction({ type: "err", message: e?.message ?? "Test DM failed" });
    }
  };

  const hearbeatBadge = (hb: { status: string; lastBeatAt: string | null; ageSeconds: number | null }) => {
    const color =
      hb.status === "ok" ? "bg-green-500" :
      hb.status === "stale" ? "bg-yellow-500" : "bg-red-500";
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-white ${color}`}>
        <span className="h-2 w-2 rounded-full bg-white/60 animate-pulse" />
        {hb.status === "ok" ? "OK" : hb.status === "stale" ? "Stale" : "Down"}
        {hb.ageSeconds != null && ` (${hb.ageSeconds}s)`}
      </span>
    );
  };

  if (loading && !status) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-white">📡 Zalo Operations</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-slate-800" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-white">📡 Zalo Operations</h2>
        <div className="flex gap-2">
          <button
            onClick={fetchAll}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Action feedback */}
      {action.type !== "idle" && (
        <div className={`rounded-lg border p-3 text-sm ${
          action.type === "loading" ? "border-blue-800 bg-blue-900/30 text-blue-300" :
          action.type === "ok" ? "border-green-800 bg-green-900/30 text-green-300" :
          "border-red-800 bg-red-900/30 text-red-300"
        }`}>
          {action.message}
          {action.type !== "loading" && (
            <button
              onClick={() => setAction({ type: "idle" })}
              className="ml-3 text-xs opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Status Card */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-lg font-semibold text-white">🔌 Connection</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Status" value={
            <span className={`font-bold ${status?.connected ? "text-green-400" : "text-red-400"}`}>
              {status?.connected ? "✅ Connected" : "❌ Disconnected"}
            </span>
          } />
          <Stat label="Connection" value={status?.connectionStatus ?? "—"} />
          <Stat label="Listener" value={
            status?.listenerActive
              ? <span className="text-green-400">✅ Active</span>
              : <span className="text-red-400">❌ Inactive</span>
          } />
          <Stat label="Dry Run" value={
            status?.dryRun
              ? <span className="text-yellow-400">⚠️ Dry Run ({status?.dryRunSource})</span>
              : <span className="text-green-400">🔴 LIVE ({status?.dryRunSource})</span>
          } />
          <Stat label="Bot UID" value={status?.selfUserId ? <code className="text-xs">{status.selfUserId}</code> : "—"} />
          <Stat label="Bot Name" value={status?.selfDisplayName ?? "—"} />
          <Stat label="Last Connected" value={status?.lastConnectedAt ? fmtDate(status.lastConnectedAt) : "—"} />
          <Stat label="Last Message" value={status?.lastMessageAt ? fmtDate(status.lastMessageAt) : "—"} />
          <Stat label="Cooldown" value={`${status?.cooldownSeconds ?? "?"}s`} />
          <Stat label="Last Error" value={status?.lastError ?? "None"} />
          <Stat label="Inbound 24h" value={String(status?.inbound24h ?? "—")} />
          <Stat label="Outbound 24h" value={String(status?.outbound24h ?? "—")} />
        </div>
      </div>

      {/* Session Card */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-lg font-semibold text-white">💾 Session</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Session File" value={
            status?.session.exists
              ? <span className="text-green-400">✅ Exists</span>
              : <span className="text-red-400">❌ Missing</span>
          } />
          <Stat label="Age" value={status?.session.age ?? "—"} />
          <Stat label="Path" value={<code className="text-xs text-slate-400">{status?.session.path ?? "—"}</code>} />
          <Stat label="QR Ready" value={
            status?.session.qrAvailable ? "✅ Yes" : "❌ No"
          } />
          <Stat label="QR Updated" value={status?.session.qrUpdatedAt ? fmtDate(status.session.qrUpdatedAt) : "—"} />
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={doReconnect} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500">
            🔄 Reconnect
          </button>
          <button onClick={doDisconnect} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500">
            🔌 Disconnect
          </button>
          <button onClick={doCheckQR} className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-600">
            📱 Check QR
          </button>
        </div>
        {qr && (
          <div className="mt-3 rounded bg-slate-800 p-2 text-xs text-slate-400">
            QR: {qr.status} — {qr.message}
            {qr.qrAvailable && ` (updated: ${qr.qrUpdatedAt})`}
          </div>
        )}
      </div>

      {/* Heartbeats Card */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-lg font-semibold text-white">💓 Heartbeats</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {status && (
            <>
              <div className="flex items-center justify-between rounded bg-slate-800 p-3">
                <span className="text-sm text-slate-300">Zalo Connection</span>
                {hearbeatBadge(status.heartbeats.zaloConnection)}
              </div>
              <div className="flex items-center justify-between rounded bg-slate-800 p-3">
                <span className="text-sm text-slate-300">Zalo Listener</span>
                {hearbeatBadge(status.heartbeats.zaloListener)}
              </div>
              <div className="flex items-center justify-between rounded bg-slate-800 p-3">
                <span className="text-sm text-slate-300">Message Pipeline</span>
                {hearbeatBadge(status.heartbeats.messagePipeline)}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Allowed Threads Card */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-2 text-lg font-semibold text-white">🔒 Allowed Threads</h3>
        {status?.allowedThreads && status.allowedThreads.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {status.allowedThreads.map((t) => (
              <code key={t} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">{t}</code>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No threads configured (allowlist disabled)</p>
        )}
      </div>

      {/* Test DM Card */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-lg font-semibold text-white">🧪 Test DM (Dry-Run Only)</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Thread ID"
            value={testThreadId}
            onChange={(e) => setTestThreadId(e.target.value)}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
          />
          <input
            type="text"
            placeholder="Content (optional)"
            value={testContent}
            onChange={(e) => setTestContent(e.target.value)}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
          />
          <button onClick={doTestDM} className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-500">
            🧪 Test
          </button>
        </div>
        {testResult && (
          <div className={`mt-3 rounded p-3 text-sm ${
            testResult.allowed ? "bg-green-900/30 text-green-300" : "bg-red-900/30 text-red-300"
          }`}>
            {testResult.allowed
              ? `✅ Allowed — agentTaskId: ${testResult.agentTaskId ?? "—"}` 
              : `🚫 ${testResult.reason}`}
          </div>
        )}
      </div>

      {/* Recent Events Card */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-lg font-semibold text-white">📋 Recent Events</h3>
        {/* Inbound */}
        <div className="mb-4">
          <h4 className="mb-2 text-sm font-medium text-slate-400">
            📨 Inbound ({events?.inbound.length ?? 0})
          </h4>
          <div className="max-h-60 overflow-y-auto space-y-1">
            {events?.inbound.map((ev, i) => (
              <div key={i} className="flex items-start gap-2 rounded bg-slate-800 p-2 text-xs">
                <span className="text-slate-500 shrink-0">{fmtDate(ev.timestamp)}</span>
                <span className="text-slate-400 shrink-0">[{ev.threadId?.slice(-8)}]</span>
                <span className="text-slate-300 truncate">{ev.senderName}: {ev.content}</span>
              </div>
            ))}
            {(!events || events.inbound.length === 0) && (
              <p className="text-xs text-slate-600 p-2">No recent inbound messages</p>
            )}
          </div>
        </div>
        {/* Outbound */}
        <div className="mb-4">
          <h4 className="mb-2 text-sm font-medium text-slate-400">
            📤 Outbound ({events?.outbound.length ?? 0})
          </h4>
          <div className="max-h-60 overflow-y-auto space-y-1">
            {events?.outbound.map((ev, i) => (
              <div key={i} className="flex items-start gap-2 rounded bg-slate-800 p-2 text-xs">
                <span className="text-slate-500 shrink-0">{fmtDate(ev.timestamp)}</span>
                <span className="text-slate-400 shrink-0">[{ev.threadId?.slice(-8)}]</span>
                <span className="text-slate-300 truncate">{ev.detail}</span>
                {ev.errorCode && <span className="text-red-400 shrink-0">{ev.errorCode}</span>}
              </div>
            ))}
            {(!events || events.outbound.length === 0) && (
              <p className="text-xs text-slate-600 p-2">No recent outbound records</p>
            )}
          </div>
        </div>
        {/* Errors */}
        <div>
          <h4 className="mb-2 text-sm font-medium text-red-400">
            🚨 Errors ({events?.errors.length ?? 0})
          </h4>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {events?.errors.map((ev, i) => (
              <div key={i} className="flex items-start gap-2 rounded bg-red-900/20 p-2 text-xs">
                <span className="text-red-400 shrink-0">{fmtDate(ev.timestamp)}</span>
                <span className="text-red-300 truncate">{ev.detail}</span>
              </div>
            ))}
            {(!events || events.errors.length === 0) && (
              <p className="text-xs text-slate-600 p-2">✨ No recent errors</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-200">{value}</p>
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    if (diffMs < 60_000) return "just now";
    if (diffMs < 3600_000) return `${Math.round(diffMs / 60_000)}m ago`;
    if (diffMs < 86400_000) return `${Math.round(diffMs / 3600_000)}h ago`;
    return d.toLocaleDateString("vi-VN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
