"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  listSchedules,
  createSchedule,
  type Schedule,
} from "../../lib/api-client";
import { useToast } from "../../components/toast";
import { formatVnTime, formatRelativeTime } from "../../components/ui/TimeText";

/* ── Status badges ──────────────────────────────────────────────── */
const STATUS_STYLE: Record<string, string> = {
  active:       "bg-green-950 text-green-400 border-green-800",
  scheduled:    "bg-cyan-950 text-cyan-400 border-cyan-800",
  draft:        "bg-slate-800 text-slate-400 border-slate-700",
  paused:       "bg-yellow-950 text-yellow-400 border-yellow-800",
  cancelled:    "bg-slate-800 text-slate-500 border-slate-700",
  expired:      "bg-slate-900 text-slate-500 border-slate-700",
  completed:    "bg-green-950 text-green-400 border-green-800",
  failed:       "bg-red-950 text-red-400 border-red-800",
  queued:       "bg-blue-950 text-blue-400 border-blue-800",
  running:      "bg-cyan-950 text-cyan-400 border-cyan-800",
};

const TYPE_LABEL: Record<string, string> = {
  zalo_message:      "Zalo Msg",
  attendance:        "Attendance",
  poll_extract:      "Poll",
  custom_agent_task: "Agent Task",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLE[status] ?? "bg-slate-800 text-slate-400 border-slate-700";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {status}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-900 text-slate-400 border border-slate-700 text-[11px] font-mono">
      {TYPE_LABEL[type] ?? type}
    </span>
  );
}

/* ── Page ───────────────────────────────────────────────────────── */
export default function SchedulesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = useState<Schedule[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("nextRunAt");
  const [sortOrder, setSortOrder] = useState("desc");

  const fetchData = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {
      page: String(page),
      pageSize: "20",
      sortBy,
      sortOrder,
    };
    if (status) params.status = status;
    if (type) params.type = type;
    if (search) params.search = search;

    listSchedules(params)
      .then((res) => {
        setData(res.data);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      })
      .catch(() => toast("Không tải được schedules", "error"))
      .finally(() => setLoading(false));
  }, [page, status, type, search, sortBy, sortOrder, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortOrder("asc"); }
    setPage(1);
  };

  const sortArrow = (col: string) =>
    sortBy !== col ? <span className="text-slate-600">↕</span> : sortOrder === "asc" ? "↑" : "↓";

  const selCls = "rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 focus:border-blue-500 focus:outline-none";
  const inpCls = "min-w-[180px] rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none";

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Schedules</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Lịch trình gửi tin nhắn · tổng {total}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors"
        >
          + Tạo mới
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateScheduleForm
          onDone={() => { setShowCreate(false); fetchData(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={selCls}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="scheduled">Scheduled</option>
          <option value="draft">Draft</option>
          <option value="paused">Paused</option>
          <option value="cancelled">Cancelled</option>
          <option value="completed">Completed</option>
        </select>
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className={selCls}>
          <option value="">All types</option>
          <option value="zalo_message">Zalo Message</option>
          <option value="attendance">Attendance</option>
          <option value="poll_extract">Poll Extract</option>
          <option value="custom_agent_task">Agent Task</option>
        </select>
        <input
          type="text"
          placeholder="Search name / content…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className={inpCls}
        />
        <button onClick={() => { setStatus(""); setType(""); setSearch(""); setPage(1); }}
          className="px-2.5 py-1.5 text-xs text-slate-400 border border-slate-700 rounded-md hover:bg-slate-800 transition-colors">
          Clear
        </button>
        <button onClick={fetchData}
          className="px-2.5 py-1.5 text-xs text-slate-400 border border-slate-700 rounded-md hover:bg-slate-800 transition-colors">
          🔄
        </button>
      </div>

      {/* Table */}
      {loading && data.length === 0 ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-slate-800 border border-slate-700" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-12 text-center">
          <p className="text-slate-500 text-sm">Không có schedule nào</p>
          <p className="text-slate-600 text-xs mt-1">
            {search || status || type ? "Thử xóa bộ lọc để xem tất cả." : "Tạo schedule để bắt đầu."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 border-b border-slate-700">
              <tr>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider cursor-pointer select-none"
                    onClick={() => toggleSort("name")}>
                  Name {sortArrow("name")}
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Type</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Status</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Content</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Target</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider cursor-pointer select-none"
                    onClick={() => toggleSort("nextRunAt")}>
                  Next Run {sortArrow("nextRunAt")}
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">By</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-slate-700/60 hover:bg-slate-700/30 transition-colors cursor-pointer"
                  onClick={() => router.push(`/schedules/${s.id}`)}
                >
                  <td className="px-3 py-2.5 max-w-[180px]">
                    <p className="text-slate-200 font-medium truncate" title={s.name}>{s.name}</p>
                    {s.originalCommand && (
                      <p className="text-[10px] text-slate-600 font-mono truncate mt-0.5" title={s.originalCommand}>
                        {s.originalCommand.slice(0, 40)}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><TypeBadge type={s.type} /></td>
                  <td className="px-3 py-2.5"><StatusBadge status={s.status} /></td>
                  <td className="px-3 py-2.5 max-w-[200px]">
                    <p className="text-slate-400 text-xs truncate" title={s.messageContent}>
                      {s.messageContent?.slice(0, 50)}{(s.messageContent?.length ?? 0) > 50 ? "…" : ""}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 max-w-[120px]">
                    <p className="text-slate-400 text-xs truncate" title={s.targetId}>
                      {s.targetName ?? s.targetId}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {s.nextRunAt ? (
                      <div>
                        <p className="text-xs text-slate-300">{formatRelativeTime(s.nextRunAt)}</p>
                        <p className="text-[10px] text-slate-600">{formatVnTime(s.nextRunAt, { showDate: true, showUtcLabel: false })}</p>
                      </div>
                    ) : (
                      <span className="text-slate-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{s.createdBy}</td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); router.push(`/schedules/${s.id}`); }}
                      className="px-2 py-0.5 text-[11px] text-slate-400 border border-slate-700 rounded-md hover:bg-slate-700 hover:text-slate-200 transition-colors"
                    >
                      View →
                    </button>
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
          <span className="text-xs text-slate-500">
            Trang {page}/{totalPages} · {total} schedules
          </span>
          <div className="flex gap-1.5">
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 text-xs border border-slate-700 text-slate-400 rounded-md hover:bg-slate-800 disabled:opacity-30 transition-colors">
              ← Trước
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1 text-xs border border-slate-700 text-slate-400 rounded-md hover:bg-slate-800 disabled:opacity-30 transition-colors">
              Sau →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Create Schedule Form ───────────────────────────────────────── */
function CreateScheduleForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    scheduledAt: "",
    targetId: "",
    targetName: "",
    messageContent: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.messageContent || !form.targetId) {
      toast("Name, target ID và content là bắt buộc", "error");
      return;
    }
    setSaving(true);
    try {
      await createSchedule({
        name: form.name,
        type: "zalo_message",
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined,
        messageContent: form.messageContent,
        targetId: form.targetId,
        targetName: form.targetName || undefined,
        createdBy: "user",
      });
      toast("Schedule đã tạo", "success");
      onDone();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Tạo thất bại", "error");
    } finally {
      setSaving(false);
    }
  };

  const inp = "w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none";

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-5">
      <h3 className="text-sm font-semibold text-slate-200 mb-4">Tạo Schedule mới</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block">
          <span className="text-[11px] text-slate-500 mb-1 block">Name <span className="text-red-400">*</span></span>
          <input className={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder='e.g. "Nhắc họp tối nay"' />
        </label>
        <label className="block">
          <span className="text-[11px] text-slate-500 mb-1 block">Scheduled At (UTC+7)</span>
          <input type="datetime-local" className={inp} value={form.scheduledAt}
            onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] text-slate-500 mb-1 block">Target Thread ID <span className="text-red-400">*</span></span>
            <input className={inp} value={form.targetId}
              onChange={(e) => setForm({ ...form, targetId: e.target.value })} placeholder="thread-id..." />
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-500 mb-1 block">Target Name</span>
            <input className={inp} value={form.targetName}
              onChange={(e) => setForm({ ...form, targetName: e.target.value })} placeholder="Tên nhóm/người..." />
          </label>
        </div>
        <label className="block">
          <span className="text-[11px] text-slate-500 mb-1 block">Nội dung <span className="text-red-400">*</span></span>
          <textarea className={inp} rows={3} value={form.messageContent}
            onChange={(e) => setForm({ ...form, messageContent: e.target.value })}
            placeholder="Nội dung tin nhắn sẽ gửi…" />
        </label>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md disabled:opacity-50 transition-colors">
            {saving ? "Đang tạo…" : "Tạo Schedule"}
          </button>
          <button type="button" onClick={onCancel}
            className="px-4 py-1.5 border border-slate-700 text-slate-400 text-sm rounded-md hover:bg-slate-800 transition-colors">
            Hủy
          </button>
        </div>
      </form>
    </div>
  );
}
