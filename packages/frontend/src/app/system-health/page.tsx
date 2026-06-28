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

  if (loading && !health) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-400">Đang tải health data...</p>
      </div>
    );
  }

  const statusColor =
    health?.status === "healthy"
      ? "bg-green-50 border-green-300 text-green-800"
      : health?.status === "degraded"
        ? "bg-yellow-50 border-yellow-300 text-yellow-800"
        : "bg-red-50 border-red-300 text-red-800";

  const statusEmoji =
    health?.status === "healthy" ? "✅" : health?.status === "degraded" ? "⚠️" : "🔴";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">🏥 System Health</h1>
          <p className="text-sm text-slate-500 mt-1">Trạng thái toàn hệ thống — auto-refresh mỗi 15s</p>
        </div>
        <button onClick={fetchData} className="px-4 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg">🔄 Làm mới</button>
      </div>

      {/* Overall */}
      <div className={`rounded-xl border p-6 shadow-sm ${statusColor}`}>
        <div className="flex items-center gap-4">
          <span className="text-3xl">{statusEmoji}</span>
          <div>
            <h2 className="text-xl font-bold uppercase">{health?.status ?? "unknown"}</h2>
            <p className="text-sm opacity-75">Uptime: {formatUptime(health?.uptimeSeconds ?? 0)} | PID: {health?.backend?.pid}</p>
          </div>
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

        {/* DB */}
        <Section title="🗄️ Database" accent={health?.db?.ok ? "green" : "red"}>
          <Kv label="Status" value={health?.db?.ok ? "✅ OK" : "❌ Error"} />
          <Kv label="Size" value={formatBytes(health?.db?.sizeBytes ?? 0)} />
          {health?.db?.criticalTables && Object.entries(health.db.criticalTables).map(([k, v]) => (
            <Kv key={k} label={k} value={v === null ? "❌ Missing" : `${v} rows`} />
          ))}
        </Section>

        {/* Zalo */}
        <Section title="💬 Zalo" accent={health?.zalo?.connected ? "green" : "yellow"}>
          <Kv label="Connected" value={health?.zalo?.connected ? "✅ Yes" : "❌ No"} />
          <Kv label="UID" value={health?.zalo?.uid ?? "—"} />
          <Kv label="Last connected" value={fmtTime(health?.zalo?.lastConnectedAt)} />
          {health?.zalo?.lastError && <Kv label="Error" value={health.zalo.lastError} accent="red" />}
        </Section>

        {/* Auto-reply */}
        <Section title="🤖 Auto-reply">
          <Kv label="Enabled" value={health?.autoReply?.enabled ? "✅" : "❌"} />
          <Kv label="Dry Run" value={health?.autoReply?.dryRun ? "🟢 DRY" : "🔴 LIVE"} />
          <Kv label="Allowed Threads" value={health?.autoReply?.allowedThreadsCount} />
          <Kv label="Cooldown" value={`${health?.autoReply?.cooldownSeconds ?? 0}s`} />
        </Section>

        {/* Worker */}
        <Section title="🔧 Worker" accent={health?.worker?.active ? "green" : "red"}>
          <Kv label="Active" value={health?.worker?.active ? "✅" : "❌"} />
          <Kv label="Queued Jobs" value={health?.worker?.queuedJobs} />
          <Kv label="Failed (24h)" value={health?.worker?.failedJobs24h} />
        </Section>

        {/* Backup */}
        <Section title="💾 Backup" accent={(health?.backup?.backupCount ?? 0) > 0 ? "green" : "yellow"}>
          <Kv label="Count" value={health?.backup?.backupCount} />
          <Kv label="Latest" value={health?.backup?.latestBackupName ?? "—"} />
          <Kv label="Age" value={health?.backup?.latestBackupAgeHours != null ? `${health.backup.latestBackupAgeHours}h` : "—"} />
        </Section>

        {/* Messages */}
        <Section title="📨 Messages (24h)">
          <Kv label="Inbound" value={health?.messages?.inbound24h} />
          <Kv label="Outbound" value={health?.messages?.outbound24h} />
          <Kv label="Last in" value={fmtTime(health?.messages?.lastInboundAt)} />
          <Kv label="Last out" value={fmtTime(health?.messages?.lastOutboundAt)} />
        </Section>

        {/* Errors */}
        <Section title="❌ Errors (24h)" accent={health?.errorsSummary?.status === "error" ? "red" : undefined}>
          <Kv label="Summary" value={health?.errorsSummary?.status ?? "—"} />
          <Kv label="Errors" value={health?.errorsSummary?.errors24h} />
          <Kv label="Warnings" value={health?.errorsSummary?.warnings24h} />
          <Kv label="Top code" value={health?.errorsSummary?.topErrorCode ?? "—"} />
        </Section>

        {/* Process Lock */}
        <Section title="🔒 Process Lock">
          <Kv label="Locked" value={health?.processLock?.locked ? "🔒 Yes" : "🔓 No"} />
          <Kv label="Owner PID" value={health?.processLock?.ownerPid ?? "—"} />
          <Kv label="This process" value={health?.processLock?.isOwner ? "✅ Owner" : "—"} />
        </Section>

        {/* Thread Review */}
        <Section title="🔍 Thread Review">
          <Kv label="Total" value={health?.allowedThreadsReview?.count} />
          <Kv label="High Risk" value={health?.allowedThreadsReview?.highRiskCount} accent="red" />
          <Kv label="Groups" value={health?.allowedThreadsReview?.groupCount} />
          <Kv label="Unknown" value={health?.allowedThreadsReview?.unknownCount} accent="yellow" />
        </Section>
      </div>

      {/* Config Check */}
      {config && (
        <div className="rounded-xl border bg-white shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-3">🔍 Config Check</h2>
          <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
            <Stat label="✅ Pass" value={config?.summary?.pass ?? 0} accent="green" />
            <Stat label="⚠️ Warn" value={config?.summary?.warn ?? 0} accent="yellow" />
            <Stat label="❌ Error" value={config?.summary?.error ?? 0} accent="red" />
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {(config?.checks ?? []).map((c, i) => (
              <div key={i} className={`text-xs p-2 rounded border ${
                c.severity === "ERROR" ? "border-red-200 bg-red-50 text-red-700" :
                c.severity === "WARN" ? "border-yellow-200 bg-yellow-50 text-yellow-700" :
                "border-green-200 bg-green-50 text-green-700"
              }`}>
                <span className="font-semibold">{c.name}</span> — {c.message}
              </div>
            ))}
            {(config?.checks ?? []).length === 0 && (
              <p className="text-sm text-slate-400">Không có config issues.</p>
            )}
          </div>
        </div>
      )}

      {/* Heartbeats */}
      <HeartbeatsSection />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function HeartbeatsSection() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { getHeartbeats().then(d => setData(d as unknown as Record<string, unknown>)).catch(() => {}); }, []);
  const hb = data as Record<string, unknown> | null;
  const items = (hb as any)?.items as any[] | undefined;

  if (!items?.length) return null;
  return (
    <div className="rounded-xl border bg-white shadow-sm p-6">
      <h2 className="text-lg font-semibold mb-3">💓 Heartbeats ({(hb as any)?.status})</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {items.map((h: any) => (
          <div key={h.name} className={`rounded-lg border p-2 text-xs ${
            h.status === "ok" ? "border-green-200 bg-green-50" :
            h.status === "stale" ? "border-yellow-200 bg-yellow-50" : "border-red-200 bg-red-50"
          }`}>
            <div className="font-semibold">{h.name}</div>
            <div className="uppercase font-bold mt-1">{h.status}</div>
            {h.ageSeconds != null && <div className="text-slate-400">{h.ageSeconds}s ago</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  const borderClass = accent === "green" ? "border-green-200" : accent === "red" ? "border-red-200" : accent === "yellow" ? "border-yellow-200" : "";
  return (
    <div className={`rounded-lg border bg-white p-4 shadow-sm ${borderClass}`}>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Kv({ label, value, accent }: { label: string; value: unknown; accent?: string }) {
  const color = accent === "red" ? "text-red-600" : accent === "green" ? "text-green-600" : "text-slate-700";
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={`font-medium ${color}`}>{String(value ?? "—")}</span>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  const bg = accent === "green" ? "bg-green-50 border-green-200" : accent === "yellow" ? "bg-yellow-50 border-yellow-200" : accent === "red" ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200";
  return (
    <div className={`rounded-lg border p-3 text-center ${bg}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
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
  return new Date(iso).toLocaleString("vi-VN");
}
