"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { listSchedules, createSchedule, type Schedule } from "../../lib/api-client";
import { StatusBadge, TypeBadge } from "../../components/status-badge";
import { useToast } from "../../components/toast";

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
      .catch(() => toast("Failed to load schedules", "error"))
      .finally(() => setLoading(false));
  }, [page, status, type, search, sortBy, sortOrder, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortOrder("asc");
    }
    setPage(1);
  };

  const sortArrow = (col: string) => {
    if (sortBy !== col) return <span className="text-slate-600">↕</span>;
    return sortOrder === "asc" ? "↑" : "↓";
  };

  const selClass = "rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200";
  const inputClass = "min-w-[200px] rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight text-white">
          Schedules{" "}
          <span className="text-base font-normal text-slate-500">({total})</span>
        </h2>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
        >
          Create Schedule
        </button>
      </div>

      {showCreate && (
        <CreateScheduleForm
          onDone={() => {
            setShowCreate(false);
            fetchData();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={status}
          onChange={(e) => {
            setStatus((e.target as HTMLSelectElement).value);
            setPage(1);
          }}
          className={selClass}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="scheduled">Scheduled</option>
          <option value="draft">Draft</option>
          <option value="paused">Paused</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={type}
          onChange={(e) => {
            setType((e.target as HTMLSelectElement).value);
            setPage(1);
          }}
          className={selClass}
        >
          <option value="">All types</option>
          <option value="zalo_message">Zalo Message</option>
          <option value="attendance">Attendance</option>
          <option value="poll_extract">Poll Extract</option>
          <option value="custom_agent_task">Agent Task</option>
        </select>
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => {
            setSearch((e.target as HTMLInputElement).value);
            setPage(1);
          }}
          className={inputClass}
        />
        <button
          onClick={() => {
            setStatus("");
            setType("");
            setSearch("");
            setPage(1);
          }}
          className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
        >
          Clear
        </button>
        <button
          onClick={fetchData}
          className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
        >
          Refresh
        </button>
      </div>

      {/* Table */}
      {loading && data.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-slate-800" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-10 text-center text-sm text-slate-500">
          {search || status || type
            ? "No schedules match your filters."
            : "No schedules yet. Create one to get started."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-left text-xs text-slate-300">
              <tr>
                <th className="cursor-pointer px-3 py-2" onClick={() => toggleSort("name")}>
                  Name {sortArrow("name")}
                </th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Target</th>
                <th className="cursor-pointer px-3 py-2" onClick={() => toggleSort("nextRunAt")}>
                  Next Run {sortArrow("nextRunAt")}
                </th>
                <th className="px-3 py-2">Ver</th>
                <th className="px-3 py-2">By</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr
                  key={s.id}
                  className="cursor-pointer border-t border-slate-800 text-slate-200 hover:bg-slate-800/50"
                  onClick={() => router.push(`/schedules/${s.id}`)}
                >
                  <td className="max-w-[180px] truncate px-3 py-2 font-medium" title={s.name}>
                    {s.name}
                  </td>
                  <td className="px-3 py-2">
                    <TypeBadge type={s.type} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="max-w-[120px] truncate px-3 py-2 text-xs" title={s.targetName ?? s.targetId}>
                    {s.targetName ?? s.targetId}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">
                    {s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">v{s.version}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{s.createdBy}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/schedules/${s.id}`);
                      }}
                      className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
                    >
                      View
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
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="flex gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 disabled:opacity-30"
            >
              Prev
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline Create Schedule Form
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
      toast("Name, target ID, and message content are required", "error");
      return;
    }
    setSaving(true);
    try {
      await createSchedule({
        name: form.name,
        type: "zalo_message",
        scheduledAt: form.scheduledAt
          ? new Date(form.scheduledAt).toISOString()
          : undefined,
        messageContent: form.messageContent,
        targetId: form.targetId,
        targetName: form.targetName || undefined,
        createdBy: "user",
      });
      toast("Schedule created", "success");
      onDone();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Create failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, required: boolean, el: React.ReactNode) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">
        {label} {required && <span className="text-red-400">*</span>}
      </span>
      {el}
    </label>
  );

  const inp = "w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none";

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="mb-3 text-lg font-semibold text-white">Create Schedule</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        {field(
          "Name",
          true,
          <input
            className={inp}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })}
            placeholder='e.g. "Nhắc Lễ Phật tối nay"'
          />,
        )}
        {field(
          "Scheduled At",
          false,
          <input
            type="datetime-local"
            className={inp}
            value={form.scheduledAt}
            onChange={(e) =>
              setForm({ ...form, scheduledAt: (e.target as HTMLInputElement).value })
            }
          />,
        )}
        <div className="grid grid-cols-2 gap-3">
          {field(
            "Target ID",
            true,
            <input
              className={inp}
              value={form.targetId}
              onChange={(e) =>
                setForm({ ...form, targetId: (e.target as HTMLInputElement).value })
              }
              placeholder="group-123"
            />,
          )}
          {field(
            "Target Name",
            false,
            <input
              className={inp}
              value={form.targetName}
              onChange={(e) =>
                setForm({ ...form, targetName: (e.target as HTMLInputElement).value })
              }
              placeholder='e.g. "Lớp Tu Học"'
            />,
          )}
        </div>
        {field(
          "Message Content",
          true,
          <textarea
            className={inp}
            rows={3}
            value={form.messageContent}
            onChange={(e) =>
              setForm({ ...form, messageContent: (e.target as HTMLTextAreaElement).value })
            }
            placeholder="Nội dung sẽ gửi…"
          />,
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-slate-700 px-4 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-600 disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-700 px-4 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
