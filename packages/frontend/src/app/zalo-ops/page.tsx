"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  getRecentEvents,
  type RecentEventsResponse,
} from "../../lib/api-client";
import { formatVnTime } from "../../components/ui/TimeText";
import { useOperationalStatus } from "../../components/operational-status-provider";

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

/* ── ZR2: connectionDetail → operator-facing label + color ─────── */
const CONNECTION_DETAIL_META: Record<string, { label: string; cls: string }> = {
  connected: { label: "● Đã kết nối", cls: "bg-green-950 text-green-400 border-green-800" },
  session_present: { label: "◐ Có session — bấm Reconnect", cls: "bg-blue-950 text-blue-400 border-blue-800" },
  backup_available: { label: "⟲ Có backup — có thể khôi phục", cls: "bg-cyan-950 text-cyan-400 border-cyan-800" },
  restored_from_backup: { label: "⟲ Đã khôi phục từ backup", cls: "bg-cyan-950 text-cyan-400 border-cyan-800" },
  restore_failed: { label: "✕ Khôi phục thất bại — cần QR", cls: "bg-red-950 text-red-400 border-red-800" },
  qr_required: { label: "▣ Cần đăng nhập QR", cls: "bg-yellow-950 text-yellow-400 border-yellow-800" },
  waiting_qr_scan: { label: "▣ Đang chờ quét QR", cls: "bg-yellow-950 text-yellow-400 border-yellow-800" },
  reconnect_in_progress: { label: "⏳ Đang kết nối lại…", cls: "bg-slate-800 text-slate-300 border-slate-600" },
};

function ConnectionDetailBadge({ detail }: { detail: string | undefined }) {
  if (!detail) return <span className="text-slate-400 text-xs">—</span>;
  const meta = CONNECTION_DETAIL_META[detail] ?? { label: detail, cls: "bg-slate-800 text-slate-300 border-slate-600" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

/* ── Page ─────────────────────────────────────────────────────── */
export default function ZaloOpsPage() {
  const { zalo, refresh: refreshOperational } = useOperationalStatus();
  const status = zalo.status === "ready" ? zalo.data : null;
  const [events, setEvents] = useState<RecentEventsResponse | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const eventsInFlight = useRef(false);
  const eventsController = useRef<AbortController | null>(null);

  const fetchEvents = useCallback(async () => {
    if (eventsInFlight.current) return;
    eventsInFlight.current = true;
    setEventsError(null);
    const controller = new AbortController();
    eventsController.current = controller;
    try {
      const nextEvents = await getRecentEvents(controller.signal);
      if (!controller.signal.aborted) setEvents(nextEvents);
    } catch (err) {
      if (!controller.signal.aborted) {
        setEvents(null);
        setEventsError(err instanceof Error ? err.message : "Không thể tải recent events");
      }
    } finally {
      if (eventsController.current === controller) eventsController.current = null;
      eventsInFlight.current = false;
      setEventsLoading(false);
    }
  }, []);

  const refreshAll = useCallback(() => {
    void refreshOperational();
    void fetchEvents();
  }, [refreshOperational, fetchEvents]);

  useEffect(() => {
    void fetchEvents();
    const timer = window.setInterval(() => void fetchEvents(), 30_000);
    return () => {
      window.clearInterval(timer);
      eventsController.current?.abort();
    };
  }, [fetchEvents]);

  if (zalo.status === "loading" && eventsLoading) {
    return <div className="space-y-4"><h1 className="text-xl font-bold text-slate-100">Zalo Operations</h1><p className="text-sm text-slate-500">Đang tải trạng thái…</p></div>;
  }

  const btnSecondary = "px-3 py-1.5 border border-slate-700 text-slate-300 hover:bg-slate-700 text-xs rounded-md transition-colors";

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Zalo Operations</h1>
          <p className="text-xs text-slate-500 mt-0.5">Status-only connection, session, heartbeat and recent-event evidence.</p>
        </div>
        <button onClick={refreshAll} className={btnSecondary}>🔄 Refresh</button>
      </div>

      {zalo.status === "unknown" && <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-2.5 text-sm text-red-300">Zalo runtime UNKNOWN — {zalo.error}</div>}
      {eventsError && <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-2.5 text-sm text-red-300">Recent events UNKNOWN — {eventsError}</div>}
      <div className="rounded-md border border-blue-800 bg-blue-950/30 px-4 py-2.5 text-sm text-blue-300">Zalo operations đang ở chế độ status-only. QR, reconnect, disconnect và test-DM không được gọi từ dashboard remediation.</div>

      {/* Runtime status is unknown until a complete response exists. */}
      {!status && <div className="rounded-md border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm text-slate-400">Runtime status UNKNOWN — không suy luận disconnected, dry-run hoặc empty events.</div>}

      {status?.session.qrAvailable && <div className="rounded-md border border-yellow-800 bg-yellow-950/40 px-4 py-3 text-sm text-yellow-400">QR metadata có sẵn từ backend nhưng không có thao tác quét QR trên trang này.</div>}

      {/* No login card or mutation controls in remediation. */}


      {/* Connection */}
      <Card title="Connection">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
          <Stat label="Status" value={
            <span className={status ? (status.connected ? "text-green-400 font-semibold" : "text-slate-400 font-semibold") : "text-slate-400 font-semibold"}>
              {status ? (status.connected ? "● Connected" : "○ Disconnected") : "? Unknown"}
            </span>
          } />
          <Stat label="Listener" value={
            status ? (status.listenerActive ? <span className="text-green-400">● Active</span> : <span className="text-slate-400">○ Stopped</span>) : <span className="text-slate-400">? Unknown</span>
          } />
          <Stat label="Dry Run" value={
            status ? (status.dryRun ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border bg-amber-950 text-amber-400 border-amber-800">🛡 ON</span> : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border bg-red-950 text-red-400 border-red-800">⚡ OFF</span>) : <span className="text-slate-400">? Unknown</span>
          } />
          <Stat label="Connection Detail" value={<ConnectionDetailBadge detail={status?.connectionDetail} />} />
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="File" value={status ? (status.session.exists ? <span className="text-green-400">● Present</span> : <span className="text-slate-400">? Unknown / missing</span>) : "? Unknown"} />
          <Stat label="Age" value={status?.session.age ?? "? Unknown"} />
          <Stat label="QR Metadata" value={status ? (status.session.qrAvailable ? <span className="text-yellow-400">Available</span> : "Not available") : "? Unknown"} />
        </div>
        {status?.session.warning && <div className="mt-3 rounded-md border border-yellow-800 bg-yellow-950/30 px-3 py-2 text-xs text-yellow-400">⚠ {status.session.warning}</div>}
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
            <p className="text-slate-400 text-xs col-span-3">UNKNOWN — chưa có heartbeat response hợp lệ.</p>
          )}
        </div>
      </Card>

      {/* Allowed Threads */}
      <Card title="Allowed Threads">
        {!status ? (
          <p className="text-xs text-slate-400">? UNKNOWN — chưa có runtime response hợp lệ.</p>
        ) : status.allowedThreads.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {status.allowedThreads.map((t) => (
              <code key={t} className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-[11px] font-mono text-blue-400">{t}</code>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-600">Response hợp lệ: chưa cấu hình thread nào.</p>
        )}
      </Card>

      <Card title="Test DM">
        <p className="text-sm text-slate-400">Test DM đã bị vô hiệu hóa trong remediation dashboard. Không có request test hoặc outbound action nào được thực hiện.</p>
      </Card>

      {/* Recent Events */}
      <Card title="Recent Events">
        <div className="space-y-4">
          {/* Inbound */}
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">Inbound ({events ? events.inbound.length : "UNKNOWN"})</p>
            <div className="max-h-44 overflow-y-auto space-y-1">
              {events?.inbound.map((ev, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md bg-slate-900 border border-slate-700/50 px-2.5 py-1.5 text-xs">
                  <span className="text-slate-600 shrink-0 font-mono">{formatVnTime(ev.timestamp, { showDate: false, showUtcLabel: false })}</span>
                  <span className="text-slate-600 shrink-0 font-mono">[…{ev.threadId?.slice(-6)}]</span>
                  <span className="text-slate-400 truncate">{ev.senderName}: {ev.content}</span>
                </div>
              ))}
              {!events ? <p className="text-xs text-slate-400 px-1">? Unknown — không có dữ liệu events</p> : events.inbound.length === 0 && <p className="text-xs text-slate-600 px-1">Không có tin đến gần đây</p>}
            </div>
          </div>
          {/* Outbound */}
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">Outbound ({events ? events.outbound.length : "UNKNOWN"})</p>
            <div className="max-h-44 overflow-y-auto space-y-1">
              {events?.outbound.map((ev, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md bg-slate-900 border border-slate-700/50 px-2.5 py-1.5 text-xs">
                  <span className="text-slate-600 shrink-0 font-mono">{formatVnTime(ev.timestamp, { showDate: false, showUtcLabel: false })}</span>
                  <span className="text-slate-600 shrink-0 font-mono">[…{ev.threadId?.slice(-6)}]</span>
                  <span className="text-slate-400 truncate">{ev.detail}</span>
                  {ev.errorCode && <span className="text-red-400 shrink-0 font-medium">{ev.errorCode}</span>}
                </div>
              ))}
              {!events ? <p className="text-xs text-slate-400 px-1">? Unknown — không có dữ liệu events</p> : events.outbound.length === 0 && <p className="text-xs text-slate-600 px-1">Không có outbound gần đây</p>}
            </div>
          </div>
          {/* Errors */}
          <div>
            <p className="text-[10px] text-red-700 uppercase tracking-widest font-semibold mb-2">Errors ({events ? events.errors.length : "UNKNOWN"})</p>
            <div className="max-h-36 overflow-y-auto space-y-1">
              {events?.errors.map((ev, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md bg-red-950/20 border border-red-800/40 px-2.5 py-1.5 text-xs">
                  <span className="text-red-600 shrink-0 font-mono">{formatVnTime(ev.timestamp, { showDate: false, showUtcLabel: false })}</span>
                  <span className="text-red-400 truncate">{ev.detail}</span>
                </div>
              ))}
              {!events ? <p className="text-xs text-slate-400 px-1">? Unknown — không có dữ liệu errors</p> : events.errors.length === 0 && <p className="text-xs text-slate-600 px-1">✨ No recent errors</p>}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
