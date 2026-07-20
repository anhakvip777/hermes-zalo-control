"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatVnTime } from "../../components/ui/TimeText";
import {
  getProductionReadiness,
  type ReadinessCheck,
  type ReadinessResult,
} from "../../lib/api-client";

const CATEGORY_ORDER = ["Zalo", "Safety", "Config", "Health", "Backup", "Security", "Rules", "Documents", "Errors"];

export default function ProductionReadinessPage() {
  const [data, setData] = useState<ReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getProductionReadiness());
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Không thể tải production readiness");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const groups = useMemo(() => {
    const grouped = new Map<string, ReadinessCheck[]>();
    for (const check of data?.checks ?? []) {
      const values = grouped.get(check.category) ?? [];
      values.push(check);
      grouped.set(check.category, values);
    }
    return [...grouped.entries()].sort((a, b) => {
      const left = CATEGORY_ORDER.indexOf(a[0]);
      const right = CATEGORY_ORDER.indexOf(b[0]);
      return (left < 0 ? 999 : left) - (right < 0 ? 999 : right);
    });
  }, [data]);

  return (
    <div className="space-y-5 max-w-[1400px]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Production Readiness</h1>
          <p className="text-xs text-slate-500 mt-0.5">Status-only, fail-closed view of the backend readiness contract.</p>
        </div>
        <button onClick={() => void refresh()} disabled={loading} className="px-3 py-1.5 text-xs border border-slate-700 text-slate-400 rounded-md hover:bg-slate-800 disabled:opacity-50">🔄 Refresh</button>
      </div>

      <div className="rounded-md border border-blue-800 bg-blue-950/30 px-4 py-3 text-sm text-blue-300">
        Start/Stop Live Test đã bị gỡ khỏi dashboard remediation. Trang này không phát request mutation.
      </div>

      {loading && !data && <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-8 text-sm text-slate-400">Đang tải readiness…</div>}
      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 text-sm text-red-300">Readiness UNKNOWN — {error}</div>}

      {data && (
        <>
          <div className={`rounded-lg border p-5 ${
            data.verdict === "READY_FOR_LIVE" && data.dataQuality === "complete"
              ? "border-green-800 bg-green-950/20"
              : "border-red-800 bg-red-950/20"
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Backend verdict</p>
                <p className={`mt-1 text-lg font-bold ${data.verdict === "READY_FOR_LIVE" && data.dataQuality === "complete" ? "text-green-400" : "text-red-400"}`}>{data.verdict}</p>
                <p className="mt-1 text-xs text-slate-500">Checked {formatVnTime(data.timestamp)}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Data quality</p>
                <p className={`mt-1 text-sm font-semibold ${data.dataQuality === "complete" ? "text-green-400" : "text-red-400"}`}>{data.dataQuality.toUpperCase()}</p>
                <p className="mt-1 text-xs text-slate-500">Score: {data.score === null ? "UNKNOWN" : data.score}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <SummaryCard label="Pass" value={data.summary.pass} cls="text-green-400 border-green-800/60 bg-green-950/20" />
            <SummaryCard label="Warn" value={data.summary.warn} cls="text-yellow-400 border-yellow-800/60 bg-yellow-950/20" />
            <SummaryCard label="Fail" value={data.summary.fail} cls="text-red-400 border-red-800/60 bg-red-950/20" />
            <SummaryCard label="Unknown" value={data.summary.unknown} cls="text-slate-300 border-slate-700 bg-slate-900/60" />
            <SummaryCard label="Critical" value={data.summary.criticalFail} cls="text-red-400 border-red-800 bg-red-950/30" />
            <SummaryCard label="High" value={data.summary.highFail} cls="text-orange-400 border-orange-800/60 bg-orange-950/20" />
          </div>

          <div className="space-y-4">
            {groups.map(([category, checks]) => (
              <section key={category} className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">{category}</h2>
                <div className="space-y-2">
                  {checks.map((check) => <CheckRow key={check.id} check={check} />)}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, cls }: { label: string; value: number; cls: string }) {
  return <div className={`rounded-lg border p-3 text-center ${cls}`}><p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p><p className="text-xl font-bold mt-1">{value}</p></div>;
}

function CheckRow({ check }: { check: ReadinessCheck }) {
  const styles = {
    pass: { label: "PASS", cls: "border-green-800/60 bg-green-950/15 text-green-400" },
    warn: { label: "WARN", cls: "border-yellow-800/60 bg-yellow-950/15 text-yellow-400" },
    fail: { label: "FAIL", cls: "border-red-800/60 bg-red-950/20 text-red-400" },
    unknown: { label: "UNKNOWN", cls: "border-slate-700 bg-slate-900/60 text-slate-300" },
  }[check.status];

  return (
    <div className={`rounded-md border p-3 ${styles.cls}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold">{styles.label}</span>
            <span className="text-xs text-slate-200">{check.label}</span>
            <span className="text-[10px] text-slate-500">{check.severity}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">{check.message}</p>
          {check.action && <p className="mt-1 text-[11px] text-blue-300">{check.action}</p>}
        </div>
        <code className="text-[9px] text-slate-600">{check.id}</code>
      </div>
    </div>
  );
}
