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

export default function ProductionReadinessPage() {
  const router = useRouter();
  const [data, setData] = useState<ReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live test state
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
    } catch (e: any) {
      setError(e?.message ?? "Failed to load readiness check");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Also fetch live test status
    getLiveTestStatus().then(setLtStatus).catch(() => {});
  }, [fetchData]);

  const verdictBadge = (verdict: string) => {
    switch (verdict) {
      case "READY_FOR_LIVE":
        return (
          <span className="inline-flex items-center gap-2 rounded-full bg-green-600 px-4 py-2 text-lg font-bold text-white">
            ✅ READY FOR LIVE
          </span>
        );
      case "WARNING_ONLY":
        return (
          <span className="inline-flex items-center gap-2 rounded-full bg-yellow-600 px-4 py-2 text-lg font-bold text-white">
            ⚠️ WARNING ONLY
          </span>
        );
      case "NOT_READY":
        return (
          <span className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-lg font-bold text-white">
            🚫 NOT READY
          </span>
        );
      default:
        return <span className="text-slate-400">{verdict}</span>;
    }
  };

  const checkIcon = (status: string) => {
    switch (status) {
      case "pass": return "✅";
      case "warn": return "⚠️";
      case "fail": return "❌";
      default: return "•";
    }
  };

  const severityBorder = (severity: string) => {
    switch (severity) {
      case "critical": return "border-l-red-500";
      case "high": return "border-l-orange-500";
      case "medium": return "border-l-yellow-500";
      case "low": return "border-l-blue-500";
      default: return "border-l-slate-700";
    }
  };

  const categoryIcon = (cat: string) => {
    const icons: Record<string, string> = {
      "Zalo": "📡",
      "Safety": "🛡️",
      "Config": "⚙️",
      "Health": "💚",
      "Backup": "💾",
      "Security": "🔒",
      "Rules": "🧠",
      "Documents": "📄",
      "Errors": "🚨",
    };
    return icons[cat] ?? "📋";
  };

  const groupedChecks = (checks: ReadinessCheck[]) => {
    const groups: Record<string, ReadinessCheck[]> = {};
    for (const c of checks) {
      const cat = c.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat]!.push(c);
    }
    return groups;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-white">🚦 Production Readiness Gate</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-800" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-white">🚦 Production Readiness Gate</h2>
        <div className="rounded-lg border border-red-800 bg-red-900/30 p-6 text-center text-red-300">
          <p className="text-lg">❌ {error}</p>
          <button
            onClick={fetchData}
            className="mt-3 rounded-lg bg-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-600"
          >
            🔄 Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const groups = groupedChecks(data.checks);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-white">🚦 Production Readiness Gate</h2>
        <button
          onClick={fetchData}
          className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600"
        >
          🔄 Refresh
        </button>
      </div>

      {/* Verdict Banner */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-4">
            {verdictBadge(data.verdict)}
            <div className="text-center sm:text-left">
              <p className="text-sm text-slate-400">Score</p>
              <p className={`text-2xl font-bold ${
                data.score >= 70 ? "text-green-400" :
                data.score >= 40 ? "text-yellow-400" : "text-red-400"
              }`}>{data.score}/100</p>
            </div>
          </div>
          {data.verdict !== "NOT_READY" && (
            <button
              onClick={() => router.push("/safety-mode")}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              🔓 Go to Safety Mode →
            </button>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Checked at: {formatVnTime(data.timestamp)}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryCard label="Pass" value={data.summary.pass} color="text-green-400" icon="✅" />
        <SummaryCard label="Warn" value={data.summary.warn} color="text-yellow-400" icon="⚠️" />
        <SummaryCard label="Fail" value={data.summary.fail} color="text-red-400" icon="❌" />
        <SummaryCard label="Critical Fail" value={data.summary.criticalFail} color="text-red-500" icon="🔥" />
        <SummaryCard label="High Fail" value={data.summary.highFail} color="text-orange-400" icon="🔶" />
      </div>

      {/* Checks by Category */}
      <div className="space-y-4">
        {Object.entries(groups).map(([category, checks]) => (
          <div key={category} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <h3 className="mb-3 text-lg font-semibold text-white">
              {categoryIcon(category)} {category}
            </h3>
            <div className="space-y-2">
              {checks.map((check) => (
                <div
                  key={check.id}
                  className={`rounded border-l-4 bg-slate-800/50 p-3 ${severityBorder(check.severity)}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-sm text-white">
                        {checkIcon(check.status)} {check.label}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">{check.message}</p>
                    </div>
                    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                      check.severity === "critical" ? "bg-red-900 text-red-300" :
                      check.severity === "high" ? "bg-orange-900 text-orange-300" :
                      check.severity === "medium" ? "bg-yellow-900 text-yellow-300" :
                      "bg-blue-900 text-blue-300"
                    }`}>
                      {check.severity}
                    </span>
                  </div>
                  {check.action && (
                    <p className="mt-2 text-xs text-blue-400">💡 {check.action}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Production Pilot Runbook */}
      <div className="rounded-lg border border-blue-800 bg-blue-900/20 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">📖 Production Pilot Runbook</h3>
            <p className="mt-1 text-sm text-slate-400">
              Pre-live checklist, monitoring plan, rollback procedures, and PASS/FAIL criteria for safe production pilot.
            </p>
          </div>
          <a
            href="/api/runbook"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            📄 View Runbook →
          </a>
        </div>
      </div>

      {/* Controlled Live Test Card */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-lg font-semibold text-white">🧪 Controlled Live Test</h3>

        {/* Active Session Status */}
        {ltStatus?.active && ltStatus.session && (
          <div className="mb-4 rounded-lg border border-green-800 bg-green-900/20 p-3">
            <p className="text-sm font-medium text-green-400">
              🔴 LIVE TEST ACTIVE
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4">
              <span>Thread: <code className="text-green-300">{ltStatus.session.threadId}</code></span>
              <span>Quota: {ltStatus.session.sentCount}/{ltStatus.session.maxMessages}</span>
              <span>TTL: {Math.round(ltStatus.session.remainingMs / 1000)}s remaining</span>
              <span>Created: {new Date(ltStatus.session.createdAt).toLocaleTimeString()}</span>
            </div>
            <button
              onClick={async () => {
                setLtLoading(true);
                try {
                  await stopLiveTest();
                  setLtResult("✅ Stopped");
                  getLiveTestStatus().then(setLtStatus);
                } catch (e: any) { setLtResult(`❌ ${e?.message}`); }
                setLtLoading(false);
              }}
              className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-500"
              disabled={ltLoading}
            >
              ⏹️ Stop Live Test
            </button>
          </div>
        )}

        {/* Start Form (only when not active) */}
        {!ltStatus?.active && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text" placeholder="Thread ID"
                value={ltThreadId}
                onChange={(e) => setLtThreadId(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
              />
              <input
                type="number" placeholder="Max Messages (1-3)"
                value={ltMaxMsg} min={1} max={3}
                onChange={(e) => setLtMaxMsg(parseInt(e.target.value) || 1)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
              />
              <input
                type="number" placeholder="TTL Seconds (1-300)"
                value={ltTtl} min={1} max={300}
                onChange={(e) => setLtTtl(parseInt(e.target.value) || 120)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
              />
              <input
                type="text" placeholder="Reason (min 10 chars)"
                value={ltReason}
                onChange={(e) => setLtReason(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
              />
            </div>
            <p className="text-xs text-slate-500">
              Confirm text: <code className="text-slate-400">START LIVE TEST</code>
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
                    setLtResult(`✅ Started! Session: ${r.sessionId?.slice(-8)}, expires: ${new Date(r.expiresAt!).toLocaleTimeString()}`);
                    getLiveTestStatus().then(setLtStatus);
                  } else {
                    setLtResult(`🚫 ${r.error} (${r.errorCode})`);
                  }
                } catch (e: any) { setLtResult(`❌ ${e?.message ?? "Failed"}`); }
                setLtLoading(false);
              }}
              disabled={ltLoading || !ltThreadId.trim() || data?.verdict === "NOT_READY"}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {ltLoading ? "⏳ Starting..." : "🧪 Start Live Test"}
            </button>
            {data?.verdict === "NOT_READY" && (
              <p className="text-xs text-red-400">🚫 Cannot start: production readiness is NOT_READY</p>
            )}
            {ltResult && (
              <p className={`text-xs ${ltResult.startsWith("✅") ? "text-green-400" : "text-red-400"}`}>
                {ltResult}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center">
        <p className="text-sm text-slate-400">
          {data.verdict === "READY_FOR_LIVE"
            ? "✅ All checks passed. You can now switch to LIVE mode via Safety Mode."
            : data.verdict === "WARNING_ONLY"
              ? "⚠️ Some warnings found. Review them before switching to live. You can still proceed with caution."
              : "🚫 Critical issues found. Fix them before going live."}
        </p>
        {data.verdict !== "NOT_READY" && (
          <button
            onClick={() => router.push("/safety-mode")}
            className="mt-3 rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            🔓 Go to Safety Mode →
          </button>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color, icon }: {
  label: string;
  value: number;
  color: string;
  icon: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-center">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>
        {icon} {value}
      </p>
    </div>
  );
}
