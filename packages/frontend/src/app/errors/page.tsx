"use client";

import { useEffect, useState } from "react";
import {
  getErrorSummary,
  triggerTestAlert,
  type ErrorSummaryResponse,
} from "../../lib/api-client";
import { useToast } from "../../components/toast";
import {
  Card,
  PageHeader,
  LoadingSpinner,
  DarkButton,
  StatCard,
  StatusPill,
  SectionLabel,
  SeverityPill,
} from "../../components/ui/dark";

export default function ErrorsPage() {
  const [data, setData] = useState<ErrorSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [alerting, setAlerting] = useState(false);
  const { toast } = useToast();

  const fetchData = () => {
    setLoading(true);
    getErrorSummary(24)
      .then(setData)
      .catch(() => toast("Failed to load errors", "error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleTestAlert = async () => {
    setAlerting(true);
    try {
      const r = await triggerTestAlert();
      if (r.dryRun) toast("✅ Test alert (dry-run) recorded", "success");
      else toast("⚠️ Alert sent live!", "error");
    } catch { toast("Alert failed", "error"); }
    finally { setAlerting(false); }
  };

  if (loading && !data) return <LoadingSpinner />;

  const statusVariant =
    data?.status === "error" ? "failed" : data?.status === "warn" ? "warn" : "active";

  const statusBanner = data?.status === "error"
    ? "border-red-700/60 bg-red-900/20"
    : data?.status === "warn"
      ? "border-yellow-700/60 bg-yellow-900/20"
      : "border-green-700/60 bg-green-900/20";

  const statusEmoji = data?.status === "error" ? "🚨" : data?.status === "warn" ? "⚠️" : "✅";

  return (
    <div className="space-y-6">
      <PageHeader
        title="🚨 Error Dashboard"
        subtitle={`Tổng hợp lỗi hệ thống trong ${data?.windowHours ?? 24}h qua`}
        onRefresh={fetchData}
      >
        <DarkButton variant="warn" size="sm" onClick={handleTestAlert} disabled={alerting}>
          {alerting ? "..." : "🧪 Test Alert"}
        </DarkButton>
      </PageHeader>

      {/* Status banner */}
      <div className={`rounded-xl border p-6 ${statusBanner}`}>
        <div className="flex items-center gap-4">
          <span className="text-3xl">{statusEmoji}</span>
          <div>
            <h2 className="text-xl font-bold uppercase text-slate-100">{data?.status ?? "unknown"}</h2>
            <p className="text-sm text-slate-400">Window: {data?.windowHours}h</p>
          </div>
          <div className="ml-auto">
            <StatusPill variant={statusVariant as "failed" | "warn" | "active"}>
              {(data?.status ?? "unknown").toUpperCase()}
            </StatusPill>
          </div>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <StatCard label="Errors" value={data?.totals.errors ?? 0} accent={data?.totals.errors ? "red" : undefined} />
        <StatCard label="Warnings" value={data?.totals.warnings ?? 0} accent={data?.totals.warnings ? "yellow" : undefined} />
        <StatCard label="Failed Tasks" value={data?.totals.failedAgentTasks ?? 0} />
        <StatCard label="Failed Execs" value={data?.totals.failedExecutions ?? 0} />
        <StatCard label="Blocked" value={data?.totals.blockedOutbound ?? 0} />
        <StatCard label="Stale HBs" value={data?.totals.staleHeartbeats ?? 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Error groups */}
        <Card>
          <h2 className="text-lg font-semibold text-slate-100 mb-3">📊 Error Groups ({data?.groups?.length ?? 0})</h2>
          {data?.groups?.length ? (
            <div className="space-y-2">
              {data.groups.map((g, i) => (
                <div key={i} className={`flex items-center justify-between p-3 rounded-lg border text-sm ${
                  g.severity === "high" ? "border-red-700/50 bg-red-900/20" :
                  g.severity === "medium" ? "border-yellow-700/50 bg-yellow-900/20" :
                  "border-slate-700 bg-slate-800/60"
                }`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <SeverityPill severity={g.severity} />
                      <span className="text-slate-200 font-medium">{g.source}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate">{g.errorCode}</div>
                    <div className="text-xs text-slate-600">Last: {new Date(g.lastSeenAt).toLocaleString("vi-VN")}</div>
                  </div>
                  <span className="text-lg font-bold text-slate-200 ml-4 shrink-0">{g.count}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-green-400">Không có lỗi nào. ✅</p>}
        </Card>

        {/* Recent errors */}
        <Card>
          <h2 className="text-lg font-semibold text-slate-100 mb-3">📋 Recent Errors ({data?.recent?.length ?? 0})</h2>
          {data?.recent?.length ? (
            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {data.recent.map((r, i) => (
                <div key={i} className="text-xs p-2 border-b border-slate-700/50">
                  <div className="flex items-center gap-2">
                    <span className={r.severity === "high" ? "text-red-400" : r.severity === "medium" ? "text-yellow-400" : "text-slate-600"}>
                      {r.severity === "high" ? "🔴" : r.severity === "medium" ? "🟡" : "⚪"}
                    </span>
                    <span className="font-semibold text-slate-300">{r.source}</span>
                    <span className="text-slate-500 font-mono">{new Date(r.seenAt).toLocaleTimeString("vi-VN")}</span>
                  </div>
                  <div className="text-slate-500 mt-0.5 truncate">{r.message}</div>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-green-400">Không có lỗi gần đây. ✅</p>}
        </Card>
      </div>
    </div>
  );
}
