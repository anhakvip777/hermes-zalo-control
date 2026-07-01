"use client";

import { useEffect, useState, useCallback } from "react";
import { listMessages, type MessageItem } from "../../lib/api-client";
import { useToast } from "../../components/toast";

// ═══════════════════════════════════════════════════════════════════
// Status badge logic (U1)
// ═══════════════════════════════════════════════════════════════════

type StatusInfo = {
  label: string;
  color: string;
  icon: string;
};

function getStatusBadge(m: MessageItem): StatusInfo | null {
  // Only assistant/system messages have outbound records
  if (m.role !== "assistant" && m.role !== "system") return null;

  const ob = m.outbound;

  // No outbound record at all
  if (!ob) {
    return { label: "NO RECORD", color: "bg-slate-200 text-slate-600 border-slate-300", icon: "❓" };
  }

  // Failed
  if (ob.errorCode) {
    return { label: "FAILED", color: "bg-red-100 text-red-700 border-red-300", icon: "❌" };
  }

  // Permission denied
  if (ob.reason === "permission_denied") {
    return { label: "PERM DENIED", color: "bg-orange-100 text-orange-700 border-orange-300", icon: "🚫" };
  }

  // Blocked / skipped
  if (ob.decision === "block" || ob.decision === "skip") {
    return { label: "BLOCKED", color: "bg-red-100 text-red-700 border-red-300", icon: "🛑" };
  }

  // Cooldown
  if (ob.reason === "cooldown") {
    return { label: "COOLDOWN", color: "bg-yellow-100 text-yellow-700 border-yellow-300", icon: "⏳" };
  }

  // Actually sent (has sentMessageId)
  if (ob.sentMessageId) {
    return { label: "SENT", color: "bg-green-100 text-green-700 border-green-300", icon: "✅" };
  }

  // Dry run (no sentMessageId, no error)
  if (ob.dryRun) {
    return { label: "DRY RUN", color: "bg-blue-100 text-blue-700 border-blue-300", icon: "🔵" };
  }

  // Fallback
  return { label: "UNKNOWN", color: "bg-slate-100 text-slate-600 border-slate-300", icon: "❔" };
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
      .catch(() => toast("Failed to load messages", "error"))
      .finally(() => setLoading(false));
  }, [page, threadId, search, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">📨 Messages</h1>
          <p className="text-sm text-slate-500 mt-1">
            Timeline các tin nhắn bot đã nhận và gửi — với trạng thái outbound.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Thread ID..."
          value={threadId}
          onChange={(e) => { setThreadId(e.target.value); setPage(1); }}
          className="px-3 py-2 border rounded-lg text-sm w-64"
        />
        <input
          type="text"
          placeholder="Search content..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-2 border rounded-lg text-sm w-64"
        />
        <button onClick={fetchData} className="px-4 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg">
          🔄 Làm mới
        </button>
      </div>

      {/* Total */}
      <p className="text-sm text-slate-500">Total: {total} messages | Page {page}/{totalPages || 1}</p>

      {/* Table */}
      {loading && data.length === 0 ? (
        <div className="flex items-center justify-center h-64"><p className="text-slate-400">Đang tải...</p></div>
      ) : data.length > 0 ? (
        <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="p-2 text-left text-xs font-semibold uppercase">Time</th>
                <th className="p-2 text-left text-xs font-semibold uppercase">Type</th>
                <th className="p-2 text-left text-xs font-semibold uppercase">Thread</th>
                <th className="p-2 text-left text-xs font-semibold uppercase">Sender</th>
                <th className="p-2 text-left text-xs font-semibold uppercase">Content</th>
                <th className="p-2 text-left text-xs font-semibold uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => {
                const status = getStatusBadge(m);
                return (
                  <tr key={m.id} className={`border-b hover:bg-slate-50 ${m.isFromBot ? "bg-blue-50/30" : ""}`}>
                    <td className="p-2 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(m.receivedAt || m.createdAt).toLocaleString("vi-VN", {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        m.role === "assistant" ? "bg-blue-100 text-blue-700" :
                        m.role === "system" ? "bg-purple-100 text-purple-700" :
                        "bg-slate-100 text-slate-600"
                      }`}>
                        {m.role}
                      </span>
                      {m.messageType !== "text" && (
                        <span className="ml-1 text-xs text-orange-500">{m.messageType}</span>
                      )}
                    </td>
                    <td className="p-2 text-xs max-w-[160px]" title={m.threadId}>
                      {m.thread?.displayName ? (
                        <div>
                          <div className="font-medium text-slate-700 truncate">{m.thread.displayName}</div>
                          <div className="font-mono text-[10px] text-slate-400 truncate">{m.threadId}</div>
                        </div>
                      ) : (
                        <div>
                          <div className="text-slate-400 text-[10px]">Unknown</div>
                          <div className="font-mono text-[10px] text-slate-500 truncate">{m.threadId}</div>
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-xs text-slate-500 max-w-[100px] truncate">
                      {m.senderName ?? m.senderId?.slice(-8) ?? "—"}
                    </td>
                    <td className="p-2 text-xs max-w-[350px]">
                      <div className="truncate" title={m.content}>
                        {m.content?.slice(0, 80)}{m.content?.length > 80 ? "…" : ""}
                      </div>
                      {/* Outbound details */}
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
                    <td className="p-2 whitespace-nowrap">
                      {status ? (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${status.color}`}
                          title={status.label}
                        >
                          {status.icon} {status.label}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border bg-white shadow-sm p-8 text-center">
          <p className="text-slate-400">Không có tin nhắn nào.</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 justify-center">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1 text-sm border rounded disabled:opacity-30">← Prev</button>
          <span className="text-sm text-slate-500">Page {page}/{totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 text-sm border rounded disabled:opacity-30">Next →</button>
        </div>
      )}

      {/* Legend */}
      <div className="rounded-xl border bg-white shadow-sm p-4">
        <h3 className="text-xs font-semibold text-slate-500 mb-2 uppercase">Status Legend</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "✅ SENT", desc: "Đã gửi thật (có sentMessageId)" },
            { label: "🔵 DRY RUN", desc: "Dry run — không gửi thật" },
            { label: "❌ FAILED", desc: "Lỗi khi gửi (có errorCode)" },
            { label: "🛑 BLOCKED", desc: "Bị chặn (decision=skip/block)" },
            { label: "🚫 PERM DENIED", desc: "Thiếu quyền (permission_denied)" },
            { label: "⏳ COOLDOWN", desc: "Bị giới hạn cooldown" },
            { label: "❓ NO RECORD", desc: "Assistant message không có OutboundRecord" },
          ].map((item) => (
            <span key={item.label} className="text-[10px] text-slate-500 bg-slate-50 px-2 py-1 rounded">
              {item.label}: {item.desc}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
