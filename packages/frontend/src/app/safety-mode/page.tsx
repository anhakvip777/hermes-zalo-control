"use client";

import { useEffect, useState } from "react";
import {
  getRuntimeConfig,
  type RuntimeConfigResponse,
  getHeartbeats,
  type HeartbeatsResponse,
  getErrorSummary,
  type ErrorSummaryResponse,
} from "../../lib/api-client";
import { useToast } from "../../components/toast";
import {
  Card,
  PageHeader,
  LoadingSpinner,
  ErrorBanner,
  StatCard,
  StatusPill,
  SectionLabel,
} from "../../components/ui/dark";

export default function SafetyModePage() {
  const [data, setData] = useState<RuntimeConfigResponse | null>(null);
  const [heartbeats, setHeartbeats] = useState<HeartbeatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchData = () => {
    setLoading(true);
    setError(null);
    Promise.all([getRuntimeConfig(), getHeartbeats()])
      .then(([config, hb]) => { setData(config); setHeartbeats(hb); })
      .catch((err) => { setData(null); setHeartbeats(null); setError(err instanceof Error ? err.message : "Không tải được cấu hình runtime"); toast("Không tải được cấu hình runtime", "error"); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const isDryRun = data?.effective?.dryRun;

  if (loading && !data) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="🛡️ Safety Mode"
        subtitle="Trạng thái runtime ở chế độ chỉ đọc trong remediation dashboard."
        onRefresh={fetchData}
      />
      {error && <ErrorBanner message={error} />}

      {/* Status card */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Chế độ hiện tại</h2>
            <p className="text-sm text-slate-400 mt-1">
              Nguồn: {data?.effective?.dryRunSource === "runtime" ? "Runtime (DB override)" : "Biến môi trường (.env)"}
            </p>
          </div>
          <StatusPill variant={isDryRun === undefined ? "warn" : isDryRun ? "dry-run" : "sent"} pulse={isDryRun === false}>
            {isDryRun === undefined ? "? UNKNOWN" : isDryRun ? "🟢 DRY RUN" : "🔴 LIVE MODE"}
          </StatusPill>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-6">
          <StatCard label="Allowed threads" value={data ? data.effective.allowedThreads.length : "UNKNOWN"} />
          <StatCard label="Cooldown (s)" value={data ? data.effective.cooldownSeconds : "UNKNOWN"} />
          <StatCard label="Audit records" value={data ? data.recentAudit.length : "UNKNOWN"} />
        </div>
      </Card>

      <div className="rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm text-slate-400">
        Global LIVE và Test Alert đã bị gỡ khỏi dashboard remediation. Chỉ hiển thị trạng thái và audit; global live bị backend từ chối.
      </div>

      {/* Audit history */}
      <Card>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">📋 Lịch sử thay đổi</h2>
        {!data ? (
          <p className="text-sm text-slate-400">Audit UNKNOWN — chưa có runtime response hợp lệ.</p>
        ) : data.recentAudit.length ? (
          <div className="space-y-2">
            {data.recentAudit.slice(0, 10).map((a) => {
              const isDryRunAudit = a.key === "autoReply.dryRun";
              const oldLabel = isDryRunAudit
                ? a.oldValue === null ? "UNSET" : a.oldValue === "true" ? "DRY RUN" : a.oldValue === "false" ? "GLOBAL LIVE (blocked)" : "UNKNOWN"
                : a.oldValue ?? "UNSET";
              const newLabel = isDryRunAudit
                ? a.newValue === "true" ? "DRY RUN" : a.newValue === "false" ? "GLOBAL LIVE (blocked)" : "UNKNOWN"
                : a.newValue;
              return (
                <div key={a.id} className="flex items-center justify-between rounded-lg bg-slate-700/40 border border-slate-700 p-3 text-sm">
                  <div>
                    <span className="font-mono text-xs text-slate-500">{new Date(a.createdAt).toLocaleString("vi-VN")}</span>
                    <p className="mt-1 text-slate-300">
                      <code className="text-xs text-blue-300">{a.key}</code>{" · "}
                      <span>{oldLabel}</span>{" → "}<span>{newLabel}</span>
                      {a.reason && <span className="text-slate-500"> — {a.reason.slice(0, 60)}</span>}
                    </p>
                  </div>
                  {a.backupName && <span className="text-xs text-slate-500">💾 backup</span>}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Response hợp lệ: chưa có thay đổi nào.</p>
        )}
      </Card>

      {/* Heartbeat status */}
      <Card>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">💓 Heartbeats</h2>
        <p className="text-xs text-slate-500 mb-4">
          Stale threshold: {heartbeats?.staleThresholdSeconds ?? 90}s — Tổng: {heartbeats?.status ?? "—"}
        </p>
        {!heartbeats ? (
          <p className="text-sm text-slate-400">Heartbeats UNKNOWN — chưa có response hợp lệ.</p>
        ) : heartbeats.items.length ? (
          <div className="grid grid-cols-2 gap-2">
            {heartbeats.items.map((hb) => {
              const variant = hb.status === "ok" ? "active" : hb.status === "stale" ? "warn" : "failed";
              return (
                <div
                  key={hb.name}
                  className={`rounded-lg border p-3 text-sm ${
                    hb.status === "ok"
                      ? "border-green-700/50 bg-green-900/20"
                      : hb.status === "stale"
                        ? "border-yellow-700/50 bg-yellow-900/20"
                        : "border-red-700/50 bg-red-900/20"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">{hb.name}</span>
                    <StatusPill variant={variant as "active" | "warn" | "failed"}>{hb.status}</StatusPill>
                  </div>
                  {hb.ageSeconds !== null && (
                    <p className="text-xs text-slate-500 mt-1">
                      {hb.ageSeconds}s ago
                      {hb.lastError && <span className="text-red-400 ml-2">— {hb.lastError.slice(0, 40)}</span>}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Response hợp lệ: chưa có heartbeat nào.</p>
        )}
      </Card>

      <ErrorSummaryCard />

    </div>
  );
}

// ── Error Summary Card ─────────────────────────────────────────────────
function ErrorSummaryCard() {
  const [data, setData] = useState<ErrorSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchData = () => {
    setError(null);
    getErrorSummary(24)
      .then(setData)
      .catch((err) => {
        setData(null);
        setError(err instanceof Error ? err.message : "Không tải được error summary");
        toast("Không tải được error summary", "error");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const statusVariant =
    data?.status === "error" ? "failed" : data?.status === "warn" ? "warn" : "active";

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-100">📊 Error Summary (24h)</h2>
        {data && <StatusPill variant={statusVariant as "failed" | "warn" | "active"}>{data.status.toUpperCase()}</StatusPill>}
      </div>

      {error ? (
        <p className="text-sm text-red-300">Error summary UNKNOWN — {error}</p>
      ) : loading && !data ? (
        <p className="text-sm text-slate-500">Đang tải error summary...</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <StatCard label="Errors" value={data.totals.errors} accent={data.totals.errors > 0 ? "red" : undefined} />
            <StatCard label="Warnings" value={data.totals.warnings} accent={data.totals.warnings > 0 ? "yellow" : undefined} />
            <StatCard label="Failed Tasks" value={data.totals.failedAgentTasks} />
            <StatCard label="Blocked Out" value={data.totals.blockedOutbound} />
          </div>

          {data.groups.length > 0 && (
            <div className="mb-4">
              <SectionLabel>Top error codes</SectionLabel>
              <div className="space-y-1.5">
                {data.groups.slice(0, 5).map((g, i) => (
                  <div key={i} className={`flex items-center justify-between rounded-lg px-3 py-2 border text-xs ${
                    g.severity === "high" ? "bg-red-900/20 border-red-700/50" :
                    g.severity === "medium" ? "bg-yellow-900/20 border-yellow-700/50" : "bg-slate-700/40 border-slate-700"
                  }`}>
                    <span className="text-slate-300 truncate">
                      {g.severity === "high" ? "🔴" : g.severity === "medium" ? "🟡" : "⚪"} {g.source}:{g.errorCode}
                    </span>
                    <span className="font-bold text-slate-200 ml-2 shrink-0">{g.count}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.recent.length > 0 && (
            <div>
              <SectionLabel>Recent</SectionLabel>
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {data.recent.slice(0, 10).map((r, i) => (
                  <div key={i} className="text-xs text-slate-500 py-0.5">
                    <span className="font-mono text-slate-600">{new Date(r.seenAt).toLocaleTimeString("vi-VN")}</span>{" "}
                    {r.source} — {r.message?.slice(0, 60)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.groups.length === 0 && data.recent.length === 0 && (
            <p className="text-sm text-green-400">✅ Không có lỗi nào trong 24h qua.</p>
          )}
        </>
      ) : (
        <p className="text-sm text-slate-500">Không có dữ liệu.</p>
      )}
    </Card>
  );
}
