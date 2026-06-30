"use client";

import { useEffect, useState, useCallback } from "react";
import { listMessages, type MessageItem } from "../../lib/api-client";
import { useToast } from "../../components/toast";

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
          <p className="text-sm text-slate-500 mt-1">Timeline các tin nhắn bot đã nhận và gửi</p>
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
      <p className="text-sm text-slate-500">Total: {total} messages | Page {page}/{totalPages}</p>

      {/* Table */}
      {loading && data.length === 0 ? (
        <div className="flex items-center justify-center h-64"><p className="text-slate-400">Đang tải...</p></div>
      ) : data.length > 0 ? (
        <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="p-2 text-left text-xs font-semibold uppercase">Time</th>
                <th className="p-2 text-left text-xs font-semibold uppercase">Role</th>
                <th className="p-2 text-left text-xs font-semibold uppercase">Thread</th>
                <th className="p-2 text-left text-xs font-semibold uppercase">Type</th>
                <th className="p-2 text-left text-xs font-semibold uppercase">Sender</th>
                <th className="p-2 text-left text-xs font-semibold uppercase">Content</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id} className={`border-b hover:bg-slate-50 ${m.isFromBot ? "bg-blue-50/30" : ""}`}>
                  <td className="p-2 text-xs text-slate-500 whitespace-nowrap">
                    {new Date(m.receivedAt || m.createdAt).toLocaleString("vi-VN")}
                  </td>
                  <td className="p-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                      m.role === "assistant" ? "bg-blue-100 text-blue-700" :
                      m.role === "system" ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-600"
                    }`}>
                      {m.role}
                    </span>
                  </td>
                  <td className="p-2 text-xs max-w-[160px]" title={m.threadId}>
                    {m.thread?.displayName ? (
                      <div>
                        <div className="font-medium text-slate-700 truncate">{m.thread.displayName}</div>
                        <div className="font-mono text-[10px] text-slate-400 truncate">{m.threadId}</div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-slate-400 text-[10px]">Unknown thread</div>
                        <div className="font-mono text-[10px] text-slate-500 truncate">{m.threadId}</div>
                      </div>
                    )}
                  </td>
                  <td className="p-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                      m.threadType === "user" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"
                    }`}>
                      {m.threadType}
                    </span>
                    {m.messageType !== "text" && (
                      <span className="ml-1 text-xs text-orange-500">{m.messageType}</span>
                    )}
                  </td>
                  <td className="p-2 text-xs text-slate-500 max-w-[100px] truncate">
                    {m.senderName ?? m.senderId?.slice(-8) ?? "—"}
                  </td>
                  <td className="p-2 text-xs max-w-[400px] truncate" title={m.content}>
                    {m.content?.slice(0, 80)}{m.content?.length > 80 ? "…" : ""}
                  </td>
                </tr>
              ))}
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
    </div>
  );
}
