"use client";

import { useEffect, useState } from "react";
import {
  getErrorSummary,
  triggerTestAlert,
  type ErrorSummaryResponse,
} from "../../lib/api-client";
import { useToast } from "../../components/toast";

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

  if (loading && !data) {
    return <div className="flex items-center justify-center h-64"><p className="text-slate-400">Đang tải...</p></div>;
  }

  const statusColor =
    data?.status === "error" ? "bg-red-50 border-red-300 text-red-800" :
    data?.status === "warn" ? "bg-yellow-50 border-yellow-300 text-yellow-800" : "bg-green-50 border-green-300 text-green-800";

  const statusEmoji = data?.status === "error" ? "🚨" : data?.status === "warn" ? "⚠️" : "✅";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">🚨 Error Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Tổng hợp lỗi hệ thống trong {data?.windowHours ?? 24}h qua</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchData} className="px-4 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg">🔄 Làm mới</button>
          <button onClick={handleTestAlert} disabled={alerting}
            className="px-4 py-2 text-sm bg-orange-100 hover:bg-orange-200 border border-orange-300 rounded-lg disabled:opacity-50">
            {alerting ? "..." : "🧪 Test Alert"}
          </button>
        </div>
      </div>

      {/* Status */}
      <div className={`rounded-xl border p-6 shadow-sm ${statusColor}`}>
        <div className="flex items-center gap-4">
          <span className="text-3xl">{statusEmoji}</span>
          <div>
            <h2 className="text-xl font-bold uppercase">{data?.status ?? "unknown"}</h2>
            <p className="text-sm opacity-75">Window: {data?.windowHours}h</p>
          </div>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <Stat label="Errors" value={data?.totals.errors ?? 0} accent="red" />
        <Stat label="Warnings" value={data?.totals.warnings ?? 0} accent="yellow" />
        <Stat label="Failed Tasks" value={data?.totals.failedAgentTasks ?? 0} />
        <Stat label="Failed Execs" value={data?.totals.failedExecutions ?? 0} />
        <Stat label="Blocked" value={data?.totals.blockedOutbound ?? 0} />
        <Stat label="Stale HBs" value={data?.totals.staleHeartbeats ?? 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Error groups */}
        <div className="rounded-xl border bg-white shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-3">📊 Error Groups ({data?.groups?.length ?? 0})</h2>
          {data?.groups?.length ? (
            <div className="space-y-2">
              {data.groups.map((g, i) => (
                <div key={i} className={`flex items-center justify-between p-3 rounded border text-sm ${
                  g.severity === "high" ? "border-red-200 bg-red-50" :
                  g.severity === "medium" ? "border-yellow-200 bg-yellow-50" : "bg-slate-50 border-slate-200"
                }`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold flex items-center gap-2">
                      <span>{g.severity === "high" ? "🔴" : g.severity === "medium" ? "🟡" : "🟢"}</span>
                      <span>{g.source}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate">{g.errorCode}</div>
                    <div className="text-xs text-slate-400">Last: {new Date(g.lastSeenAt).toLocaleString("vi-VN")}</div>
                  </div>
                  <span className="text-lg font-bold ml-4">{g.count}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-slate-400">Không có lỗi nào. ✅</p>}
        </div>

        {/* Recent errors */}
        <div className="rounded-xl border bg-white shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-3">📋 Recent Errors ({data?.recent?.length ?? 0})</h2>
          {data?.recent?.length ? (
            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {data.recent.map((r, i) => (
                <div key={i} className="text-xs p-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className={r.severity === "high" ? "text-red-500" : r.severity === "medium" ? "text-yellow-500" : "text-slate-400"}>
                      {r.severity === "high" ? "🔴" : r.severity === "medium" ? "🟡" : "⚪"}
                    </span>
                    <span className="font-semibold">{r.source}</span>
                    <span className="text-slate-400 font-mono">{new Date(r.seenAt).toLocaleTimeString("vi-VN")}</span>
                  </div>
                  <div className="text-slate-500 mt-0.5 truncate">{r.message}</div>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-slate-400">Không có lỗi gần đây. ✅</p>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  const bg = accent === "red" ? "bg-red-50 border-red-200" : accent === "yellow" ? "bg-yellow-50 border-yellow-200" : "bg-slate-50 border-slate-200";
  return (
    <div className={`rounded-lg border p-3 text-center ${bg}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}
