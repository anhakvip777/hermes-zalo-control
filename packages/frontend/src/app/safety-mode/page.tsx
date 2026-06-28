"use client";

import { useEffect, useState } from "react";
import {
  getRuntimeConfig,
  setAutoReplyDryRun,
  type RuntimeConfigResponse,
} from "../../lib/api-client";
import { getHeartbeats, type HeartbeatsResponse } from "../../lib/api-client";
import {
  getErrorSummary,
  triggerTestAlert,
  type ErrorSummaryResponse,
} from "../../lib/api-client";
import { useToast } from "../../components/toast";

export default function SafetyModePage() {
  const [data, setData] = useState<RuntimeConfigResponse | null>(null);
  const [heartbeats, setHeartbeats] = useState<HeartbeatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState<"live" | "dry" | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      getRuntimeConfig(),
      getHeartbeats(),
    ])
      .then(([config, hb]) => {
        setData(config);
        setHeartbeats(hb);
      })
      .catch(() => toast("Không tải được cấu hình runtime", "error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, []);

  const isDryRun = data?.effective?.dryRun ?? true;

  const handleToggle = async () => {
    if (!showModal) return;
    const dryRun = showModal === "dry";
    setSubmitting(true);
    try {
      const result = await setAutoReplyDryRun({
        dryRun,
        confirmText,
        reason,
      });
      if (result.success) {
        toast(
          dryRun
            ? "✅ Đã bật chế độ DRY RUN an toàn"
            : "⚠️ ĐÃ BẬT LIVE MODE — bot sẽ gửi tin thật!",
          dryRun ? "success" : "error",
        );
        setShowModal(null);
        setConfirmText("");
        setReason("");
        fetchData();
      } else {
        toast(result.error ?? "Lỗi không xác định", "error");
      }
    } catch {
      toast("Toggle thất bại", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-400">Đang tải...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">🛡️ Safety Mode</h1>
      <p className="text-sm text-slate-500">
        Kiểm soát chế độ gửi tin thật / dry-run của bot Zalo.
      </p>

      {/* Status card */}
      <div className="rounded-xl border bg-white shadow-sm p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Chế độ hiện tại</h2>
            <p className="text-sm text-slate-500 mt-1">
              Nguồn: {data?.effective?.dryRunSource === "runtime" ? "Runtime (DB override)" : "Biến môi trường (.env)"}
            </p>
          </div>
          <div
            className={`px-4 py-2 rounded-full text-sm font-bold ${
              isDryRun
                ? "bg-green-100 text-green-800 border border-green-300"
                : "bg-red-100 text-red-800 border border-red-300 animate-pulse"
            }`}
          >
            {isDryRun ? "🟢 DRY RUN" : "🔴 LIVE MODE"}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-6 text-sm">
          <div className="rounded-lg bg-slate-50 p-3">
            <span className="text-slate-500">Allowed threads</span>
            <p className="font-bold text-lg">{data?.effective?.allowedThreads?.length ?? 0}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <span className="text-slate-500">Cooldown</span>
            <p className="font-bold text-lg">{data?.effective?.cooldownSeconds ?? 0}s</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <span className="text-slate-500">Audit records</span>
            <p className="font-bold text-lg">{data?.recentAudit?.length ?? 0}</p>
          </div>
        </div>
      </div>

      {/* Toggle buttons */}
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => { setShowModal("dry"); setConfirmText(""); setReason(""); }}
          disabled={isDryRun}
          className="rounded-lg border border-green-300 bg-green-50 px-6 py-4 text-green-800 font-semibold
                     hover:bg-green-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          🔒 Chuyển sang DRY RUN
        </button>
        <button
          onClick={() => { setShowModal("live"); setConfirmText(""); setReason(""); }}
          disabled={!isDryRun}
          className="rounded-lg border border-red-300 bg-red-50 px-6 py-4 text-red-800 font-semibold
                     hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ⚠️ Bật LIVE MODE
        </button>
      </div>

      {/* Audit history */}
      <div className="rounded-xl border bg-white shadow-sm p-6">
        <h2 className="text-lg font-semibold mb-4">📋 Lịch sử thay đổi</h2>
        {data?.recentAudit?.length ? (
          <div className="space-y-2">
            {data.recentAudit.slice(0, 10).map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm"
              >
                <div>
                  <span className="font-mono text-xs text-slate-400">
                    {new Date(a.createdAt).toLocaleString("vi-VN")}
                  </span>
                  <p className="mt-1">
                    <span className="font-bold">{a.oldValue === "true" ? "DRY" : "LIVE"}</span>
                    {" → "}
                    <span className={`font-bold ${a.newValue === "true" ? "text-green-600" : "text-red-600"}`}>
                      {a.newValue === "true" ? "DRY" : "LIVE"}
                    </span>
                    {a.reason && <span className="text-slate-400"> — {a.reason.slice(0, 60)}</span>}
                  </p>
                </div>
                {a.backupName && (
                  <span className="text-xs text-slate-400">💾 backup</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Chưa có thay đổi nào.</p>
        )}
      </div>

      {/* Heartbeat status */}
      <div className="rounded-xl border bg-white shadow-sm p-6">
        <h2 className="text-lg font-semibold mb-4">💓 Heartbeats</h2>
        <p className="text-xs text-slate-400 mb-3">
          Stale threshold: {heartbeats?.staleThresholdSeconds ?? 90}s — Tổng: {heartbeats?.status ?? "—"}
        </p>
        {heartbeats?.items?.length ? (
          <div className="grid grid-cols-2 gap-2">
            {heartbeats.items.map((hb) => (
              <div
                key={hb.name}
                className={`rounded-lg border p-3 text-sm ${
                  hb.status === "ok"
                    ? "border-green-200 bg-green-50"
                    : hb.status === "stale"
                      ? "border-yellow-200 bg-yellow-50"
                      : "border-red-200 bg-red-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{hb.name}</span>
                  <span
                    className={`text-xs font-bold uppercase ${
                      hb.status === "ok"
                        ? "text-green-700"
                        : hb.status === "stale"
                          ? "text-yellow-700"
                          : "text-red-700"
                    }`}
                  >
                    {hb.status}
                  </span>
                </div>
                {hb.ageSeconds !== null && (
                  <p className="text-xs text-slate-500 mt-1">
                    {hb.ageSeconds}s ago
                    {hb.lastError && <span className="text-red-500 ml-2">— {hb.lastError.slice(0, 40)}</span>}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Chưa có heartbeat nào.</p>
        )}
      </div>

      {/* Error Summary */}
      <ErrorSummaryCard />

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h2 className={`text-xl font-bold ${showModal === "live" ? "text-red-600" : "text-green-600"}`}>
              {showModal === "live" ? "⚠️ BẬT LIVE MODE" : "🔒 Bật Dry Run"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {showModal === "live"
                ? "Bot sẽ gửi tin nhắn THẬT tới người dùng Zalo. Hành động này được audit và backup tự động."
                : "Bot sẽ chỉ xử lý nội bộ, không gửi tin thật ra Zalo."}
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Gõ xác nhận: <code className="bg-slate-100 px-1 rounded">{showModal === "live" ? "ENABLE LIVE MODE" : "ENABLE DRY RUN"}</code>
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder={showModal === "live" ? "ENABLE LIVE MODE" : "ENABLE DRY RUN"}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Lý do {showModal === "live" ? "(tối thiểu 10 ký tự)" : "(tuỳ chọn)"}
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Ví dụ: Kiểm tra DM thread trước khi mở rộng"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3 justify-end">
              <button
                onClick={() => setShowModal(null)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Huỷ
              </button>
              <button
                onClick={handleToggle}
                disabled={submitting || !confirmText || (showModal === "live" && reason.length < 10)}
                className={`rounded-md px-4 py-2 text-sm font-semibold text-white ${
                  showModal === "live"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-green-600 hover:bg-green-700"
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {submitting ? "Đang xử lý..." : showModal === "live" ? "Xác nhận BẬT LIVE" : "Xác nhận Dry Run"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Error Summary Card — inline component
// ═══════════════════════════════════════════════════════════════════

function ErrorSummaryCard() {
  const [data, setData] = useState<ErrorSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [alerting, setAlerting] = useState(false);
  const { toast } = useToast();

  const fetchData = () => {
    getErrorSummary(24)
      .then(setData)
      .catch(() => toast("Không tải được error summary", "error"))
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
      const result = await triggerTestAlert();
      if (result.dryRun) {
        toast("✅ Test alert (dry-run) đã được lưu. Không gửi tin nhắn thật.", "success");
      } else {
        toast("⚠️ Test alert đã gửi thật!", "error");
      }
    } catch {
      toast("Test alert thất bại", "error");
    } finally {
      setAlerting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="rounded-xl border bg-white shadow-sm p-6">
        <p className="text-sm text-slate-400">Đang tải error summary...</p>
      </div>
    );
  }

  const statusEmoji = data?.status === "error" ? "🔴" : data?.status === "warn" ? "⚠️" : "✅";
  const statusColor =
    data?.status === "error"
      ? "border-red-300 bg-red-50"
      : data?.status === "warn"
        ? "border-yellow-300 bg-yellow-50"
        : "border-green-300 bg-green-50";

  return (
    <div className="rounded-xl border bg-white shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">📊 Error Summary (24h)</h2>
        <button
          onClick={handleTestAlert}
          disabled={alerting}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-50 transition-colors"
        >
          {alerting ? "Đang gửi..." : "🧪 Test Alert"}
        </button>
      </div>

      {data ? (
        <>
          {/* Status */}
          <div className={`rounded-lg border p-3 mb-4 flex items-center gap-3 ${statusColor}`}>
            <span className="text-2xl">{statusEmoji}</span>
            <div>
              <p className="font-bold text-sm uppercase">{data.status}</p>
              <p className="text-xs text-slate-500">
                Errors: {data.totals.errors} | Warnings: {data.totals.warnings}
              </p>
            </div>
          </div>

          {/* Detail stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4 text-xs">
            <Stat label="Failed Tasks" value={data.totals.failedAgentTasks} />
            <Stat label="Failed Execs" value={data.totals.failedExecutions} />
            <Stat label="Blocked Out" value={data.totals.blockedOutbound} />
            <Stat label="Stale HBs" value={data.totals.staleHeartbeats} />
          </div>

          {/* Top error groups */}
          {data.groups.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-slate-500 mb-2">Top error codes</p>
              <div className="space-y-1">
                {data.groups.slice(0, 5).map((g, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between rounded px-2 py-1 text-xs ${
                      g.severity === "high"
                        ? "bg-red-50 border border-red-100"
                        : g.severity === "medium"
                          ? "bg-yellow-50 border border-yellow-100"
                          : "bg-slate-50"
                    }`}
                  >
                    <span className="truncate">
                      {g.severity === "high" ? "🔴" : g.severity === "medium" ? "🟡" : "⚪"} {g.source}:{g.errorCode}
                    </span>
                    <span className="font-bold ml-2">{g.count}x</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent errors */}
          {data.recent.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2">Recent</p>
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {data.recent.slice(0, 10).map((r, i) => (
                  <div key={i} className="text-xs text-slate-500 py-0.5">
                    <span className="font-mono text-slate-400">
                      {new Date(r.seenAt).toLocaleTimeString("vi-VN")}
                    </span>{" "}
                    {r.source} — {r.message?.slice(0, 60)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.groups.length === 0 && data.recent.length === 0 && (
            <p className="text-sm text-slate-400">✅ Không có lỗi nào trong 24h qua.</p>
          )}
        </>
      ) : (
        <p className="text-sm text-slate-400">Không có dữ liệu.</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2 text-center">
      <div className="text-slate-400">{label}</div>
      <div className="font-bold text-sm mt-0.5">{value}</div>
    </div>
  );
}
