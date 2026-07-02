"use client";

import { useEffect, useState } from "react";
import {
  getRuntimeConfig,
  setAutoReplyDryRun,
  type RuntimeConfigResponse,
  getHeartbeats,
  type HeartbeatsResponse,
  getErrorSummary,
  triggerTestAlert,
  type ErrorSummaryResponse,
} from "../../lib/api-client";
import { useToast } from "../../components/toast";
import {
  Card,
  PageHeader,
  LoadingSpinner,
  EmptyState,
  ErrorBanner,
  WarnBanner,
  DarkButton,
  DarkInput,
  DarkModal,
  StatCard,
  Kv,
  StatusPill,
  SeverityPill,
  SectionLabel,
} from "../../components/ui/dark";

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
    Promise.all([getRuntimeConfig(), getHeartbeats()])
      .then(([config, hb]) => { setData(config); setHeartbeats(hb); })
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
      const result = await setAutoReplyDryRun({ dryRun, confirmText, reason });
      if (result.success) {
        toast(
          dryRun ? "✅ Đã bật chế độ DRY RUN an toàn" : "⚠️ ĐÃ BẬT LIVE MODE — bot sẽ gửi tin thật!",
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

  if (loading && !data) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="🛡️ Safety Mode"
        subtitle="Kiểm soát chế độ gửi tin thật / dry-run của bot Zalo."
        onRefresh={fetchData}
      />

      {/* Status card */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Chế độ hiện tại</h2>
            <p className="text-sm text-slate-400 mt-1">
              Nguồn: {data?.effective?.dryRunSource === "runtime" ? "Runtime (DB override)" : "Biến môi trường (.env)"}
            </p>
          </div>
          <StatusPill variant={isDryRun ? "dry-run" : "sent"} pulse={!isDryRun}>
            {isDryRun ? "🟢 DRY RUN" : "🔴 LIVE MODE"}
          </StatusPill>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-6">
          <StatCard label="Allowed threads" value={data?.effective?.allowedThreads?.length ?? 0} />
          <StatCard label="Cooldown (s)" value={data?.effective?.cooldownSeconds ?? 0} />
          <StatCard label="Audit records" value={data?.recentAudit?.length ?? 0} />
        </div>
      </Card>

      {/* Toggle buttons */}
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => { setShowModal("dry"); setConfirmText(""); setReason(""); }}
          disabled={isDryRun}
          className="rounded-xl border border-green-700/60 bg-green-900/20 px-6 py-5 text-green-300 font-semibold
                     hover:bg-green-900/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
        >
          🔒 Chuyển sang DRY RUN
          <p className="text-xs font-normal text-green-500/80 mt-1">An toàn — bot không gửi tin thật</p>
        </button>
        <button
          onClick={() => { setShowModal("live"); setConfirmText(""); setReason(""); }}
          disabled={!isDryRun}
          className="rounded-xl border border-red-700/60 bg-red-900/20 px-6 py-5 text-red-300 font-semibold
                     hover:bg-red-900/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
        >
          ⚠️ Bật LIVE MODE
          <p className="text-xs font-normal text-red-500/80 mt-1">Nguy hiểm — bot sẽ gửi tin thật!</p>
        </button>
      </div>

      {/* Audit history */}
      <Card>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">📋 Lịch sử thay đổi</h2>
        {data?.recentAudit?.length ? (
          <div className="space-y-2">
            {data.recentAudit.slice(0, 10).map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg bg-slate-700/40 border border-slate-700 p-3 text-sm">
                <div>
                  <span className="font-mono text-xs text-slate-500">{new Date(a.createdAt).toLocaleString("vi-VN")}</span>
                  <p className="mt-1 text-slate-300">
                    <span className="font-bold">{a.oldValue === "true" ? "DRY" : "LIVE"}</span>
                    {" → "}
                    <span className={`font-bold ${a.newValue === "true" ? "text-green-400" : "text-red-400"}`}>
                      {a.newValue === "true" ? "DRY" : "LIVE"}
                    </span>
                    {a.reason && <span className="text-slate-500"> — {a.reason.slice(0, 60)}</span>}
                  </p>
                </div>
                {a.backupName && <span className="text-xs text-slate-500">💾 backup</span>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Chưa có thay đổi nào.</p>
        )}
      </Card>

      {/* Heartbeat status */}
      <Card>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">💓 Heartbeats</h2>
        <p className="text-xs text-slate-500 mb-4">
          Stale threshold: {heartbeats?.staleThresholdSeconds ?? 90}s — Tổng: {heartbeats?.status ?? "—"}
        </p>
        {heartbeats?.items?.length ? (
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
          <p className="text-sm text-slate-500">Chưa có heartbeat nào.</p>
        )}
      </Card>

      <ErrorSummaryCard />

      {/* Modal */}
      {showModal && (
        <DarkModal onClose={() => setShowModal(null)}>
          <h2 className={`text-xl font-bold ${showModal === "live" ? "text-red-400" : "text-green-400"}`}>
            {showModal === "live" ? "⚠️ BẬT LIVE MODE" : "🔒 Bật Dry Run"}
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            {showModal === "live"
              ? "Bot sẽ gửi tin nhắn THẬT tới người dùng Zalo. Hành động này được audit và backup tự động."
              : "Bot sẽ chỉ xử lý nội bộ, không gửi tin thật ra Zalo."}
          </p>
          <div className="mt-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Gõ xác nhận:{" "}
                <code className="bg-slate-800 px-1 rounded text-slate-400">
                  {showModal === "live" ? "ENABLE LIVE MODE" : "ENABLE DRY RUN"}
                </code>
              </label>
              <DarkInput
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={showModal === "live" ? "ENABLE LIVE MODE" : "ENABLE DRY RUN"}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Lý do {showModal === "live" ? "(tối thiểu 10 ký tự)" : "(tuỳ chọn)"}
              </label>
              <DarkInput
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ví dụ: Kiểm tra DM thread trước khi mở rộng"
              />
            </div>
          </div>
          <div className="mt-6 flex gap-3 justify-end">
            <DarkButton variant="ghost" onClick={() => setShowModal(null)}>Huỷ</DarkButton>
            <DarkButton
              variant={showModal === "live" ? "danger" : "success"}
              onClick={handleToggle}
              disabled={submitting || !confirmText || (showModal === "live" && reason.length < 10)}
            >
              {submitting ? "Đang xử lý..." : showModal === "live" ? "Xác nhận BẬT LIVE" : "Xác nhận Dry Run"}
            </DarkButton>
          </div>
        </DarkModal>
      )}
    </div>
  );
}

// ── Error Summary Card ─────────────────────────────────────────────────
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
      if (result.dryRun) toast("✅ Test alert (dry-run) đã được lưu. Không gửi tin nhắn thật.", "success");
      else toast("⚠️ Test alert đã gửi thật!", "error");
    } catch { toast("Test alert thất bại", "error"); }
    finally { setAlerting(false); }
  };

  const statusVariant =
    data?.status === "error" ? "failed" : data?.status === "warn" ? "warn" : "active";

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-100">📊 Error Summary (24h)</h2>
        <div className="flex items-center gap-2">
          {data && <StatusPill variant={statusVariant as "failed" | "warn" | "active"}>{data.status.toUpperCase()}</StatusPill>}
          <DarkButton variant="ghost" size="sm" onClick={handleTestAlert} disabled={alerting}>
            {alerting ? "Đang gửi..." : "🧪 Test Alert"}
          </DarkButton>
        </div>
      </div>

      {loading && !data ? (
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
