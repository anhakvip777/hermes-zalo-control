"use client";

import { useEffect, useState, useCallback } from "react";
import { listMessages, type MessageItem } from "../../lib/api-client";
import { useToast } from "../../components/toast";
import { formatVnTime, formatRelativeTime } from "../../components/ui/TimeText";

// ═══════════════════════════════════════════════════════════════════
// Status badge logic
// ═══════════════════════════════════════════════════════════════════

type StatusInfo = {
  label: string;
  className: string;
  icon: string;
};

function getStatusBadge(m: MessageItem): StatusInfo | null {
  if (m.role !== "assistant" && m.role !== "system") return null;

  const ob = m.outbound;

  // No outbound record
  if (!ob) {
    return { label: "NO RECORD", className: "bg-slate-100 text-slate-500 border-slate-200", icon: "—" };
  }

  // Actually sent (has sentMessageId)
  if (ob.sentMessageId) {
    return { label: "SENT", className: "bg-success-light text-success border-green-300", icon: "✓" };
  }

  // Failed
  if (ob.errorCode) {
    return { label: "FAILED", className: "bg-danger-light text-danger border-red-300", icon: "✕" };
  }

  // Permission denied
  if (ob.reason === "permission_denied") {
    return { label: "PERM DENIED", className: "bg-orange-100 text-orange-700 border-orange-300", icon: "⊘" };
  }

  // Blocked / skipped
  if (ob.decision === "block" || ob.decision === "skip") {
    return { label: "BLOCKED", className: "bg-danger-light text-danger border-red-300", icon: "⊘" };
  }

  // Cooldown
  if (ob.reason === "cooldown") {
    return { label: "COOLDOWN", className: "bg-warning-light text-warning border-yellow-300", icon: "⏳" };
  }

  // Dry run (no sentMessageId, no error)
  if (ob.dryRun) {
    return { label: "DRY RUN", className: "bg-info-light text-info border-cyan-300", icon: "◉" };
  }

  return { label: "UNKNOWN", className: "bg-slate-100 text-slate-500 border-slate-200", icon: "?" };
}

// ═══════════════════════════════════════════════════════════════════
// Source badge
// ═══════════════════════════════════════════════════════════════════

const SOURCE_LABELS: Record<string, string> = {
  auto_reply: "🤖 Auto",
  schedule: "📅 Sched",
  media: "📤 Media",
  manual: "✋ Manual",
  create_reminder: "⏰ Remind",
};

// ═══════════════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════════════

export default function MessagesPage() {
  const [data, setData] = useState<MessageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [threadId, setThreadId] = useState("");
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const fetchData = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = { page: String(page), pageSize: "30" };
    if (threadId) params.threadId = threadId;
    if (search) params.search = search;

    listMessages(params)
      .then((res) => {
        setData(res.data);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      })
      .catch(() => toast("Không tải được tin nhắn", "error"))
      .finally(() => setLoading(false));
  }, [page, threadId, search, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-5 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Tin nhắn</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Timeline tin nhắn bot đã nhận và gửi — với trạng thái outbound.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Thread ID..."
          value={threadId}
          onChange={(e) => { setThreadId(e.target.value); setPage(1); }}
          className="px-3 py-1.5 border border-slate-200 rounded-md text-sm w-52 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
        <input
          type="text"
          placeholder="Tìm nội dung..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-1.5 border border-slate-200 rounded-md text-sm w-52 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
        <button onClick={fetchData} className="px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200 transition-colors">
          🔄 Làm mới
        </button>
      </div>

      {/* Total */}
      <p className="text-xs text-slate-500">
        Tổng: {total} tin · Trang {page}/{totalPages || 1}
      </p>

      {/* Table */}
      {loading && data.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <p className="text-sm text-slate-400">Đang tải...</p>
        </div>
      ) : data.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white shadow-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Thời gian</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Loại</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Thread</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Người gửi</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Nội dung</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => {
                const status = getStatusBadge(m);
                return (
                  <tr key={m.id} className={`border-b border-slate-100 hover:bg-slate-50/70 transition-colors ${m.isFromBot ? "bg-blue-50/20" : ""}`}>
                    <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap" title={formatVnTime(m.receivedAt || m.createdAt)}>
                      {formatRelativeTime(m.receivedAt || m.createdAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium ${
                        m.role === "assistant" ? "bg-blue-50 text-blue-700" :
                        m.role === "system" ? "bg-purple-50 text-purple-700" :
                        "bg-slate-50 text-slate-600"
                      }`}>
                        {m.role}
                      </span>
                      {m.messageType !== "text" && (
                        <span className="ml-1 text-[11px] text-orange-500">{m.messageType}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs max-w-[160px]" title={m.threadId}>
                      {m.thread?.displayName ? (
                        <div>
                          <div className="font-medium text-slate-700 truncate">{m.thread.displayName}</div>
                          <div className="font-mono text-[10px] text-slate-400 truncate">{m.threadId.slice(-12)}</div>
                        </div>
                      ) : (
                        <div>
                          <div className="text-slate-400 text-[10px]">—</div>
                          <div className="font-mono text-[10px] text-slate-500 truncate">{m.threadId.slice(-12)}</div>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600 max-w-[100px] truncate">
                      {m.senderName ?? m.senderId?.slice(-8) ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs max-w-[350px]">
                      <div className="truncate" title={m.content}>
                        {m.content?.slice(0, 80)}{m.content?.length > 80 ? "…" : ""}
                      </div>
                      {m.outbound && (
                        <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-400">
                          {m.outbound.sentMessageId && (
                            <span title="Sent message ID" className="font-mono bg-slate-100 px-1 rounded">
                              ID:{m.outbound.sentMessageId.slice(-8)}
                            </span>
                          )}
                          {m.outbound.errorCode && (
                            <span className="text-red-500 font-medium">{m.outbound.errorCode}</span>
                          )}
                          {m.outbound.source && (
                            <span>{SOURCE_LABELS[m.outbound.source] ?? m.outbound.source}</span>
                          )}
                          {m.outbound.reason && m.outbound.reason !== "single_send" && (
                            <span className="italic" title={m.outbound.reason}>
                              {m.outbound.reason.length > 30
                                ? m.outbound.reason.slice(0, 28) + "…"
                                : m.outbound.reason}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {status ? (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${status.className}`}
                          title={status.label}
                        >
                          <span className="text-[10px]">{status.icon}</span> {status.label}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white shadow-card p-10 text-center">
          <p className="text-sm text-slate-400">Không có tin nhắn nào.</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-3 justify-center">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-30 transition-colors">← Trước</button>
          <span className="text-xs text-slate-500">Trang {page}/{totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-30 transition-colors">Sau →</button>
        </div>
      )}

      {/* Legend */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-card p-4">
        <h3 className="text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-wider">Chú thích trạng thái</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "✓ SENT", desc: "Đã gửi thật (có sentMessageId)" },
            { label: "◉ DRY RUN", desc: "Dry run — không gửi thật" },
            { label: "✕ FAILED", desc: "Lỗi khi gửi (có errorCode)" },
            { label: "⊘ BLOCKED", desc: "Bị chặn (decision=skip/block)" },
            { label: "⊘ PERM DENIED", desc: "Thiếu quyền" },
            { label: "⏳ COOLDOWN", desc: "Bị giới hạn cooldown" },
            { label: "— NO RECORD", desc: "Không có OutboundRecord" },
          ].map((item) => (
            <span key={item.label} className="text-[10px] text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-100">
              <span className="font-semibold">{item.label}</span>: {item.desc}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
