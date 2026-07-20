"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "../components/ui/TimeText";
import { useOperationalStatus } from "../components/operational-status-provider";
import { getHealthDetail, type HealthDetailResponse } from "../lib/api-client";
import {
  loadingState,
  readyState,
  unknownState,
  type RemoteDataState,
} from "../lib/dashboard-state";

export default function DashboardPage() {
  const { zalo, liveTest, refresh: refreshOperational } = useOperationalStatus();
  const [health, setHealth] = useState<RemoteDataState<HealthDetailResponse>>(() => loadingState());
  const healthInFlight = useRef(false);
  const healthController = useRef<AbortController | null>(null);

  const refreshHealth = useCallback(async () => {
    if (healthInFlight.current) return;
    healthInFlight.current = true;
    const controller = new AbortController();
    healthController.current = controller;
    try {
      const result = await getHealthDetail(controller.signal);
      if (!controller.signal.aborted) setHealth(readyState(result));
    } catch (error) {
      if (!controller.signal.aborted) setHealth(unknownState(error, "Không thể tải system health"));
    } finally {
      if (healthController.current === controller) healthController.current = null;
      healthInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    const timer = window.setInterval(() => void refreshHealth(), 30_000);
    return () => {
      window.clearInterval(timer);
      healthController.current?.abort();
    };
  }, [refreshHealth]);

  const refreshAll = useCallback(() => {
    void refreshOperational();
    void refreshHealth();
  }, [refreshOperational, refreshHealth]);

  const zaloData = zalo.status === "ready" ? zalo.data : null;
  const liveData = liveTest.status === "ready" ? liveTest.data : null;
  const healthData = health.status === "ready" ? health.data : null;
  const runtimeUnknown = !zaloData || !liveData;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <PageHeader />
        <button onClick={refreshAll} className="px-3 py-1.5 text-xs border border-slate-700 text-slate-400 rounded-md hover:bg-slate-800 transition-colors">🔄 Refresh</button>
      </div>

      {runtimeUnknown ? (
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
          Runtime UNKNOWN — không suy luận DRY RUN, live-test inactive hoặc Zalo disconnected khi API chưa trả dữ liệu hợp lệ.
          {(zalo.status === "unknown" || liveTest.status === "unknown") && (
            <p className="mt-1 text-xs text-red-300">{zalo.status === "unknown" ? zalo.error : liveTest.status === "unknown" ? liveTest.error : null}</p>
          )}
        </div>
      ) : (
        <div className={`rounded-lg border px-4 py-3 flex items-center gap-3 text-sm ${
          liveData.active
            ? "border-red-800 bg-red-950/40"
            : zaloData.dryRun
              ? "border-amber-800/60 bg-amber-950/30"
              : "border-red-700 bg-red-950/50"
        }`}>
          <span className={`text-lg ${liveData.active ? "animate-pulse" : ""}`}>
            {liveData.active ? "🔴" : zaloData.dryRun ? "🛡" : "⚠"}
          </span>
          <div>
            {liveData.active ? (
              <span className="text-red-300 font-semibold">Controlled live test đang active cho thread đã giới hạn.</span>
            ) : zaloData.dryRun ? (
              <span className="text-amber-400 font-semibold">Effective auto-reply DRY RUN đang bật.</span>
            ) : (
              <span className="text-red-300 font-semibold">Dry-run đang OFF — global live không được hỗ trợ.</span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatusCard
          label="Zalo Connection"
          value={!zaloData ? null : zaloData.connected ? "Connected" : "Disconnected"}
          tone={!zaloData ? "unknown" : zaloData.connected ? "ok" : "fail"}
          detail={zaloData?.selfUserId ? `UID: ${zaloData.selfUserId.slice(-8)}` : undefined}
        />
        <StatusCard
          label="Listener"
          value={!zaloData ? null : zaloData.listenerActive ? "Active" : "Stopped"}
          tone={!zaloData ? "unknown" : zaloData.listenerActive ? "ok" : "fail"}
          detail={zaloData?.lastMessageAt ? `Last msg: ${formatRelativeTime(zaloData.lastMessageAt)}` : undefined}
        />
        <StatusCard
          label="Controlled Live Test"
          value={!liveData ? null : liveData.active ? "ACTIVE" : "Inactive"}
          tone={!liveData ? "unknown" : liveData.active ? "fail" : "neutral"}
          detail={liveData?.session ? `${liveData.session.sentCount}/${liveData.session.maxMessages} sent` : undefined}
        />
        <StatusCard
          label="Global DryRun"
          value={!zaloData ? null : zaloData.dryRun ? "ON" : "OFF"
          }
          tone={!zaloData ? "unknown" : zaloData.dryRun ? "ok" : "fail"}
          detail={zaloData?.dryRunSource ? `source: ${zaloData.dryRunSource}` : undefined}
        />
      </div>

      {health.status === "unknown" && (
        <div className="rounded-md border border-red-800 bg-red-950/30 px-4 py-2 text-sm text-red-300">System health UNKNOWN — {health.error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Activity (24h)">
          {healthData ? (
            <div className="grid grid-cols-2 gap-2">
              <StatBox label="Inbound" value={String(healthData.messages.inbound24h)} color="blue" />
              <StatBox label="Outbound" value={String(healthData.messages.outbound24h)} color="green" />
              <StatBox label="Failed Tasks" value={String(healthData.errors.failedAgentTasks24h)} color="red" />
              <StatBox label="Failed Exec" value={String(healthData.errors.failedExecutions24h)} color="red" />
            </div>
          ) : <EmptyState text={health.status === "loading" ? "Loading stats…" : "Stats UNKNOWN"} />}
        </Card>

        <Card title="System">
          {healthData ? (
            <div className="space-y-2 text-[13px]">
              <Row label="Backend" value={healthData.status === "healthy" ? "✅ OK" : `⚠ ${healthData.status}`} />
              <Row label="DB" value={healthData.db.ok ? `${(healthData.db.sizeBytes / 1024 / 1024).toFixed(1)} MB` : "Unavailable"} />
              <Row label="Worker" value={healthData.worker.active ? "✅ Active" : "⚠ Inactive"} />
              <Row label="Queue" value={`${healthData.worker.queuedJobs} queued`} />
              <Row label="Uptime" value={`${Math.floor(healthData.uptimeSeconds / 3600)}h ${Math.floor((healthData.uptimeSeconds % 3600) / 60)}m`} />
            </div>
          ) : <EmptyState text={health.status === "loading" ? "Loading…" : "System UNKNOWN"} />}
        </Card>
      </div>

      <div>
        <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-3">Quick Access</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { href: "/messages", icon: "◈", label: "Messages" },
            { href: "/schedules", icon: "◷", label: "Schedules" },
            { href: "/zalo-ops", icon: "◬", label: "Zalo Ops" },
            { href: "/production-readiness", icon: "◎", label: "Readiness" },
            { href: "/system-health", icon: "◌", label: "Health" },
            { href: "/safety-mode", icon: "⊗", label: "Safety" },
          ].map((item) => (
            <Link key={item.href} href={item.href} className="flex flex-col items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-600 px-3 py-3 text-center transition-colors group">
              <span className="text-lg font-mono text-slate-500 group-hover:text-blue-400 transition-colors">{item.icon}</span>
              <span className="text-[12px] text-slate-400 group-hover:text-slate-200 transition-colors">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-slate-600 text-center pt-4 border-t border-slate-800">Hermes Zalo Bridge · Auto-refresh 30s · UTC+7</p>
    </div>
  );
}

function PageHeader() {
  return <div><h1 className="text-xl font-bold text-slate-100">Dashboard</h1><p className="text-xs text-slate-500 mt-0.5">Current API evidence only — no historical proof or mutation controls.</p></div>;
}

function StatusCard({ label, value, tone, detail }: { label: string; value: string | null; tone: "ok" | "fail" | "neutral" | "unknown"; detail?: string }) {
  const styles = {
    ok: "border-green-800/60 bg-green-950/30 text-green-400",
    fail: "border-red-800/60 bg-red-950/30 text-red-400",
    neutral: "border-slate-700 bg-slate-800/50 text-slate-300",
    unknown: "border-slate-700 bg-slate-900/60 text-slate-400",
  };
  return <div className={`rounded-lg border p-4 ${styles[tone]}`}><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">{label}</p><p className="text-sm font-semibold">{value ?? "UNKNOWN"}</p>{detail && <p className="text-[11px] text-slate-500 mt-1">{detail}</p>}</div>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">{title}</p>{children}</div>;
}

function StatBox({ label, value, color }: { label: string; value: string; color: "blue" | "green" | "red" }) {
  const colors = { blue: "text-blue-400", green: "text-green-400", red: "text-red-400" };
  return <div className="bg-slate-900/60 rounded-md p-2.5"><p className="text-[11px] text-slate-500">{label}</p><p className={`text-lg font-bold ${colors[color]}`}>{value}</p></div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between py-0.5 border-b border-slate-700/30 last:border-0"><span className="text-slate-500">{label}</span><span className="text-slate-300 font-medium">{value}</span></div>;
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-[13px] text-slate-600 py-4 text-center">{text}</p>;
}
