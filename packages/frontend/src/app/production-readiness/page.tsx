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

/* ── Sub-components ──────────────────────────────────────────── */
function CheckRow({ check }: { check: ReadinessCheck }) {
  const s =
    check.status === "pass"
      ? { border: "border-green-800", bg: "bg-green-950/20", label: "PASS", labelCls: "bg-green-950 text-green-400 border-green-800" }
      : check.status === "warn"
      ? { border: "border-yellow-800", bg: "bg-yellow-950/20", label: "WARN", labelCls: "bg-yellow-950 text-yellow-400 border-yellow-800" }
      : { border: "border-red-800", bg: "bg-red-950/20", label: "FAIL", labelCls: "bg-red-950 text-red-400 border-red-800" };

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
            <span className={`inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-bold border ${s.labelCls}`}>
              {s.label}
            </span>
            <span className={`text-[10px] font-medium ${sevCls}`}>{check.severity}</span>
            <span className="text-xs text-slate-300">{check.label}</span>
          </div>
          <p className="text-[11px] text-slate-500">{check.message}</p>
        </div>
        <code className="text-[9px] text-slate-700 font-mono shrink-0">{check.id}</code>
      </div>
      {check.action && (
        <p className="mt-1 text-[10px] text-blue-400">💡 {check.action}</p>
      )}
    </div>
  );
}

function ScopeItem({ ready, label, detail }: { ready: boolean; label: string; detail: string }) {
  return (
    <div className={`rounded-md border p-3 ${
      ready
        ? "border-green-800/60 bg-green-950/30"
        : "border-slate-700 bg-slate-800/40"
    }`}>
      <div className="flex items-center gap-2 mb-0.5">
        <span className={`text-sm ${ready ? "text-green-400" : "text-slate-600"}`}>{ready ? "✓" : "–"}</span>
        <span className={`text-xs font-semibold ${ready ? "text-green-400" : "text-slate-400"}`}>{label}</span>
      </div>
      <p className="text-[11px] text-slate-500">{detail}</p>
    </div>
  );
}

function categoryIcon(cat: string) {
  const icons: Record<string, string> = {
    Zalo: "◬", Safety: "◎", Config: "⊡", Health: "◌",
    Backup: "◫", Security: "⊗", Rules: "◉", Documents: "◫", Errors: "◬",
  };
  return icons[cat] ?? "◈";
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

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const result = await getProductionReadiness();
      setData(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load readiness check");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    getLiveTestStatus().then(setLtStatus).catch(() => {});
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
        <h1 className="text-xl font-bold text-slate-100">Production Readiness</h1>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-800 border border-slate-700" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 max-w-[1400px]">
        <h1 className="text-xl font-bold text-slate-100">Production Readiness</h1>
        <div className="rounded-lg border border-red-800 bg-red-950/30 p-8 text-center">
          <p className="text-red-400 text-sm mb-3">❌ {error}</p>
          <button onClick={fetchData} className="px-4 py-2 text-sm border border-slate-700 text-slate-400 rounded-md hover:bg-slate-800 transition-colors">
            🔄 Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;
  const groups = groupedChecks(data.checks);
  const controlledDmReady = !data.checks.some((c) => c.severity === "critical" && c.status === "fail");

  const inp = "w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none";

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Production Readiness</h1>
          <p className="text-xs text-slate-500 mt-0.5">System-wide gate check — auto evaluated.</p>
        </div>
        <button onClick={fetchData} className="px-3 py-1.5 text-xs border border-slate-700 text-slate-400 rounded-md hover:bg-slate-800 transition-colors">
          🔄 Refresh
        </button>
      </div>

      {/* Scope Banner */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">Deployment Scope</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ScopeItem
            ready={controlledDmReady}
            label="Controlled DM Pilot"
            detail="SCHED1-LIVE PASS 2026-07-02 · Ready for handoff"
          />
          <ScopeItem
            ready={false}
            label="Global Production Live"
            detail="Session persistence + heartbeat stability needed"
          />
          <ScopeItem
            ready={false}
            label="Group Rollout"
            detail="Group mention pilot · group safety testing needed"
          />
        </div>
        <p className="mt-3 text-[11px] text-slate-600">
          ℹ NOT_READY = chưa đủ điều kiện global live hoặc group. Controlled DM pilot hoạt động bình thường.
        </p>
      </div>

      {/* Verdict */}
      <div className={`rounded-lg border px-5 py-4 ${
        data.verdict === "READY_FOR_LIVE" ? "border-green-800 bg-green-950/30" :
        data.verdict === "WARNING_ONLY" ? "border-yellow-800 bg-yellow-950/30" :
        "border-slate-700 bg-slate-800/50"
      }`}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
          <div className="flex items-center gap-4">
            <span className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold ${
              data.verdict === "READY_FOR_LIVE" ? "bg-green-800 text-green-200" :
              data.verdict === "WARNING_ONLY" ? "bg-yellow-800 text-yellow-200" :
              "bg-slate-700 text-slate-300"
            }`}>
              {data.verdict === "READY_FOR_LIVE" ? "✓ READY" :
               data.verdict === "WARNING_ONLY" ? "⚠ WARNING" : "– NOT READY"}
            </span>
            <div>
              <p className={`text-2xl font-bold ${
                data.score >= 70 ? "text-green-400" :
                data.score >= 40 ? "text-yellow-400" : "text-slate-400"
              }`}>{data.score}/100</p>
              <p className="text-[11px] text-slate-600">Checked: {formatVnTime(data.timestamp)}</p>
            </div>
          </div>
          {data.verdict !== "NOT_READY" && (
            <button onClick={() => router.push("/safety-mode")}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors">
              Safety Mode →
            </button>
          )}
        </div>
      </div>

      {/* Summary counts */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: "Pass", value: data.summary.pass, cls: "text-green-400 bg-green-950/30 border-green-800/60" },
          { label: "Warn", value: data.summary.warn, cls: "text-yellow-400 bg-yellow-950/30 border-yellow-800/60" },
          { label: "Fail", value: data.summary.fail, cls: "text-red-400 bg-red-950/30 border-red-800/60" },
          { label: "Critical Fail", value: data.summary.criticalFail, cls: "text-red-400 bg-red-950/40 border-red-800" },
          { label: "High Fail", value: data.summary.highFail, cls: "text-orange-400 bg-orange-950/30 border-orange-800/60" },
        ].map((item) => (
          <div key={item.label} className={`rounded-lg border p-3 text-center ${item.cls}`}>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">{item.label}</p>
            <p className="text-xl font-bold mt-0.5">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Checks by category */}
      <div className="space-y-3">
        {Object.entries(groups).map(([category, checks]) => (
          <div key={category} className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
              <span className="font-mono">{categoryIcon(category)}</span> {category}
            </p>
            <div className="space-y-1.5">
              {checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Live Test */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">Controlled Live Test</p>

        {ltStatus?.active && ltStatus.session && (
          <div className="mb-4 rounded-md border border-red-800 bg-red-950/30 p-3">
            <p className="text-sm font-semibold text-red-400">🔴 LIVE TEST ACTIVE</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-4">
              <span>Thread: <code className="text-red-400">{ltStatus.session.threadId}</code></span>
              <span>Quota: {ltStatus.session.sentCount}/{ltStatus.session.maxMessages}</span>
              <span>TTL: {Math.round(ltStatus.session.remainingMs / 1000)}s</span>
              <span>Started: {formatVnTime(ltStatus.session.createdAt)}</span>
            </div>
            <button
              onClick={async () => {
                setLtLoading(true);
                try { await stopLiveTest(); setLtResult("Stopped"); getLiveTestStatus().then(setLtStatus); }
                catch (e: unknown) { setLtResult(`Error: ${e instanceof Error ? e.message : "unknown"}`); }
                setLtLoading(false);
              }}
              disabled={ltLoading}
              className="mt-3 px-4 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50">
              ⏹ Stop Live Test
            </button>
          </div>
        )}

        {!ltStatus?.active && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input type="text" placeholder="Thread ID" value={ltThreadId}
                onChange={(e) => setLtThreadId(e.target.value)} className={inp} />
              <input type="number" placeholder="Max Messages (1-3)" value={ltMaxMsg} min={1} max={3}
                onChange={(e) => setLtMaxMsg(parseInt(e.target.value) || 1)} className={inp} />
              <input type="number" placeholder="TTL Seconds (1-300)" value={ltTtl} min={1} max={300}
                onChange={(e) => setLtTtl(parseInt(e.target.value) || 120)} className={inp} />
              <input type="text" placeholder="Lý do (min 10 chars)" value={ltReason}
                onChange={(e) => setLtReason(e.target.value)} className={inp} />
            </div>
            <p className="text-xs text-slate-600">Confirm text: <code className="text-slate-500 font-mono">START LIVE TEST</code></p>
            <button
              onClick={async () => {
                setLtLoading(true); setLtResult(null);
                try {
                  const r = await startLiveTest({ threadId: ltThreadId.trim(), maxMessages: ltMaxMsg, ttlSeconds: ltTtl, confirmText: "START LIVE TEST", reason: ltReason });
                  if (r.success) { setLtResult(`Started! Session: ${r.sessionId?.slice(-8)}`); getLiveTestStatus().then(setLtStatus); }
                  else { setLtResult(`Blocked: ${r.error} (${r.errorCode})`); }
                } catch (e: unknown) { setLtResult(`Error: ${e instanceof Error ? e.message : "unknown"}`); }
                setLtLoading(false);
              }}
              disabled={ltLoading || !ltThreadId.trim()}
              className="px-4 py-1.5 bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50">
              {ltLoading ? "Starting…" : "🧪 Start Live Test"}
            </button>
            {ltResult && (
              <p className={`text-xs ${ltResult.startsWith("Started") ? "text-green-400" : "text-red-400"}`}>{ltResult}</p>
            )}
          </div>
        )}
      </div>

      {/* Footer note */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-3 text-center">
        <p className="text-xs text-slate-600">
          {data.verdict !== "NOT_READY"
            ? "✓ Checks passed. Có thể chuyển sang Live qua Safety Mode."
            : "– Còn issue cần xử lý trước global live. Controlled DM pilot hoạt động bình thường."}
        </p>
      </div>
    </div>
  );
}
