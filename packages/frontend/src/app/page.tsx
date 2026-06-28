"use client";

import { useEffect, useState } from "react";
import {
  listSchedules,
  listAllExecutions,
  type Schedule,
  type ScheduleExecution,
} from "../lib/api-client";
import { GlobalBanner } from "../components/global-banner";
import { StatusBadge } from "../components/status-badge";

export default function DashboardPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [executions, setExecutions] = useState<ScheduleExecution[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = () => {
    setLoading(true);
    Promise.all([
      listSchedules({ pageSize: "100" }),
      listAllExecutions({ pageSize: "20" }),
    ])
      .then(([sData, eData]) => {
        setSchedules(sData.data);
        setExecutions(eData.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 15_000);
    return () => clearInterval(interval);
  }, []);

  const activeCount = schedules.filter((s) => s.status === "active").length;
  const scheduledCount = schedules.filter(
    (s) => s.status === "scheduled" && s.nextRunAt,
  ).length;
  const failedCount = executions.filter((e) => e.status === "failed").length;
  const successCount = executions.filter((e) => e.status === "success").length;

  const stats = [
    { label: "Active Schedules", value: activeCount },
    { label: "Scheduled (upcoming)", value: scheduledCount },
    { label: "Recent Failures", value: failedCount },
    { label: "Recent Successes", value: successCount },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight text-white">Dashboard</h2>

      <GlobalBanner />

      {loading && stats.every((s) => s.value === 0) ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-800" />
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-lg border border-slate-800 bg-slate-900 p-4"
              >
                <p className="text-sm text-slate-400">{s.label}</p>
                <p className="mt-1 text-2xl font-bold text-white">{s.value}</p>
              </div>
            ))}
          </div>

          <div>
            <h3 className="mb-2 text-lg font-semibold text-white">
              Recent Executions
            </h3>
            {executions.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-500">
                No executions yet
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900 text-left text-xs text-slate-300">
                    <tr>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Mode</th>
                      <th className="px-3 py-2">Target</th>
                      <th className="px-3 py-2">Content</th>
                      <th className="px-3 py-2">Finished</th>
                      <th className="px-3 py-2">Msg ID</th>
                      <th className="px-3 py-2">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executions.map((e) => (
                      <tr
                        key={e.id}
                        className="border-t border-slate-800 text-slate-200 hover:bg-slate-800/50"
                      >
                        <td className="px-3 py-2">
                          <StatusBadge status={e.status} />
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-400">{e.mode}</td>
                        <td className="max-w-[100px] truncate px-3 py-2 text-xs" title={e.targetName ?? e.targetId}>
                          {e.targetName ?? e.targetId}
                        </td>
                        <td className="max-w-[150px] truncate px-3 py-2 text-xs" title={e.messageContent}>
                          {e.messageContent.slice(0, 60)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">
                          {e.finishedAt
                            ? new Date(e.finishedAt).toLocaleString()
                            : e.actualRunAt
                              ? new Date(e.actualRunAt).toLocaleString()
                              : "—"}
                        </td>
                        <td className="max-w-[80px] truncate px-3 py-2 text-xs font-mono text-slate-400">
                          {e.zaloMessageId?.slice(0, 12) ?? "—"}
                        </td>
                        <td className="max-w-[120px] truncate px-3 py-2 text-xs text-red-400">
                          {e.errorMessage?.slice(0, 40) ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
