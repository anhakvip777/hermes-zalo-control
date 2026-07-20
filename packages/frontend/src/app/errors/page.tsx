"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getErrorSummary,
  type ErrorSummaryResponse,
} from "../../lib/api-client";
import {
  loadingState,
  readyState,
  unknownState,
  type RemoteDataState,
} from "../../lib/dashboard-state";
import {
  Card,
  PageHeader,
  LoadingSpinner,
  StatCard,
  StatusPill,
  SeverityPill,
} from "../../components/ui/dark";

export default function ErrorsPage() {
  const [state, setState] = useState<RemoteDataState<ErrorSummaryResponse>>(() =>
    loadingState(),
  );
  const inFlight = useRef(false);
  const activeController = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);

  const refreshData = useCallback(async () => {
    if (!mounted.current || inFlight.current) return;

    const controller = new AbortController();
    const requestId = ++generation.current;
    inFlight.current = true;
    activeController.current = controller;

    try {
      const result = await getErrorSummary(24, controller.signal);
      if (
        mounted.current &&
        !controller.signal.aborted &&
        generation.current === requestId
      ) {
        setState(readyState(result));
      }
    } catch (error) {
      if (
        mounted.current &&
        !controller.signal.aborted &&
        generation.current === requestId
      ) {
        setState(unknownState(error, "Không thể tải error summary"));
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
    const interval = window.setInterval(() => void refreshData(), 30_000);

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

  if (state.status === "loading") return <LoadingSpinner />;

  if (state.status === "unknown") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="🚨 Error Dashboard"
          subtitle="Không có error-summary evidence hợp lệ"
          onRefresh={() => void refreshData()}
        />
        <Card>
          <div className="rounded-lg border border-red-700/60 bg-red-900/20 p-5">
            <h2 className="text-lg font-bold text-red-300">ERROR SUMMARY UNKNOWN</h2>
            <p className="mt-2 text-sm text-red-200">{state.error}</p>
            <p className="mt-2 text-xs text-slate-400">
              Không hiển thị trạng thái xanh, bộ đếm 0 hoặc thông báo không có lỗi khi API chưa trả dữ liệu hợp lệ.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const data = state.data;
  const statusVariant: "failed" | "warn" | "active" =
    data.status === "error" ? "failed" : data.status === "warn" ? "warn" : "active";
  const statusBanner =
    data.status === "error"
      ? "border-red-700/60 bg-red-900/20"
      : data.status === "warn"
        ? "border-yellow-700/60 bg-yellow-900/20"
        : "border-green-700/60 bg-green-900/20";
  const statusEmoji =
    data.status === "error" ? "🚨" : data.status === "warn" ? "⚠️" : "✅";

  return (
    <div className="space-y-6">
      <PageHeader
        title="🚨 Error Dashboard"
        subtitle={`Tổng hợp lỗi hệ thống trong ${data.windowHours}h qua`}
        onRefresh={() => void refreshData()}
      />

      <div className={`rounded-xl border p-6 ${statusBanner}`}>
        <div className="flex items-center gap-4">
          <span className="text-3xl">{statusEmoji}</span>
          <div>
            <h2 className="text-xl font-bold uppercase text-slate-100">{data.status}</h2>
            <p className="text-sm text-slate-400">Window: {data.windowHours}h</p>
          </div>
          <div className="ml-auto">
            <StatusPill variant={statusVariant}>{data.status.toUpperCase()}</StatusPill>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        <StatCard label="Errors" value={data.totals.errors} accent={data.totals.errors > 0 ? "red" : undefined} />
        <StatCard label="Warnings" value={data.totals.warnings} accent={data.totals.warnings > 0 ? "yellow" : undefined} />
        <StatCard label="Failed Tasks" value={data.totals.failedAgentTasks} />
        <StatCard label="Failed Execs" value={data.totals.failedExecutions} />
        <StatCard label="Blocked" value={data.totals.blockedOutbound} />
        <StatCard label="Stale HBs" value={data.totals.staleHeartbeats} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-slate-100">
            📊 Error Groups ({data.groups.length})
          </h2>
          {data.groups.length > 0 ? (
            <div className="space-y-2">
              {data.groups.map((group) => (
                <div
                  key={`${group.source}:${group.errorCode}`}
                  className={`flex items-center justify-between rounded-lg border p-3 text-sm ${
                    group.severity === "high"
                      ? "border-red-700/50 bg-red-900/20"
                      : group.severity === "medium"
                        ? "border-yellow-700/50 bg-yellow-900/20"
                        : "border-slate-700 bg-slate-800/60"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <SeverityPill severity={group.severity} />
                      <span className="font-medium text-slate-200">{group.source}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">{group.errorCode}</div>
                    <div className="text-xs text-slate-600">
                      Last: {new Date(group.lastSeenAt).toLocaleString("vi-VN")}
                    </div>
                  </div>
                  <span className="ml-4 shrink-0 text-lg font-bold text-slate-200">{group.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-green-400">Không có lỗi nào. ✅</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-semibold text-slate-100">
            📋 Recent Errors ({data.recent.length})
          </h2>
          {data.recent.length > 0 ? (
            <div className="max-h-[500px] space-y-1 overflow-y-auto">
              {data.recent.map((entry) => (
                <div
                  key={`${entry.source}:${entry.errorCode}:${entry.seenAt}`}
                  className="border-b border-slate-700/50 p-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        entry.severity === "high"
                          ? "text-red-400"
                          : entry.severity === "medium"
                            ? "text-yellow-400"
                            : "text-slate-600"
                      }
                    >
                      {entry.severity === "high" ? "🔴" : entry.severity === "medium" ? "🟡" : "⚪"}
                    </span>
                    <span className="font-semibold text-slate-300">{entry.source}</span>
                    <span className="font-mono text-slate-500">
                      {new Date(entry.seenAt).toLocaleTimeString("vi-VN")}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-slate-500">{entry.message}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-green-400">Không có lỗi gần đây. ✅</p>
          )}
        </Card>
      </div>
    </div>
  );
}
