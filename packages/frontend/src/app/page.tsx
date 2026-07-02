"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getZaloOpsStatus,
  getLiveTestStatus,
  getHealthDetail,
  type ZaloOpsStatus,
  type HealthDetailResponse,
} from "../lib/api-client";
import { formatRelativeTime } from "../components/ui/TimeText";

/* ── Types ─────────────────────────────────────────────────────── */
type LiveStatus = { active: boolean; session?: { sentCount: number; maxMessages: number } | null };

/* ── Dashboard ─────────────────────────────────────────────────── */
export default function DashboardPage() {
  const [zalo, setZalo] = useState<ZaloOpsStatus | null>(null);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [health, setHealth] = useState<HealthDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    Promise.all([
      getZaloOpsStatus().catch(() => null),
      getLiveTestStatus().catch(() => null),
      getHealthDetail().catch(() => null),
    ]).then(([z, l, h]) => {
      if (z) setZalo(z as ZaloOpsStatus);
      if (l) setLive(l as LiveStatus);
      if (h) setHealth(h as HealthDetailResponse);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  /* ── Status card helpers ── */
  const statusCard = (
    label: string,
    ok: boolean | null,
    okText: string,
    failText: string,
    detail?: string
  ) => {
    const state = ok === null ? "loading" : ok ? "ok" : "fail";
    return (
      <div className={`rounded-lg border p-4 ${
        state === "loading" ? "border-slate-700 bg-slate-800/50" :
        state === "ok" ? "border-green-800/60 bg-green-950/30" :
        "border-red-800/60 bg-red-950/30"
      }`}>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">{label}</p>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${
            state === "loading" ? "bg-slate-600" :
            state === "ok" ? "bg-green-500 animate-pulse" :
            "bg-red-500"
          }`} />
          <span className={`text-sm font-semibold ${
            state === "loading" ? "text-slate-500" :
            state === "ok" ? "text-green-400" :
            "text-red-400"
          }`}>
            {state === "loading" ? "—" : ok ? okText : failText}
          </span>
        </div>
        {detail && (
          <p className="text-[11px] text-slate-500 mt-1">{detail}</p>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <PageHeader />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-800 border border-slate-700" />
          ))}
        </div>
      </div>
    );
  }

  const dryRun = zalo?.dryRun ?? true;
  const liveActive = live?.active ?? false;

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader />

      {/* ═══ Safety bar ═══ */}
      <div className={`rounded-lg border px-4 py-3 flex items-center gap-3 text-sm ${
        liveActive
          ? "border-red-800 bg-red-950/40"
          : dryRun
          ? "border-amber-800/60 bg-amber-950/30"
          : "border-red-700 bg-red-950/50"
      }`}>
        <span className={`text-lg ${liveActive ? "animate-pulse" : ""}`}>
          {liveActive ? "🔴" : dryRun ? "🛡" : "⚡"}
        </span>
        <div>
          {liveActive ? (
            <span className="text-red-300 font-semibold">Live Test đang chạy — bot đang gửi tin thật</span>
          ) : dryRun ? (
            <span className="text-amber-400 font-semibold">Chế độ DRY RUN — mọi tin nhắn đều là mô phỏng</span>
          ) : (
            <span className="text-red-300 font-semibold">⚠ DryRun = OFF — bot có thể gửi tin thật!</span>
          )}
          <span className="text-slate-500 text-xs ml-2">
            {dryRun ? "An toàn để test." : "Kiểm tra Runtime Config ngay."}
          </span>
        </div>
        {!dryRun && (
          <Link href="/runtime-settings" className="ml-auto text-xs bg-red-700 hover:bg-red-600 text-white px-2.5 py-1 rounded-md font-medium transition-colors">
            Fix →
          </Link>
        )}
      </div>

      {/* ═══ Status grid ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statusCard(
          "Zalo Connection",
          zalo?.connected ?? null,
          "Connected",
          "Disconnected",
          zalo?.selfUserId ? `UID: ${zalo.selfUserId.slice(-8)}` : undefined
        )}
        {statusCard(
          "Listener",
          zalo?.listenerActive ?? null,
          "Active",
          "Stopped",
          zalo?.lastMessageAt ? `Last msg: ${formatRelativeTime(zalo.lastMessageAt)}` : undefined
        )}
        {statusCard(
          "Live Test",
          liveActive ? false : true,
          "Inactive (safe)",
          "ACTIVE 🔴",
          live?.session ? `${live.session.sentCount}/${live.session.maxMessages} sent` : undefined
        )}
        {statusCard(
          "Global DryRun",
          dryRun,
          "ON (safe)",
          "OFF — live mode!",
          zalo?.dryRunSource ? `source: ${zalo.dryRunSource}` : undefined
        )}
      </div>

      {/* ═══ Main grid 2-col ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Scope card */}
        <Card title="Deployment Scope" className="lg:col-span-1">
          <div className="space-y-2">
            <ScopeRow state="ready" label="Controlled DM" detail="SCHED1-LIVE ✓ · 2026-07-02" />
            <ScopeRow state="pending" label="Global Live" detail="Session persistence needed" />
            <ScopeRow state="pending" label="Group Rollout" detail="Group mention pilot needed" />
          </div>
        </Card>

        {/* Today stats */}
        <Card title="Activity (24h)" className="lg:col-span-1">
          {health ? (
            <div className="grid grid-cols-2 gap-2">
              <StatBox label="Inbound" value={String(health.messages?.inbound24h ?? "—")} color="blue" />
              <StatBox label="Outbound" value={String(health.messages?.outbound24h ?? "—")} color="green" />
              <StatBox label="Failed Tasks" value={String(health.errors?.failedAgentTasks24h ?? "—")} color="red" />
              <StatBox label="Failed Exec" value={String(health.errors?.failedExecutions24h ?? "—")} color="red" />
            </div>
          ) : (
            <EmptyState text="Loading stats..." />
          )}
        </Card>

        {/* System */}
        <Card title="System" className="lg:col-span-1">
          {health ? (
            <div className="space-y-2 text-[13px]">
              <Row label="Backend" value={health.status === "ok" ? "✅ OK" : "⚠ " + health.status} />
              <Row label="DB size" value={health.db ? `${(health.db.sizeBytes / 1024 / 1024).toFixed(1)} MB` : "—"} />
              <Row label="Worker" value={health.worker?.active ? "✅ Active" : "⚠ Inactive"} />
              <Row label="Queue" value={health.worker ? `${health.worker.queuedJobs} queued` : "—"} />
              <Row label="Uptime" value={health.uptimeSeconds ? `${Math.floor(health.uptimeSeconds / 3600)}h ${Math.floor((health.uptimeSeconds % 3600) / 60)}m` : "—"} />
            </div>
          ) : (
            <EmptyState text="Loading..." />
          )}
        </Card>
      </div>

      {/* ═══ Quick nav ═══ */}
      <div>
        <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-3">Quick Access</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { href: "/messages", icon: "◈", label: "Messages" },
            { href: "/schedules", icon: "◷", label: "Schedules" },
            { href: "/zalo-ops", icon: "◬", label: "Zalo Ops" },
            { href: "/production-readiness", icon: "◎", label: "Readiness" },
            { href: "/system-health", icon: "◌", label: "Health" },
            { href: "/runtime-settings", icon: "⊡", label: "Runtime" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-600 px-3 py-3 text-center transition-colors group"
            >
              <span className="text-lg font-mono text-slate-500 group-hover:text-blue-400 transition-colors">{item.icon}</span>
              <span className="text-[12px] text-slate-400 group-hover:text-slate-200 transition-colors">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Footer */}
      <p className="text-[11px] text-slate-600 text-center pt-4 border-t border-slate-800">
        Hermes Zalo Bridge · Auto-refresh 30s · UTC+7
      </p>
    </div>
  );
}

/* ── Shared components ─────────────────────────────────────────── */
function PageHeader() {
  return (
    <div>
      <h1 className="text-xl font-bold text-slate-100">Dashboard</h1>
      <p className="text-xs text-slate-500 mt-0.5">Hermes Zalo Bridge — Controlled DM Pilot</p>
    </div>
  );
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-700 bg-slate-800/60 p-4 ${className}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">{title}</p>
      {children}
    </div>
  );
}

function ScopeRow({ state, label, detail }: { state: "ready" | "pending"; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-slate-700/50 last:border-0">
      <span className={`mt-0.5 shrink-0 text-xs font-bold ${state === "ready" ? "text-green-400" : "text-slate-500"}`}>
        {state === "ready" ? "✓" : "–"}
      </span>
      <div>
        <p className={`text-[13px] font-medium ${state === "ready" ? "text-slate-200" : "text-slate-400"}`}>{label}</p>
        <p className="text-[11px] text-slate-500">{detail}</p>
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: "blue" | "green" | "red" }) {
  const colors = {
    blue: "text-blue-400",
    green: "text-green-400",
    red: "text-red-400",
  };
  return (
    <div className="bg-slate-900/60 rounded-md p-2.5">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-lg font-bold ${colors[color]}`}>{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 border-b border-slate-700/30 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-300 font-medium">{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="text-[13px] text-slate-600 py-4 text-center">{text}</p>
  );
}
