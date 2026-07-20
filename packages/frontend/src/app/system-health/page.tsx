"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  getConfigCheck,
  getHealthDetail,
  getHeartbeats,
  type ConfigCheckResponse,
  type HealthDetailResponse,
  type HeartbeatsResponse,
} from "../../lib/api-client";
import {
  loadingState,
  readyState,
  unknownState,
  type RemoteDataState,
} from "../../lib/dashboard-state";
import { formatVnTime } from "../../components/ui/TimeText";

type HealthState = RemoteDataState<HealthDetailResponse>;
type ConfigState = RemoteDataState<ConfigCheckResponse>;
type HeartbeatsState = RemoteDataState<HeartbeatsResponse>;

export default function SystemHealthPage() {
  const [health, setHealth] = useState<HealthState>(() => loadingState<HealthDetailResponse>());
  const [config, setConfig] = useState<ConfigState>(() => loadingState<ConfigCheckResponse>());
  const [heartbeats, setHeartbeats] = useState<HeartbeatsState>(() => loadingState<HeartbeatsResponse>());
  const inFlight = useRef(false);
  const activeController = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);

  const refreshData = useCallback(async () => {
    if (!mounted.current || inFlight.current) return;

    const controller = new AbortController();
    const requestId = ++generation.current;
    activeController.current = controller;
    inFlight.current = true;
    const isCurrent = () =>
      mounted.current && !controller.signal.aborted && generation.current === requestId;

    try {
      const results = await Promise.allSettled([
        getHealthDetail(controller.signal),
        getConfigCheck(controller.signal),
        getHeartbeats(controller.signal),
      ]);

      if (!isCurrent()) return;
      const [healthResult, configResult, heartbeatsResult] = results;
      setHealth(
        healthResult.status === "fulfilled"
          ? readyState(healthResult.value)
          : unknownState(healthResult.reason, "Không thể tải system health"),
      );
      setConfig(
        configResult.status === "fulfilled"
          ? readyState(configResult.value)
          : unknownState(configResult.reason, "Không thể tải config check"),
      );
      setHeartbeats(
        heartbeatsResult.status === "fulfilled"
          ? readyState(heartbeatsResult.value)
          : unknownState(heartbeatsResult.reason, "Không thể tải heartbeats"),
      );
    } catch (error) {
      if (isCurrent()) {
        setHealth(unknownState(error, "Không thể tải system health"));
        setConfig(unknownState(error, "Không thể tải config check"));
        setHeartbeats(unknownState(error, "Không thể tải heartbeats"));
      }
    } finally {
      if (activeController.current === controller) {
        activeController.current = null;
        inFlight.current = false;
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshData();
    const interval = window.setInterval(() => void refreshData(), 15_000);

    return () => {
      window.clearInterval(interval);
      mounted.current = false;
      generation.current += 1;
      const controller = activeController.current;
      activeController.current = null;
      inFlight.current = false;
      controller?.abort();
    };
  }, [refreshData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">🏥 System Health</h1>
          <p className="mt-1 text-sm text-slate-400">
            Trạng thái toàn hệ thống — evidence từ API, auto-refresh mỗi 15s
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshData()}
          className="rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-600"
        >
          🔄 Làm mới
        </button>
      </div>

      <HealthStatus state={health} />
      <HealthDetails state={health} />
      <ConfigSection state={config} />
      <HeartbeatsSection state={heartbeats} />
    </div>
  );
}

function HealthStatus({ state }: { state: HealthState }) {
  if (state.status === "loading") {
    return <StatePanel title="SYSTEM HEALTH LOADING" message="Đang tải health evidence..." tone="neutral" />;
  }
  if (state.status === "unknown") {
    return <StatePanel title="SYSTEM HEALTH UNKNOWN" message={state.error} tone="error" />;
  }

  const data = state.data;
  const statusClass =
    data.status === "healthy"
      ? "border-green-700/60 bg-green-900/30 text-green-300"
      : data.status === "degraded"
        ? "border-yellow-700/60 bg-yellow-900/30 text-yellow-300"
        : "border-red-700/60 bg-red-900/30 text-red-300";
  const emoji = data.status === "healthy" ? "✅" : data.status === "degraded" ? "⚠️" : "🔴";

  return (
    <div className={"rounded-xl border p-6 " + statusClass}>
      <div className="flex items-center gap-4">
        <span className="text-3xl">{emoji}</span>
        <div>
          <h2 className="text-xl font-bold uppercase tracking-wide">{data.status}</h2>
          <p className="mt-0.5 text-sm opacity-75">
            Uptime: {formatUptime(data.uptimeSeconds)} | PID: {data.backend.pid}
          </p>
        </div>
      </div>
    </div>
  );
}

function HealthDetails({ state }: { state: HealthState }) {
  if (state.status !== "ready") {
    return <StatePanel title="HEALTH DETAILS UNKNOWN" message={state.status === "unknown" ? state.error : "Đang tải health evidence..."} tone={state.status === "unknown" ? "error" : "neutral"} />;
  }

  const health = state.data;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Section title="⚙️ Backend">
        <Kv label="PID" value={health.backend.pid} />
        <Kv label="Env" value={health.backend.nodeEnv} />
        <Kv label="Port" value={health.backend.port} />
        <Kv label="Version" value={health.version} />
      </Section>

      <Section title="🗄️ Database" accent={health.db.ok ? "green" : "red"}>
        <Kv label="Status" value={health.db.ok ? "✅ OK" : "❌ Error"} />
        <Kv label="Size" value={formatBytes(health.db.sizeBytes)} />
        {Object.entries(health.db.criticalTables).map(([name, count]) => (
          <Kv key={name} label={name} value={count === null ? "❌ Missing" : count + " rows"} />
        ))}
      </Section>

      <Section title="💬 Zalo" accent={health.zalo.connected ? "green" : "yellow"}>
        <Kv label="Connected" value={health.zalo.connected ? "✅ Yes" : "❌ No"} />
        <Kv label="UID" value={health.zalo.uid} />
        <Kv label="Last connected" value={fmtTime(health.zalo.lastConnectedAt)} />
        {health.zalo.lastError !== null && <Kv label="Error" value={health.zalo.lastError} accent="red" />}
      </Section>

      <Section title="🤖 Auto-reply">
        <Kv label="Enabled" value={health.autoReply.enabled ? "✅" : "❌"} />
        <Kv label="Dry Run" value={health.autoReply.dryRun ? "🟢 DRY" : "🔴 LIVE"} accent={health.autoReply.dryRun ? "green" : "red"} />
        <Kv label="Allowed Threads" value={health.autoReply.allowedThreadsCount} />
        <Kv label="Cooldown" value={health.autoReply.cooldownSeconds + "s"} />
      </Section>

      <Section title="🔧 Worker" accent={health.worker.active ? "green" : "red"}>
        <Kv label="Active" value={health.worker.active ? "✅" : "❌"} />
        <Kv label="Queued Jobs" value={health.worker.queuedJobs} />
        <Kv label="Failed (24h)" value={health.worker.failedJobs24h} accent={health.worker.failedJobs24h > 0 ? "red" : undefined} />
      </Section>

      <Section title="💾 Backup" accent={health.backup.backupCount > 0 ? "green" : "yellow"}>
        <Kv label="Count" value={health.backup.backupCount} />
        <Kv label="Latest" value={health.backup.latestBackupName} />
        <Kv label="Age" value={health.backup.latestBackupAgeHours === null ? null : health.backup.latestBackupAgeHours + "h"} />
      </Section>

      <Section title="📨 Messages (24h)">
        <Kv label="Inbound" value={health.messages.inbound24h} />
        <Kv label="Outbound" value={health.messages.outbound24h} />
        <Kv label="Last in" value={fmtTime(health.messages.lastInboundAt)} />
        <Kv label="Last out" value={fmtTime(health.messages.lastOutboundAt)} />
      </Section>

      <Section title="❌ Errors (24h)" accent={health.errorsSummary.status === "error" ? "red" : undefined}>
        <Kv label="Summary" value={health.errorsSummary.status} />
        <Kv label="Errors" value={health.errorsSummary.errors24h} accent={health.errorsSummary.errors24h > 0 ? "red" : undefined} />
        <Kv label="Warnings" value={health.errorsSummary.warnings24h} />
        <Kv label="Top code" value={health.errorsSummary.topErrorCode} />
      </Section>

      <Section title="🔒 Process Lock">
        <Kv label="Locked" value={health.processLock.locked ? "🔒 Yes" : "🔓 No"} />
        <Kv label="Owner PID" value={health.processLock.ownerPid} />
        <Kv label="This process" value={health.processLock.isOwner ? "✅ Owner" : "—"} />
      </Section>

      <Section title="🔍 Thread Review">
        <Kv label="Total" value={health.allowedThreadsReview.count} />
        <Kv label="High Risk" value={health.allowedThreadsReview.highRiskCount} accent={health.allowedThreadsReview.highRiskCount > 0 ? "red" : undefined} />
        <Kv label="Groups" value={health.allowedThreadsReview.groupCount} />
        <Kv label="Unknown" value={health.allowedThreadsReview.unknownCount} accent={health.allowedThreadsReview.unknownCount > 0 ? "yellow" : undefined} />
      </Section>
    </div>
  );
}

function ConfigSection({ state }: { state: ConfigState }) {
  if (state.status === "loading") {
    return <StatePanel title="CONFIG CHECK LOADING" message="Đang tải config evidence..." tone="neutral" />;
  }
  if (state.status === "unknown") {
    return <StatePanel title="CONFIG CHECK UNKNOWN" message={state.error} tone="error" />;
  }

  const config = state.data;
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-6">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">🔍 Config Check</h2>
      <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
        <Stat label="✅ Pass" value={config.summary.pass} accent="green" />
        <Stat label="⚠️ Warn" value={config.summary.warn} accent="yellow" />
        <Stat label="❌ Error" value={config.summary.error} accent="red" />
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {config.checks.map((check) => (
          <div
            key={check.name}
            className={"rounded-lg border p-2.5 text-xs " + (
              check.severity === "ERROR"
                ? "border-red-700/60 bg-red-900/20 text-red-300"
                : check.severity === "WARN"
                  ? "border-yellow-700/60 bg-yellow-900/20 text-yellow-300"
                  : "border-green-700/60 bg-green-900/20 text-green-300"
            )}
          >
            <span className="font-semibold">{check.name}</span>
            <span className="text-current/70"> — {check.message}</span>
          </div>
        ))}
        {config.checks.length === 0 && <p className="py-4 text-center text-sm text-slate-500">Không có config issues.</p>}
      </div>
    </div>
  );
}

function HeartbeatsSection({ state }: { state: HeartbeatsState }) {
  if (state.status === "loading") {
    return <StatePanel title="HEARTBEATS LOADING" message="Đang tải heartbeat evidence..." tone="neutral" />;
  }
  if (state.status === "unknown") {
    return <StatePanel title="HEARTBEATS UNKNOWN" message={state.error} tone="error" />;
  }

  const data = state.data;
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-6">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">
        💓 Heartbeats <span className="ml-2 text-sm font-normal text-slate-400">— {data.status}</span>
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {data.items.map((heartbeat) => (
            <div
              key={heartbeat.name}
              className={"rounded-lg border p-3 text-xs " + (
                heartbeat.status === "ok"
                  ? "border-green-700/60 bg-green-900/20"
                  : heartbeat.status === "stale"
                    ? "border-yellow-700/60 bg-yellow-900/20"
                    : "border-red-700/60 bg-red-900/20"
              )}
            >
              <div className="truncate font-semibold text-slate-200">{heartbeat.name}</div>
              <div className={"mt-1 text-[11px] font-bold uppercase tracking-wide " + (
                heartbeat.status === "ok"
                  ? "text-green-400"
                  : heartbeat.status === "stale"
                    ? "text-yellow-400"
                    : "text-red-400"
              )}>
                {heartbeat.status}
              </div>
              <div className="mt-0.5 text-slate-500">
                {heartbeat.ageSeconds === null ? "age unknown" : heartbeat.ageSeconds + "s ago"}
              </div>
            </div>
        ))}
      </div>
    </div>
  );
}

function StatePanel({ title, message, tone }: { title: string; message: string; tone: "neutral" | "error" }) {
  const classes = tone === "error"
    ? "border-red-700/60 bg-red-900/20 text-red-300"
    : "border-slate-700 bg-slate-900/60 text-slate-300";
  return (
    <div className={"rounded-xl border p-5 " + classes}>
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-2 text-sm">{message}</p>
    </div>
  );
}

function Section({ title, children, accent }: { title: string; children: ReactNode; accent?: string }) {
  const borderAccent =
    accent === "green"
      ? "border-l-2 border-l-green-500"
      : accent === "red"
        ? "border-l-2 border-l-red-500"
        : accent === "yellow"
          ? "border-l-2 border-l-yellow-500"
          : "";
  return (
    <div className={"rounded-lg border border-slate-700 bg-slate-800/60 p-4 " + borderAccent}>
      <h3 className="mb-3 text-sm font-semibold text-slate-300">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Kv({ label, value, accent }: { label: string; value: unknown; accent?: string }) {
  const color =
    accent === "red"
      ? "text-red-400"
      : accent === "green"
        ? "text-green-400"
        : accent === "yellow"
          ? "text-yellow-400"
          : "text-slate-200";
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={"break-all text-right font-medium " + color}>{String(value ?? "—")}</span>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  const classes =
    accent === "green"
      ? "bg-green-900/30 border-green-700/60 text-green-300"
      : accent === "yellow"
        ? "bg-yellow-900/30 border-yellow-700/60 text-yellow-300"
        : accent === "red"
          ? "bg-red-900/30 border-red-700/60 text-red-300"
          : "bg-slate-700/60 border-slate-600 text-slate-300";
  return (
    <div className={"rounded-lg border p-3 text-center " + classes}>
      <div className="text-xs opacity-75">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function formatUptime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours + "h " + minutes + "m";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function fmtTime(iso: string | null) {
  return iso === null ? "—" : formatVnTime(iso);
}
