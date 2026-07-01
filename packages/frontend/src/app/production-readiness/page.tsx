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
    getLiveTestStatus().then(setLtStatus).catch(() => {});
  }, [fetchData]);

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
        <h2 className="text-xl font-bold text-slate-800">🚦 Production Readiness Gate</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-100 border border-slate-200" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-800">🚦 Production Readiness Gate</h2>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-700">
          <p>❌ {error}</p>
          <button onClick={fetchData} className="mt-3 rounded-lg bg-slate-100 border border-slate-200 px-4 py-2 text-sm hover:bg-slate-200">
            🔄 Thử lại
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const groups = groupedChecks(data.checks);

  // Determine scope status
  const hasSessionFail = data.checks.some(c => c.id === "backup.session" && c.status === "fail");
  const hasHeartbeatWarn = data.checks.some(c => c.id === "errors.heartbeats" && c.status === "warn");
  const controlledDmReady = !data.checks.some(c => c.severity === "critical" && c.status === "fail");

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Production Readiness Gate</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Kiểm tra sẵn sàng production — tự động đánh giá toàn bộ hệ thống.
          </p>
        </div>
        <button onClick={fetchData} className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200 transition-colors">
          🔄 Làm mới
        </button>
      </div>

      {/* ═══ Scope Banner ═══ */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h3 className="text-sm font-semibold text-blue-800 mb-2">📋 Phạm vi đánh giá</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <ScopeItem
            ready={true}
            label="Controlled DM Pilot"
            detail="3/3 pilots PASS · 7 real sends · Đã sẵn sàng bàn giao"
          />
          <ScopeItem
            ready={false}
            label="Global Production Live"
            detail="Cần session persistence + heartbeat monitoring ổn định"
          />
          <ScopeItem
            ready={false}
            label="Group Rollout"
            detail="Chưa có group mention pilot · Chưa test group safety"
          />
        </div>
        <p className="mt-3 text-[11px] text-blue-600">
          ⚠️ Trang này đánh giá toàn bộ hệ thống. NOT_READY nghĩa là chưa sẵn sàng chạy <strong>global live</strong> hoặc <strong>group</strong>. Controlled DM pilot vẫn hoạt động bình thường.
        </p>
      </div>

      {/* Verdict Banner */}
      <div className={`rounded-lg border p-5 ${
        data.verdict === "READY_FOR_LIVE" ? "border-green-200 bg-green-50" :
        data.verdict === "WARNING_ONLY" ? "border-yellow-200 bg-yellow-50" :
        "border-red-200 bg-red-50"
      }`}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:justify-between">
          <div className="flex items-center gap-4">
            <span className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ${
              data.verdict === "READY_FOR_LIVE" ? "bg-green-600 text-white" :
              data.verdict === "WARNING_ONLY" ? "bg-yellow-600 text-white" :
              "bg-red-600 text-white"
            }`}>
              {data.verdict === "READY_FOR_LIVE" ? "✅ READY" :
               data.verdict === "WARNING_ONLY" ? "⚠️ WARNING" : "🚫 NOT READY"}
            </span>
            <div>
              <p className={`text-2xl font-bold ${
                data.score >= 70 ? "text-green-700" :
                data.score >= 40 ? "text-yellow-700" : "text-red-700"
              }`}>{data.score}/100</p>
              <p className="text-[11px] text-slate-500">Kiểm tra lúc: {formatVnTime(data.timestamp)}</p>
            </div>
          </div>
          {data.verdict !== "NOT_READY" && (
            <button onClick={() => router.push("/safety-mode")}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
              🔓 Đến Safety Mode →
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <SummaryCard label="✅ Pass" value={data.summary.pass} color="green" />
        <SummaryCard label="⚠️ Warn" value={data.summary.warn} color="yellow" />
        <SummaryCard label="❌ Fail" value={data.summary.fail} color="red" />
        <SummaryCard label="🔥 Critical Fail" value={data.summary.criticalFail} color="red" />
        <SummaryCard label="🔶 High Fail" value={data.summary.highFail} color="orange" />
      </div>

      {/* Checks by Category */}
      <div className="space-y-4">
        {Object.entries(groups).map(([category, checks]) => (
          <div key={category} className="rounded-lg border border-slate-200 bg-white shadow-card p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              {categoryIcon(category)} {category}
            </h3>
            <div className="space-y-1.5">
              {checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Controlled Live Test Card */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-card p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">🧪 Controlled Live Test</h3>

        {ltStatus?.active && ltStatus.session && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3">
            <p className="text-sm font-medium text-green-700">🔴 LIVE TEST ACTIVE</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-4">
              <span>Thread: <code className="text-green-700">{ltStatus.session.threadId}</code></span>
              <span>Quota: {ltStatus.session.sentCount}/{ltStatus.session.maxMessages}</span>
              <span>TTL: {Math.round(ltStatus.session.remainingMs / 1000)}s còn lại</span>
              <span>Tạo lúc: {formatVnTime(ltStatus.session.createdAt)}</span>
            </div>
            <button
              onClick={async () => {
                setLtLoading(true);
                try { await stopLiveTest(); setLtResult("✅ Đã dừng"); getLiveTestStatus().then(setLtStatus); }
                catch (e: any) { setLtResult(`❌ ${e?.message}`); }
                setLtLoading(false);
              }}
              className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-500"
              disabled={ltLoading}>
              ⏹️ Stop Live Test
            </button>
          </div>
        )}

        {!ltStatus?.active && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input type="text" placeholder="Thread ID" value={ltThreadId}
                onChange={(e) => setLtThreadId(e.target.value)}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
              <input type="number" placeholder="Max Messages (1-3)" value={ltMaxMsg} min={1} max={3}
                onChange={(e) => setLtMaxMsg(parseInt(e.target.value) || 1)}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
              <input type="number" placeholder="TTL Seconds (1-300)" value={ltTtl} min={1} max={300}
                onChange={(e) => setLtTtl(parseInt(e.target.value) || 120)}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
              <input type="text" placeholder="Lý do (tối thiểu 10 ký tự)" value={ltReason}
                onChange={(e) => setLtReason(e.target.value)}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
            </div>
            <p className="text-xs text-slate-500">Confirm text: <code className="text-slate-600">START LIVE TEST</code></p>
            <button
              onClick={async () => {
                setLtLoading(true); setLtResult(null);
                try {
                  const r = await startLiveTest({ threadId: ltThreadId.trim(), maxMessages: ltMaxMsg, ttlSeconds: ltTtl, confirmText: "START LIVE TEST", reason: ltReason });
                  if (r.success) { setLtResult(`✅ Đã bắt đầu! Session: ${r.sessionId?.slice(-8)}`); getLiveTestStatus().then(setLtStatus); }
                  else { setLtResult(`🚫 ${r.error} (${r.errorCode})`); }
                } catch (e: any) { setLtResult(`❌ ${e?.message ?? "Failed"}`); }
                setLtLoading(false);
              }}
              disabled={ltLoading || !ltThreadId.trim()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50">
              {ltLoading ? "⏳ Đang bắt đầu..." : "🧪 Start Live Test"}
            </button>
            {ltResult && (
              <p className={`text-xs ${ltResult.startsWith("✅") ? "text-green-600" : "text-red-600"}`}>{ltResult}</p>
            )}
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-card p-4 text-center">
        <p className="text-xs text-slate-500">
          {data.verdict === "READY_FOR_LIVE"
            ? "✅ Tất cả kiểm tra đã pass. Có thể chuyển sang LIVE mode qua Safety Mode."
            : "⚠️ Còn issue cần xử lý trước khi bật global live. Controlled DM pilot vẫn hoạt động bình thường."}
        </p>
        {data.verdict !== "NOT_READY" && (
          <button onClick={() => router.push("/safety-mode")}
            className="mt-3 rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-500">
            🔓 Đến Safety Mode →
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════

function CheckRow({ check }: { check: ReadinessCheck }) {
  const statusStyle = check.status === "pass"
    ? { row: "border-l-green-400 bg-green-50/30", icon: "✅", label: "PASS", labelColor: "bg-green-100 text-green-700" }
    : check.status === "warn"
      ? { row: "border-l-yellow-400 bg-yellow-50/30", icon: "⚠️", label: "WARN", labelColor: "bg-yellow-100 text-yellow-700" }
      : { row: "border-l-red-400 bg-red-50/30", icon: "❌", label: "FAIL", labelColor: "bg-red-100 text-red-700" };

  const sevColor = check.severity === "critical" ? "text-red-600 bg-red-50" :
    check.severity === "high" ? "text-orange-600 bg-orange-50" :
    check.severity === "medium" ? "text-yellow-600 bg-yellow-50" :
    "text-slate-500 bg-slate-100";

  return (
    <div className={`rounded border-l-4 p-2.5 ${statusStyle.row}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
            <span>{statusStyle.icon}</span>
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border border-slate-200 ml-0.5">
              <span className={statusStyle.labelColor + " rounded px-1 py-0"}>{statusStyle.label}</span>
            </span>
            {check.label}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">{check.message}</p>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${sevColor}`}>
          {check.severity}
        </span>
      </div>
      {check.action && (
        <p className="mt-1.5 text-[10px] text-blue-600">💡 {check.action}</p>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  const bgColor = color === "green" ? "bg-green-50 border-green-200" :
    color === "yellow" ? "bg-yellow-50 border-yellow-200" :
    color === "red" ? "bg-red-50 border-red-200" :
    "bg-orange-50 border-orange-200";
  const textColor = color === "green" ? "text-green-700" :
    color === "yellow" ? "text-yellow-700" :
    color === "red" ? "text-red-700" : "text-orange-700";

  return (
    <div className={`rounded-lg border p-3 text-center ${bgColor}`}>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${textColor}`}>{value}</p>
    </div>
  );
}

function ScopeItem({ ready, label, detail }: { ready: boolean; label: string; detail: string }) {
  return (
    <div className={`rounded-md border p-2.5 ${ready ? "border-green-200 bg-green-50/60" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span>{ready ? "✅" : "⏸️"}</span>
        <span className={`text-xs font-semibold ${ready ? "text-green-700" : "text-slate-500"}`}>{label}</span>
      </div>
      <p className="text-[10px] text-slate-400">{detail}</p>
    </div>
  );
}

function categoryIcon(cat: string) {
  const icons: Record<string, string> = {
    Zalo: "📡", Safety: "🛡️", Config: "⚙️", Health: "💚",
    Backup: "💾", Security: "🔒", Rules: "🧠", Documents: "📄", Errors: "🚨",
  };
  return icons[cat] ?? "📋";
}
