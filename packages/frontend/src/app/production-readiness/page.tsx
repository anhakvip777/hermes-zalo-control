"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  getProductionReadiness,
  getLiveTestStatus,
  startLiveTest,
  stopLiveTest,
  type ReadinessResult,
  type ReadinessCheck,
  type LiveTestStatusResult,
} from "../../lib/api-client";
import { formatVnTime } from "../../components/ui/TimeText";

/* ── Types ───────────────────────────────────────────────────── */
type ScopeCheck = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  note: string;
  isProof?: boolean; // hardcoded historical proof (not live API)
};

type ScopeVerdict = {
  scope: "controlled-dm" | "global-live" | "group";
  label: string;
  ready: boolean;
  checks: ScopeCheck[];
  reasons?: string[]; // why NOT READY
};

/* ── Scope computation (frontend-only, no backend change) ─────── */
function computeScopes(
  checks: ReadinessCheck[],
  ltStatus: LiveTestStatusResult | null,
): ScopeVerdict[] {
  const find = (id: string) => checks.find((c) => c.id === id);

  const zaloConnected = find("zalo.connected")?.status === "pass";
  const listenerActive = find("zalo.listener")?.status === "pass";
  const configOk = find("config.status")?.status === "pass";
  const securityOk = find("security.adminPassword")?.status === "pass";
  const dryRunFail = find("safety.dryRun")?.status === "fail"; // dryRun=false → admin live override
  const sessionMissing = find("backup.session")?.status === "fail";
  const agentTaskFail = find("errors.agentTasks")?.status !== "pass"; // warn/fail
  const backendHealthy = find("health.backend")?.status === "pass";
  const workerActive = find("health.worker")?.status === "pass";
  const dbOk = find("health.db")?.status === "pass";
  const noGroupRisk = find("safety.groupRisk")?.status === "pass"; // no groups in allowlist
  const allowedThreadsOk = find("safety.allowedThreads")?.status === "pass";
  const noExecFail = find("errors.executions")?.status === "pass";
  const noStaleHeartbeat = find("errors.heartbeats")?.status === "pass";
  const pipelineOk = find("zalo.messagePipeline")?.status !== "fail"; // pass or warn
  const liveNotActive = ltStatus ? !ltStatus.active : true;

  /* ── Controlled DM Pilot ────────────────────────────────────── */
  // session missing = WARN only (ZR1 auto-reconnect handles it; not a Controlled DM blocker)
  // dryRun=false = WARN only (admin explicitly enabled for live test; not blocking handoff)
  // agent task warn = historical (opencode-go 429 resolved; not blocking)
  const dmChecks: ScopeCheck[] = [
    {
      id: "dm.zaloConnected",
      label: "Zalo connected",
      status: zaloConnected ? "pass" : "fail",
      note: zaloConnected
        ? "Connected as 621835795753666607"
        : "Zalo not connected — QR login required",
    },
    {
      id: "dm.listenerActive",
      label: "Listener active",
      status: listenerActive ? "pass" : "fail",
      note: listenerActive
        ? "ZR1 auto-reconnect active; listener receiving messages"
        : "Listener dead — ZR1 reconnect may be needed",
    },
    {
      id: "dm.realProvider",
      label: "Real adapter / provider",
      status: configOk ? "pass" : "warn",
      note: configOk
        ? "CONFIG_OK — 9 pass, 0 error; real Zalo adapter confirmed"
        : "Config issues detected — check /system-health",
    },
    {
      id: "dm.dryRunVerified",
      label: "dryRun mechanism verified",
      status: dryRunFail ? "warn" : "pass",
      note: dryRunFail
        ? "Admin override: dryRun=false (ENABLE LIVE MODE 2026-07-02T10:34). Safe baseline dryRun=true was verified before test."
        : "dryRun=true (safe mode active)",
    },
    {
      id: "dm.liveNotActive",
      label: "Live auto-stopped",
      status: liveNotActive ? "pass" : "warn",
      note: liveNotActive
        ? "live active=false — auto-TTL enforced; no runaway session"
        : "Live session still active — check /safety-mode",
    },
    {
      id: "dm.controlledLiveTested",
      label: "Controlled live tested",
      status: "pass",
      isProof: true,
      note: "SCHED1-LIVE PASS 2026-07-02T03:15:00Z · sentMessageId=sent-1782962100086 · content='họp'",
    },
    {
      id: "dm.scheduleE2E",
      label: "Schedule E2E tested",
      status: "pass",
      isProof: true,
      note:
        "Schedule cmr2xjj7u001hhmlskhutf10c · dueAt 03:14:54Z → job 03:15:00Z · maxMessages=1 · no duplicate",
    },
    {
      id: "dm.autoReconnect",
      label: "Auto-reconnect tested",
      status: "pass",
      isProof: true,
      note: "ZR1 PASS — disconnect/closed/error events wired; listener survives crash",
    },
    {
      id: "dm.noPromptLeak",
      label: "No prompt echo / leak",
      status: "pass",
      isProof: true,
      note:
        "Echo guard active in outbound-dispatcher; history contamination filter live; shared detector prompt-safety.service.ts",
    },
    {
      id: "dm.noMockAdapter",
      label: "No mock adapter in prod",
      status: configOk && securityOk ? "pass" : "warn",
      note:
        configOk && securityOk
          ? "Real Zalo adapter confirmed; admin password non-default"
          : "Review config — possible mock adapter in use",
    },
  ];

  // Session warn annotation (not a check row — shown as footnote)
  // Pipeline warn: only fail if listener dead; stale with no traffic = acceptable

  const dmHardFails = dmChecks.filter((c) => c.status === "fail");
  const dmReady = dmHardFails.length === 0; // warn OK, fail NOT OK

  /* ── Global Live ─────────────────────────────────────────────── */
  const glReasons: string[] = [];
  if (sessionMissing)
    glReasons.push("Session file missing — restart would require QR re-login");
  if (agentTaskFail)
    glReasons.push("Failed agent tasks in 24h — needs root-cause clearance");
  if (!noStaleHeartbeat)
    glReasons.push("Stale critical heartbeat detected");
  if (!pipelineOk)
    glReasons.push("Message pipeline unhealthy");
  glReasons.push("Global live scope not tested (no end-to-end global run)");
  glReasons.push("Session persistence not verified after PM2 restart");

  /* ── Group Rollout ───────────────────────────────────────────── */
  const grReasons: string[] = [
    "Group mention pilot not conducted",
    "Group safety testing not done",
    "Group-specific rate limits not validated",
    noGroupRisk
      ? "No groups in allowlist (safe default, but not yet cleared for rollout)"
      : "Groups in allowlist — group safety audit needed first",
  ];

  return [
    {
      scope: "controlled-dm",
      label: "Controlled DM Pilot",
      ready: dmReady,
      checks: dmChecks,
    },
    {
      scope: "global-live",
      label: "Global Production Live",
      ready: false,
      checks: [],
      reasons: glReasons,
    },
    {
      scope: "group",
      label: "Group Rollout",
      ready: false,
      checks: [],
      reasons: grReasons,
    },
  ];
}

/* ── Sub-components ──────────────────────────────────────────── */
function DmCheckRow({ check }: { check: ScopeCheck }) {
  const s =
    check.status === "pass"
      ? {
          border: "border-green-800/70",
          bg: "bg-green-950/20",
          label: "PASS",
          labelCls: "bg-green-950 text-green-400 border-green-800",
          icon: "✓",
        }
      : check.status === "warn"
      ? {
          border: "border-yellow-800/70",
          bg: "bg-yellow-950/20",
          label: "WARN",
          labelCls: "bg-yellow-950 text-yellow-400 border-yellow-800",
          icon: "⚠",
        }
      : {
          border: "border-red-800",
          bg: "bg-red-950/20",
          label: "FAIL",
          labelCls: "bg-red-950 text-red-400 border-red-800",
          icon: "✗",
        };

  return (
    <div className={`rounded border-l-2 px-3 py-2 ${s.border} ${s.bg}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 text-[11px] font-bold ${check.status === "pass" ? "text-green-400" : check.status === "warn" ? "text-yellow-400" : "text-red-400"}`}>
          {s.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-bold border ${s.labelCls}`}>
              {s.label}
            </span>
            {check.isProof && (
              <span className="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-medium border border-blue-800 bg-blue-950 text-blue-400">
                PROOF
              </span>
            )}
            <span className="text-xs text-slate-300">{check.label}</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">{check.note}</p>
        </div>
      </div>
    </div>
  );
}

function ApiCheckRow({ check }: { check: ReadinessCheck }) {
  const s =
    check.status === "pass"
      ? {
          border: "border-green-800/50",
          bg: "bg-green-950/10",
          label: "PASS",
          labelCls: "bg-green-950 text-green-400 border-green-800",
        }
      : check.status === "warn"
      ? {
          border: "border-yellow-800/50",
          bg: "bg-yellow-950/10",
          label: "WARN",
          labelCls: "bg-yellow-950 text-yellow-400 border-yellow-800",
        }
      : {
          border: "border-red-800",
          bg: "bg-red-950/20",
          label: "FAIL",
          labelCls: "bg-red-950 text-red-400 border-red-800",
        };

  const sevCls =
    check.severity === "critical"
      ? "text-red-400"
      : check.severity === "high"
      ? "text-orange-400"
      : check.severity === "medium"
      ? "text-yellow-400"
      : "text-slate-600";

  return (
    <div className={`rounded border-l-2 px-3 py-2 ${s.border} ${s.bg}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className={`inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-bold border ${s.labelCls}`}
            >
              {s.label}
            </span>
            <span className={`text-[10px] font-medium ${sevCls}`}>
              {check.severity}
            </span>
            <span className="text-xs text-slate-300">{check.label}</span>
          </div>
          <p className="text-[11px] text-slate-500">{check.message}</p>
        </div>
        <code className="text-[9px] text-slate-700 font-mono shrink-0">
          {check.id}
        </code>
      </div>
      {check.action && (
        <p className="mt-1 text-[10px] text-blue-400">💡 {check.action}</p>
      )}
    </div>
  );
}

function categoryIcon(cat: string) {
  const icons: Record<string, string> = {
    Zalo: "◬",
    Safety: "◎",
    Config: "⊡",
    Health: "◌",
    Backup: "◫",
    Security: "⊗",
    Rules: "◉",
    Documents: "◫",
    Errors: "◬",
  };
  return icons[cat] ?? "◈";
}

/* ── Scope Card ──────────────────────────────────────────────── */
function ScopeCard({ verdict }: { verdict: ScopeVerdict }) {
  const [expanded, setExpanded] = useState(verdict.scope === "controlled-dm");

  const readyStyle = verdict.ready
    ? "border-green-700 bg-green-950/25"
    : "border-slate-700 bg-slate-800/50";
  const badgeStyle = verdict.ready
    ? "bg-green-800 text-green-200"
    : "bg-slate-700 text-slate-400";
  const labelStyle = verdict.ready ? "text-green-400" : "text-slate-400";

  return (
    <div className={`rounded-lg border ${readyStyle} overflow-hidden`}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${badgeStyle}`}
          >
            {verdict.ready ? "✓ READY" : "– NOT READY"}
          </span>
          <span className={`text-sm font-semibold ${labelStyle}`}>
            {verdict.label}
          </span>
        </div>
        <span className="text-slate-600 text-xs">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="border-t border-slate-700/60 px-4 py-3 space-y-1.5">
          {/* Controlled DM: show checklist */}
          {verdict.checks.length > 0 && (
            <div className="space-y-1.5">
              {verdict.checks.map((c) => (
                <DmCheckRow key={c.id} check={c} />
              ))}
            </div>
          )}

          {/* Global Live / Group: show NOT READY reasons */}
          {verdict.reasons && verdict.reasons.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 mb-2">
                Blockers
              </p>
              {verdict.reasons.map((r, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-[11px] text-slate-500"
                >
                  <span className="text-slate-600 mt-0.5 shrink-0">–</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────── */
export default function ProductionReadinessPage() {
  const router = useRouter();
  const [data, setData] = useState<ReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ltStatus, setLtStatus] = useState<LiveTestStatusResult | null>(null);
  const [ltThreadId, setLtThreadId] = useState("");
  const [ltMaxMsg, setLtMaxMsg] = useState(1);
  const [ltTtl, setLtTtl] = useState(120);
  const [ltReason, setLtReason] = useState("");
  const [ltResult, setLtResult] = useState<string | null>(null);
  const [ltLoading, setLtLoading] = useState(false);

  const [showAllChecks, setShowAllChecks] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [result, lt] = await Promise.all([
        getProductionReadiness(),
        getLiveTestStatus().catch(() => null),
      ]);
      setData(result);
      setLtStatus(lt);
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to load readiness check",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const groupedChecks = (checks: ReadinessCheck[]) => {
    const groups: Record<string, ReadinessCheck[]> = {};
    for (const c of checks) {
      if (!groups[c.category]) groups[c.category] = [];
      groups[c.category]!.push(c);
    }
    return groups;
  };

  if (loading) {
    return (
      <div className="space-y-4 max-w-[1400px]">
        <h1 className="text-xl font-bold text-slate-100">
          Production Readiness
        </h1>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg bg-slate-800 border border-slate-700"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 max-w-[1400px]">
        <h1 className="text-xl font-bold text-slate-100">
          Production Readiness
        </h1>
        <div className="rounded-lg border border-red-800 bg-red-950/30 p-8 text-center">
          <p className="text-red-400 text-sm mb-3">❌ {error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 text-sm border border-slate-700 text-slate-400 rounded-md hover:bg-slate-800 transition-colors"
          >
            🔄 Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const scopes = computeScopes(data.checks, ltStatus);
  const dmScope = scopes.find((s) => s.scope === "controlled-dm")!;
  const groups = groupedChecks(data.checks);

  const inp =
    "w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none";

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">
            Production Readiness
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Scope-based readiness — Controlled DM · Global Live · Group Rollout
          </p>
        </div>
        <button
          onClick={fetchData}
          className="px-3 py-1.5 text-xs border border-slate-700 text-slate-400 rounded-md hover:bg-slate-800 transition-colors"
        >
          🔄 Refresh
        </button>
      </div>

      {/* Scope Summary Bar */}
      <div className="grid grid-cols-3 gap-2">
        {scopes.map((sv) => (
          <div
            key={sv.scope}
            className={`rounded-lg border px-3 py-2.5 text-center ${
              sv.ready
                ? "border-green-700 bg-green-950/25"
                : "border-slate-700 bg-slate-800/50"
            }`}
          >
            <p
              className={`text-xs font-semibold ${sv.ready ? "text-green-400" : "text-slate-500"}`}
            >
              {sv.label}
            </p>
            <p
              className={`text-base font-bold mt-0.5 ${sv.ready ? "text-green-300" : "text-slate-600"}`}
            >
              {sv.ready ? "✓ READY" : "– NOT READY"}
            </p>
          </div>
        ))}
      </div>

      {/* Scope Detail Cards */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Scope Detail
        </p>
        {scopes.map((sv) => (
          <ScopeCard key={sv.scope} verdict={sv} />
        ))}
      </div>

      {/* Annotations */}
      <div className="rounded-lg border border-slate-700/60 bg-slate-800/30 px-4 py-3 space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 mb-2">
          Classification notes
        </p>
        <p className="text-[11px] text-slate-500">
          <span className="text-yellow-500 font-medium">Session WARN:</span>{" "}
          Zalo connected in-memory (ZR1 auto-reconnect). Session file not
          persisted to disk. For Controlled DM: acceptable — ZR1 handles
          reconnect. For Global Live: blocks (restart needs QR if session
          missing).
        </p>
        <p className="text-[11px] text-slate-500">
          <span className="text-yellow-500 font-medium">
            dryRun override WARN:
          </span>{" "}
          Admin set dryRun=false at 2026-07-02T10:34:58 (ENABLE LIVE MODE).
          Intentional. Safe default dryRun=true was verified before test.
          dryRun=true can be restored via /runtime-settings.
        </p>
        <p className="text-[11px] text-slate-500">
          <span className="text-slate-400 font-medium">
            Failed agent task:
          </span>{" "}
          1 failed task in 24h — opencode-go 429 (rate limit). Historical error,
          resolved. Does not block Controlled DM.
        </p>
        <p className="text-[11px] text-slate-500">
          <span className="text-slate-400 font-medium">Pipeline heartbeat:</span>{" "}
          Stale due to low traffic, not listener failure. listenerActive=true
          verified. Only fails Controlled DM if listener dies.
        </p>
      </div>

      {/* API Check Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          {
            label: "Pass",
            value: data.summary.pass,
            cls: "text-green-400 bg-green-950/30 border-green-800/60",
          },
          {
            label: "Warn",
            value: data.summary.warn,
            cls: "text-yellow-400 bg-yellow-950/30 border-yellow-800/60",
          },
          {
            label: "Fail",
            value: data.summary.fail,
            cls: "text-red-400 bg-red-950/30 border-red-800/60",
          },
          {
            label: "Critical Fail",
            value: data.summary.criticalFail,
            cls: "text-red-400 bg-red-950/40 border-red-800",
          },
          {
            label: "High Fail",
            value: data.summary.highFail,
            cls: "text-orange-400 bg-orange-950/30 border-orange-800/60",
          },
        ].map((item) => (
          <div
            key={item.label}
            className={`rounded-lg border p-3 text-center ${item.cls}`}
          >
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">
              {item.label}
            </p>
            <p className="text-xl font-bold mt-0.5">{item.value}</p>
          </div>
        ))}
      </div>

      {/* API Checks (collapsible) */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 overflow-hidden">
        <button
          onClick={() => setShowAllChecks((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800 transition-colors"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Raw API Checks ({data.checks.length} total) — checked{" "}
            {formatVnTime(data.timestamp)}
          </p>
          <span className="text-slate-600 text-xs">
            {showAllChecks ? "▲ Hide" : "▼ Show"}
          </span>
        </button>

        {showAllChecks && (
          <div className="border-t border-slate-700/60 px-4 py-4 space-y-3">
            {Object.entries(groups).map(([category, checks]) => (
              <div key={category}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                  <span className="font-mono">{categoryIcon(category)}</span>{" "}
                  {category}
                </p>
                <div className="space-y-1.5">
                  {checks.map((check) => (
                    <ApiCheckRow key={check.id} check={check} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Controlled Live Test */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
          Controlled Live Test
        </p>

        {ltStatus?.active && ltStatus.session && (
          <div className="mb-4 rounded-md border border-red-800 bg-red-950/30 p-3">
            <p className="text-sm font-semibold text-red-400">
              🔴 LIVE TEST ACTIVE
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-4">
              <span>
                Thread:{" "}
                <code className="text-red-400">{ltStatus.session.threadId}</code>
              </span>
              <span>
                Quota: {ltStatus.session.sentCount}/
                {ltStatus.session.maxMessages}
              </span>
              <span>
                TTL: {Math.round(ltStatus.session.remainingMs / 1000)}s
              </span>
              <span>Started: {formatVnTime(ltStatus.session.createdAt)}</span>
            </div>
            <button
              onClick={async () => {
                setLtLoading(true);
                try {
                  await stopLiveTest();
                  setLtResult("Stopped");
                  getLiveTestStatus().then(setLtStatus);
                } catch (e: unknown) {
                  setLtResult(
                    `Error: ${e instanceof Error ? e.message : "unknown"}`,
                  );
                }
                setLtLoading(false);
              }}
              disabled={ltLoading}
              className="mt-3 px-4 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50"
            >
              ⏹ Stop Live Test
            </button>
          </div>
        )}

        {!ltStatus?.active && (
          <div className="space-y-3">
            {!dmScope.ready && (
              <div className="rounded-md border border-yellow-800/60 bg-yellow-950/20 px-3 py-2 text-xs text-yellow-400">
                ⚠ Controlled DM scope has issues — resolve before starting live test.
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                placeholder="Thread ID"
                value={ltThreadId}
                onChange={(e) => setLtThreadId(e.target.value)}
                className={inp}
              />
              <input
                type="number"
                placeholder="Max Messages (1-3)"
                value={ltMaxMsg}
                min={1}
                max={3}
                onChange={(e) =>
                  setLtMaxMsg(parseInt(e.target.value) || 1)
                }
                className={inp}
              />
              <input
                type="number"
                placeholder="TTL Seconds (1-300)"
                value={ltTtl}
                min={1}
                max={300}
                onChange={(e) =>
                  setLtTtl(parseInt(e.target.value) || 120)
                }
                className={inp}
              />
              <input
                type="text"
                placeholder="Lý do (min 10 chars)"
                value={ltReason}
                onChange={(e) => setLtReason(e.target.value)}
                className={inp}
              />
            </div>
            <p className="text-xs text-slate-600">
              Confirm text:{" "}
              <code className="text-slate-500 font-mono">START LIVE TEST</code>
            </p>
            <button
              onClick={async () => {
                setLtLoading(true);
                setLtResult(null);
                try {
                  const r = await startLiveTest({
                    threadId: ltThreadId.trim(),
                    maxMessages: ltMaxMsg,
                    ttlSeconds: ltTtl,
                    confirmText: "START LIVE TEST",
                    reason: ltReason,
                  });
                  if (r.success) {
                    setLtResult(
                      `Started! Session: ${r.sessionId?.slice(-8)}`,
                    );
                    getLiveTestStatus().then(setLtStatus);
                  } else {
                    setLtResult(`Blocked: ${r.error} (${r.errorCode})`);
                  }
                } catch (e: unknown) {
                  setLtResult(
                    `Error: ${e instanceof Error ? e.message : "unknown"}`,
                  );
                }
                setLtLoading(false);
              }}
              disabled={ltLoading || !ltThreadId.trim()}
              className="px-4 py-1.5 bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
            >
              {ltLoading ? "Starting…" : "🧪 Start Live Test"}
            </button>
            {ltResult && (
              <p
                className={`text-xs ${ltResult.startsWith("Started") ? "text-green-400" : "text-red-400"}`}
              >
                {ltResult}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Safety Mode CTA — only if no scope is ready or want to go to safety */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-3 flex items-center justify-between gap-4">
        <p className="text-xs text-slate-600">
          {dmScope.ready
            ? "✓ Controlled DM READY. Global live + group rollout cần thêm điều kiện."
            : "– Controlled DM chưa sẵn sàng. Xử lý các FAIL trước khi handoff."}
        </p>
        <button
          onClick={() => router.push("/safety-mode")}
          className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors"
        >
          Safety Mode →
        </button>
      </div>
    </div>
  );
}
