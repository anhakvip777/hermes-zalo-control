"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { listMessages, type MessageItem } from "../../lib/api-client";
import { useToast } from "../../components/toast";
import { formatVnTime, formatRelativeTime } from "../../components/ui/TimeText";
import { classifyOutboundStatus } from "../../lib/dashboard-state";

/* ── Status badge ─────────────────────────────────────────────── */
type StatusInfo = { label: string; cls: string };

function getStatusBadge(m: MessageItem): StatusInfo | null {
  if (m.role !== "assistant" && m.role !== "system") return null;
  if (!m.outbound) return { label: "UNKNOWN", cls: "bg-slate-800 text-slate-500 border-slate-700" };

  const label = classifyOutboundStatus(m.outbound);
  const classes: Record<typeof label, string> = {
    "DRY RUN": "bg-amber-950 text-amber-400 border-amber-800",
    SENT: "bg-green-950 text-green-400 border-green-800",
    FAILED: "bg-red-950 text-red-400 border-red-800",
    "PROMPT GUARD": "bg-purple-950 text-purple-400 border-purple-800",
    "PERM DENIED": "bg-orange-950 text-orange-400 border-orange-800",
    COOLDOWN: "bg-yellow-950 text-yellow-400 border-yellow-800",
    BLOCKED: "bg-red-950 text-red-400 border-red-800",
    SKIPPED: "bg-slate-800 text-slate-400 border-slate-700",
    UNKNOWN: "bg-slate-800 text-slate-500 border-slate-700",
  };
  return { label, cls: classes[label] };
}

function StatusBadge({ m }: { m: MessageItem }) {
  const s = getStatusBadge(m);
  if (!s) return null;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${s.cls}`}>
      {s.label}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    user: "bg-slate-800 text-slate-400 border-slate-700",
    assistant: "bg-blue-950 text-blue-400 border-blue-800",
    system: "bg-slate-900 text-slate-500 border-slate-700",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border ${map[role] ?? "bg-slate-800 text-slate-400 border-slate-700"}`}>
      {role}
    </span>
  );
}

/* ── Page ─────────────────────────────────────────────────────── */
export default function MessagesPage() {
  const { toast } = useToast();
  const [data, setData] = useState<MessageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MessageItem | null>(null);

  const [search, setSearch] = useState("");
  const [threadFilter, setThreadFilter] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [debouncedThreadFilter, setDebouncedThreadFilter] = useState("");
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setDebouncedThreadFilter(threadFilter.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, threadFilter]);

  const fetchData = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError(null);
    const params: Record<string, string> = { page: String(page), pageSize: "30" };
    if (debouncedSearch) params.search = debouncedSearch;
    if (debouncedThreadFilter) params.threadId = debouncedThreadFilter;

    try {
      const response = await listMessages(params, controller.signal);
      if (controller.signal.aborted || requestIdRef.current !== requestId) return;

      const serverTotalPages = Math.max(1, response.totalPages);
      if (response.total > 0 && page > serverTotalPages) {
        setPage(serverTotalPages);
        return;
      }
      setData(response.data);
      setTotal(response.total);
      setTotalPages(serverTotalPages);
    } catch (err) {
      if (controller.signal.aborted || requestIdRef.current !== requestId) return;
      const message = err instanceof Error ? err.message : "Không tải được messages";
      setData([]);
      setTotal(0);
      setTotalPages(1);
      setError(message);
      toast("Không tải được messages", "error");
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    }
  }, [page, debouncedSearch, debouncedThreadFilter, toast]);

  useEffect(() => {
    void fetchData();
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [fetchData]);

  const inpCls = "min-w-[160px] rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none";

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Messages</h1>
          <p className="text-xs text-slate-500 mt-0.5">Lịch sử tin nhắn · tổng {total}</p>
        </div>
        <button onClick={fetchData} className="px-3 py-1.5 text-xs border border-slate-700 text-slate-400 rounded-md hover:bg-slate-800 transition-colors">🔄 Refresh</button>
      </div>

      {/* Filters supported by the backend contract */}
      <div className="flex flex-wrap gap-2">
        <input type="text" placeholder="Search content…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} className={inpCls} />
        <input type="text" placeholder="Thread ID…" value={threadFilter}
          onChange={(e) => { setThreadFilter(e.target.value); setPage(1); }} className={inpCls} />
        <button onClick={() => { setSearch(""); setThreadFilter(""); setPage(1); }}
          className="px-2.5 py-1.5 text-xs text-slate-400 border border-slate-700 rounded-md hover:bg-slate-800 transition-colors">
          Clear
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          Messages UNKNOWN — {error}
        </div>
      )}

      {/* Table */}
      {loading && data.length === 0 ? (
        <div className="space-y-1">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-slate-800 border border-slate-700" />
          ))}
        </div>
      ) : error ? null : data.length === 0 ? (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-12 text-center">
          <p className="text-slate-500 text-sm">Không có tin nhắn nào</p>
          <p className="text-slate-600 text-xs mt-1">
            {search || threadFilter ? "Thử xóa bộ lọc để xem tất cả." : "Không có bản ghi trong response hiện tại."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 border-b border-slate-700">
              <tr>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Time</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Role</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Status</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Thread</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Content</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Decision / Reason</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}
                  className="border-b border-slate-700/60 hover:bg-slate-700/30 transition-colors cursor-pointer"
                  onClick={() => setSelected(m)}>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <p className="text-xs text-slate-300">{formatRelativeTime(m.receivedAt)}</p>
                    <p className="text-[10px] text-slate-600">{formatVnTime(m.receivedAt, { showDate: false, showUtcLabel: false })}</p>
                  </td>
                  <td className="px-3 py-2.5"><RoleBadge role={m.role} /></td>
                  <td className="px-3 py-2.5"><StatusBadge m={m} /></td>
                  <td className="px-3 py-2.5 max-w-[120px]">
                    <p className="text-[11px] font-mono text-slate-500 truncate" title={m.threadId}>
                      {m.thread?.displayName ?? m.threadId.slice(-10)}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 max-w-[260px]">
                    <p className="text-xs text-slate-300 truncate" title={m.content}>
                      {m.content.slice(0, 80)}{m.content.length > 80 ? "…" : ""}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 max-w-[160px]">
                    {m.outbound ? (
                      <div>
                        <p className="text-[11px] text-slate-400 font-mono">{m.outbound.decision}</p>
                        {m.outbound.reason && (
                          <p className="text-[10px] text-slate-600 truncate" title={m.outbound.reason}>{m.outbound.reason}</p>
                        )}
                        {m.outbound.errorCode && (
                          <p className="text-[10px] text-red-500">{m.outbound.errorCode}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-700 text-[11px]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Trang {page}/{totalPages} · {total} tin</span>
          <div className="flex gap-1.5">
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 text-xs border border-slate-700 text-slate-400 rounded-md hover:bg-slate-800 disabled:opacity-30 transition-colors">← Trước</button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1 text-xs border border-slate-700 text-slate-400 rounded-md hover:bg-slate-800 disabled:opacity-30 transition-colors">Sau →</button>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selected && (
        <MessageDetailPanel msg={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

/* ── Detail panel ─────────────────────────────────────────────── */
function MessageDetailPanel({ msg, onClose }: { msg: MessageItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 shadow-raised overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <p className="text-sm font-semibold text-slate-200">Message Detail</p>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <InfoRow label="ID" value={<code className="font-mono text-[11px] text-blue-400">{msg.id}</code>} />
            <InfoRow label="Role" value={<RoleBadge role={msg.role} />} />
            <InfoRow label="Thread" value={<code className="font-mono text-[11px] text-slate-400">{msg.threadId}</code>} />
            <InfoRow label="Thread Type" value={msg.threadType} />
            <InfoRow label="Sender" value={msg.senderName ?? msg.senderId ?? "—"} />
            <InfoRow label="Time" value={formatVnTime(msg.receivedAt)} />
          </div>

          {/* Content */}
          <div>
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1.5">Content</p>
            <div className="rounded-md bg-slate-800 border border-slate-700 p-3 text-sm text-slate-200 whitespace-pre-wrap max-h-48 overflow-y-auto">
              {msg.content || <span className="text-slate-600">Empty</span>}
            </div>
          </div>

          {/* Outbound record */}
          {msg.outbound && (
            <div>
              <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1.5">Outbound Record</p>
              <div className="rounded-md bg-slate-800 border border-slate-700 p-3 space-y-2 text-xs">
                <InfoRow label="Decision" value={<code className="text-amber-400">{msg.outbound.decision}</code>} />
                <InfoRow label="Reason" value={msg.outbound.reason} />
                <InfoRow label="dryRun" value={msg.outbound.dryRun ? "🛡 YES" : "⚡ NO"} />
                <InfoRow label="Source" value={msg.outbound.source} />
                <InfoRow label="Sent ID" value={
                  msg.outbound.sentMessageId
                    ? <code className="font-mono text-green-400 text-[11px]">{msg.outbound.sentMessageId}</code>
                    : <span className="text-slate-600">—</span>
                } />
                {msg.outbound.errorCode && (
                  <InfoRow label="Error" value={<span className="text-red-400">{msg.outbound.errorCode}</span>} />
                )}
                <InfoRow label="Status" value={<StatusBadge m={msg} />} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-slate-600 uppercase tracking-wider">{label}</span>
      <span className="text-slate-300">{value}</span>
    </div>
  );
}
