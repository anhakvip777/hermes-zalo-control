"use client";

import { useState, useEffect, useCallback } from "react";
import { getThreadSettings, type ThreadSettingsItem } from "../../lib/api-client";
import {
  PageHeader,
  LoadingSpinner,
  EmptyState,
  ErrorBanner,
  DarkTable,
  DarkThead,
  DarkTh,
  DarkTr,
  DarkTd,
  StatusPill,
} from "../../components/ui/dark";

export default function ThreadSettingsPage() {
  const [threads, setThreads] = useState<ThreadSettingsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    setThreads([]);
    try {
      const response = await getThreadSettings({ page, pageSize: 50 });
      setThreads(response.data);
      setTotal(response.total);
      setTotalPages(response.totalPages);
    } catch (err: unknown) {
      setThreads([]);
      setTotal(0);
      setTotalPages(0);
      setError("Không thể tải cài đặt: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { void fetchSettings(); }, [fetchSettings]);

  if (loading && threads.length === 0 && !error) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="⚙️ Cài đặt Thread"
        subtitle="Chế độ xem chỉ đọc trong remediation dashboard"
        onRefresh={fetchSettings}
      />
      <div className="rounded-lg border border-blue-800/60 bg-blue-950/30 px-4 py-3 text-sm text-blue-300">
        Cài đặt thread đang ở chế độ chỉ đọc. Chỉnh sửa auto-reply, reminder hoặc media cần capability gate riêng.
      </div>
      {error && <ErrorBanner message={error} />}
      {!loading && !error && (
        <div className="text-xs text-slate-500">
          Page {totalPages === 0 ? 0 : page}/{totalPages} · {total} threads
        </div>
      )}
      {error ? null : !loading && threads.length === 0 ? (
        <EmptyState message="Không có dữ liệu thread nào." icon="📋" />
      ) : (
        <DarkTable>
          <DarkThead>
            <DarkTh>Thread ID</DarkTh>
            <DarkTh>Loại</DarkTh>
            <DarkTh>Tự động trả lời</DarkTh>
            <DarkTh>Yêu cầu Mention</DarkTh>
            <DarkTh>Thời gian trả lời</DarkTh>
            <DarkTh>Tạo nhắc nhở</DarkTh>
            <DarkTh>Media</DarkTh>
          </DarkThead>
          <tbody>
            {threads.map((thread) => {
              const typeLabel = thread.threadType === "group" ? "👥 Nhóm" : thread.threadType === "user" ? "👤 Cá nhân" : "? Unknown";
              return (
                <DarkTr key={thread.threadId}>
                  <DarkTd><span className="font-mono text-xs text-slate-400">{thread.threadId}</span></DarkTd>
                  <DarkTd><StatusPill variant={thread.threadType === "unknown" ? "warn" : thread.threadType === "group" ? "warn" : "info"}>{typeLabel}</StatusPill></DarkTd>
                  <DarkTd><StatusPill variant={thread.autoReplyEnabled ? "active" : "inactive"}>{thread.autoReplyEnabled ? "✅ Bật" : "❌ Tắt"}</StatusPill></DarkTd>
                  <DarkTd><StatusPill variant={thread.groupMentionRequired ? "active" : "inactive"}>{thread.groupMentionRequired ? "✅ Bật" : "❌ Tắt"}</StatusPill></DarkTd>
                  <DarkTd><span className="text-slate-300 text-sm">{thread.groupReplyWindowSeconds}s</span></DarkTd>
                  <DarkTd><StatusPill variant={thread.allowCreateReminder ? "active" : "inactive"}>{thread.allowCreateReminder ? "✅ Bật" : "❌ Tắt"}</StatusPill></DarkTd>
                  <DarkTd><StatusPill variant={thread.allowMedia ? "active" : "inactive"}>{thread.allowMedia ? "✅ Bật" : "❌ Tắt"}</StatusPill></DarkTd>
                </DarkTr>
              );
            })}
          </tbody>
        </DarkTable>
      )}
      {!error && totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={loading || page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
