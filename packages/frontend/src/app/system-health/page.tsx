"use client";

import { useEffect, useState } from "react";
import {
  getHealthDetail,
  getConfigCheck,
  getHeartbeats,
  type HealthDetailResponse,
  type ConfigCheckResponse,
} from "../../lib/api-client";
import { useToast } from "../../components/toast";
import { formatVnTime } from "../../components/ui/TimeText";

export default function SystemHealthPage() {
  const [health, setHealth] = useState<HealthDetailResponse | null>(null);
  const [config, setConfig] = useState<ConfigCheckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchData = () => {
    setLoading(true);
    Promise.all([getHealthDetail(), getConfigCheck().catch(() => null)])
      .then(([h, c]) => {
        setHealth(h);
        setConfig(c);
      })
      .catch(() => toast("Failed to load health data", "error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, []);

  // ── Loading ──────────────────────────────────────────────────────
  if (loading && !health) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-sm">Đang tải health data...</p>
      </div>
    );
  }

  const statusDark =
    health?.status === "healthy"
      ? "bg-green-900/30 border-green-700/60 text-green-300"
      : health?.status === "degraded"
        ? "bg-yellow-900/30 border-yellow-700/60 text-yellow-300"
        : "bg-red-900/30 border-red-700/60 text-red-300";

  const statusEmoji =
    health?.status === "healthy" ? "✅" : health?.status === "degraded" ? "⚠️" : "🔴";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">🏥 System Health</h1>
          <p className="text-sm text-slate-400 mt-1">Trạng thái toàn hệ thống — auto-refresh mỗi 15s</p>
        </div>
        <button
          onClick={fetchData}
          className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600 transition-colors"
        >
          🔄 Làm mới
        </button>
      </div>

      {/* Overall status banner */}
      <div className={`rounded-xl border p-6 ${statusDark}`}>
        <div className="flex items-center gap-4">
          <span className="text-3xl">{statusEmoji}</span>
          <div>
            <h2 className="text-xl font-bold uppercase tracking-wide">
              {health?.status ?? "unknown"}
            </h2>
            <p className="text-sm opacity-75 mt-0.5">
              Uptime: {formatUptime(health?.uptimeSeconds ?? 0)} | PID: {health?.backend?.pid ?? "—"}
            </p>
          </div>
          {loading && (
            <div className="ml-auto w-4 h-4 border border-current border-t-transparent rounded-full animate-spin opacity-60" />
          )}
        </div>
      </div>

      {/* Grid of sub-sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Backend */}
        <Section title="⚙️ Backend">
          <Kv label="PID" value={health?.backend?.pid} />
          <Kv label="Env" value={health?.backend?.nodeEnv} />
          <Kv label="Port" value={health?.backend?.port} />
          <Kv label="Version" value={health?.version} />
        </Section>

        {/* Database */}
        <Section title="🗄️ Database" accent={health?.db?.ok ? "green" : "red"}>
          <Kv label="Status" value={health?.db?.ok ? "✅ OK" : "❌ Error"} />
          <Kv label="Size" value={formatBytes(health?.db?.sizeBytes ?? 0)} />
          {health?.db?.criticalTables &&
            Object.entries(health.db.criticalTables).map(([k, v]) => (
              <Kv key={k} label={k} value={v === null ? "❌ Missing" : `${v} rows`} />
            ))}
        </Section>

        {/* Zalo */}
        <Section title="💬 Zalo" accent={health?.zalo?.connected ? "green" : "yellow"}>
          <Kv label="Connected" value={health?.zalo?.connected ? "✅ Yes" : "❌ No"} />
          <Kv label="UID" value={health?.zalo?.uid ?? "—"} />
          <Kv label="Last connected" value={fmtTime(health?.zalo?.lastConnectedAt)} />
          {health?.zalo?.lastError && (
            <Kv label="Error" value={health.zalo.lastError} accent="red" />
          )}
        </Section>

        {/* Auto-reply */}
        <Section title="🤖 Auto-reply">
          <Kv label="Enabled" value={health?.autoReply?.enabled ? "✅" : "❌"} />
          <Kv
            label="Dry Run"
            value={health?.autoReply?.dryRun ? "🟢 DRY" : "🔴 LIVE"}
            accent={health?.autoReply?.dryRun ? "green" : "red"}
          />
          <Kv label="Allowed Threads" value={health?.autoReply?.allowedThreadsCount} />
          <Kv label="Cooldown" value={`${health?.autoReply?.cooldownSeconds ?? 0}s`} />
        </Section>

        {/* Worker */}
        <Section title="🔧 Worker" accent={health?.worker?.active ? "green" : "red"}>
          <Kv label="Active" value={health?.worker?.active ? "✅" : "❌"} />
          <Kv label="Queued Jobs" value={health?.worker?.queuedJobs} />
          <Kv
            label="Failed (24h)"
            value={health?.worker?.failedJobs24h}
            accent={(health?.worker?.failedJobs24h ?? 0) > 0 ? "red" : undefined}
          />
        </Section>

        {/* Backup */}
        <Section
          title="💾 Backup"
          accent={(health?.backup?.backupCount ?? 0) > 0 ? "green" : "yellow"}
        >
          <Kv label="Count" value={health?.backup?.backupCount} />
          <Kv label="Latest" value={health?.backup?.latestBackupName ?? "—"} />
          <Kv
            label="Age"
            value={
              health?.backup?.latestBackupAgeHours != null
                ? `${health.backup.latestBackupAgeHours}h`
                : "—"
            }
          />
        </Section>

        {/* Messages */}
        <Section title="📨 Messages (24h)">
          <Kv label="Inbound" value={health?.messages?.inbound24h} />
          <Kv label="Outbound" value={health?.messages?.outbound24h} />
          <Kv label="Last in" value={fmtTime(health?.messages?.lastInboundAt)} />
          <Kv label="Last out" value={fmtTime(health?.messages?.lastOutboundAt)} />
        </Section>

        {/* Errors */}
        <Section
          title="❌ Errors (24h)"
          accent={health?.errorsSummary?.status === "error" ? "red" : undefined}
        >
          <Kv label="Summary" value={health?.errorsSummary?.status ?? "—"} />
          <Kv
            label="Errors"
            value={health?.errorsSummary?.errors24h}
            accent={(health?.errorsSummary?.errors24h ?? 0) > 0 ? "red" : undefined}
          />
          <Kv label="Warnings" value={health?.errorsSummary?.warnings24h} />
          <Kv label="Top code" value={health?.errorsSummary?.topErrorCode ?? "—"} />
        </Section>

        {/* Process Lock */}
        <Section title="🔒 Process Lock">
          <Kv label="Locked" value={health?.processLock?.locked ? "🔒 Yes" : "🔓 No"} />
          <Kv label="Owner PID" value={health?.processLock?.ownerPid ?? "—"} />
          <Kv
            label="This process"
            value={health?.processLock?.isOwner ? "✅ Owner" : "—"}
          />
        </Section>

        {/* Thread Review */}
        <Section title="🔍 Thread Review">
          <Kv label="Total" value={health?.allowedThreadsReview?.count} />
          <Kv
            label="High Risk"
            value={health?.allowedThreadsReview?.highRiskCount}
            accent={(health?.allowedThreadsReview?.highRiskCount ?? 0) > 0 ? "red" : undefined}
          />
          <Kv label="Groups" value={health?.allowedThreadsReview?.groupCount} />
          <Kv
            label="Unknown"
            value={health?.allowedThreadsReview?.unknownCount}
            accent={(health?.allowedThreadsReview?.unknownCount ?? 0) > 0 ? "yellow" : undefined}
          />
        </Section>
      </div>

      {/* Config Check */}
      {config && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4">🔍 Config Check</h2>
          <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
            <Stat label="✅ Pass" value={config?.summary?.pass ?? 0} accent="green" />
            <Stat label="⚠️ Warn" value={config?.summary?.warn ?? 0} accent="yellow" />
            <Stat label="❌ Error" value={config?.summary?.error ?? 0} accent="red" />
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {(config?.checks ?? []).map((c, i) => (
              <div
                key={i}
                className={`text-xs p-2.5 rounded-lg border ${
                  c.severity === "ERROR"
                    ? "border-red-700/60 bg-red-900/20 text-red-300"
                    : c.severity === "WARN"
                      ? "border-yellow-700/60 bg-yellow-900/20 text-yellow-300"
                      : "border-green-700/60 bg-green-900/20 text-green-300"
                }`}
              >
                <span className="font-semibold">{c.name}</span>
                <span className="text-current/70"> — {c.message}</span>
              </div>
            ))}
            {(config?.checks ?? []).length === 0 && (
              <p className="text-sm text-slate-500 py-4 text-center">Không có config issues.</p>
            )}
          </div>
        </div>
      )}

      {/* Heartbeats */}
      <HeartbeatsSection />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function HeartbeatsSection() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    getHeartbeats()
      .then((d) => setData(d as unknown as Record<string, unknown>))
      .catch(() => {});
  }, []);
  const hb = data as Record<string, unknown> | null;
  const items = (hb as any)?.items as any[] | undefined;

  if (!items?.length) return null;

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-6">
      <h2 className="text-lg font-semibold text-slate-100 mb-4">
        💓 Heartbeats
        <span className="ml-2 text-sm font-normal text-slate-400">
          — {(hb as any)?.status}
        </span>
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.map((h: any) => (
          <div
            key={h.name}
            className={`rounded-lg border p-3 text-xs ${
              h.status === "ok"
                ? "border-green-700/60 bg-green-900/20"
                : h.status === "stale"
                  ? "border-yellow-700/60 bg-yellow-900/20"
                  : "border-red-700/60 bg-red-900/20"
            }`}
          >
            <div className="font-semibold text-slate-200 truncate">{h.name}</div>
            <div
              className={`uppercase font-bold mt-1 text-[11px] tracking-wide ${
                h.status === "ok"
                  ? "text-green-400"
                  : h.status === "stale"
                    ? "text-yellow-400"
                    : "text-red-400"
              }`}
            >
              {h.status}
            </div>
            {h.ageSeconds != null && (
              <div className="text-slate-500 mt-0.5">{h.ageSeconds}s ago</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  accent,
}: {
  title: string;
  children: React.ReactNode;
  accent?: string;
}) {
  const borderAccent =
    accent === "green"
      ? "border-l-2 border-l-green-500"
      : accent === "red"
        ? "border-l-2 border-l-red-500"
        : accent === "yellow"
          ? "border-l-2 border-l-yellow-500"
          : "";

  return (
    <div
      className={`rounded-lg border border-slate-700 bg-slate-800/60 p-4 ${borderAccent}`}
    >
      <h3 className="text-sm font-semibold text-slate-300 mb-3">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Kv({
  label,
  value,
  accent,
}: {
  label: string;
  value: unknown;
  accent?: string;
}) {
  const color =
    accent === "red"
      ? "text-red-400"
      : accent === "green"
        ? "text-green-400"
        : accent === "yellow"
          ? "text-yellow-400"
          : "text-slate-200";

  return (
    <div className="flex justify-between items-center text-xs gap-2">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`font-medium text-right break-all ${color}`}>
        {String(value ?? "—")}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  const cls =
    accent === "green"
      ? "bg-green-900/30 border-green-700/60 text-green-300"
      : accent === "yellow"
        ? "bg-yellow-900/30 border-yellow-700/60 text-yellow-300"
        : accent === "red"
          ? "bg-red-900/30 border-red-700/60 text-red-300"
          : "bg-slate-700/60 border-slate-600 text-slate-300";

  return (
    <div className={`rounded-lg border p-3 text-center ${cls}`}>
      <div className="text-xs opacity-75">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function formatUptime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return formatVnTime(iso);
}
