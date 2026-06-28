"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "../../lib/api";
import { StatusBadge } from "../../components/status-badge";
import { useToast } from "../../components/toast";

interface Session {
  id: string;
  name: string;
  targetId: string;
  targetName: string | null;
  status: string;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  expectedCount: number | null;
  actualCount: number;
  reminderSent: boolean;
}

interface Record_ {
  id: string;
  sessionId: string;
  userId: string;
  userName: string | null;
  response: string | null;
  messageId: string | null;
  checkedInAt: string;
}

export default function AttendancePage() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Session | null>(null);
  const [records, setRecords] = useState<Record_[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const fetchSessions = useCallback(() => {
    setLoading(true);
    apiFetch<{ data: Session[] }>("/api/attendance/sessions")
      .then((res) => setSessions(res.data))
      .catch(() => toast("Failed to load sessions", "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const fetchRecords = (sessionId: string) => {
    apiFetch<{ data: Record_[] }>(`/api/attendance/sessions/${sessionId}/records`)
      .then((res) => setRecords(res.data))
      .catch(() => toast("Failed to load records", "error"));
  };

  const doAction = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg, "success");
      fetchSessions();
      if (selected) {
        const s = await apiFetch<{ data: Session }>(`/api/attendance/sessions/${selected.id}`);
        setSelected(s.data);
        if (s.data.status === "active" || s.data.status === "closed") {
          fetchRecords(selected.id);
        }
      }
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Action failed", "error");
    }
  };

  const selectSession = async (s: Session) => {
    setSelected(s);
    if (s.status === "active" || s.status === "closed") {
      fetchRecords(s.id);
    } else {
      setRecords([]);
    }
  };

  const exportCsv = (id: string) => {
    window.open(`/api/attendance/sessions/${id}/export.csv`, "_blank");
  };

  const btn = "rounded-md px-3 py-1.5 text-xs font-medium text-white hover:opacity-90";
  const cardBg = "rounded-lg border border-slate-800 bg-slate-900 p-4";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight text-white">Attendance</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
        >
          Create Session
        </button>
      </div>

      {showCreate && (
        <CreateSessionForm
          onDone={() => { setShowCreate(false); fetchSessions(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {loading && sessions.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-slate-800" />)}
        </div>
      ) : sessions.length === 0 ? (
        <div className={`${cardBg} p-10 text-center text-sm text-slate-500`}>
          No attendance sessions yet. Create one to get started.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-left text-xs text-slate-300">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Count</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.id}
                  className={`cursor-pointer border-t border-slate-800 text-slate-200 hover:bg-slate-800/50 ${selected?.id === s.id ? "bg-slate-800/70" : ""}`}
                  onClick={() => selectSession(s)}
                >
                  <td className="max-w-[180px] truncate px-3 py-2 font-medium">{s.name}</td>
                  <td className="max-w-[120px] truncate px-3 py-2 text-xs">{s.targetName ?? s.targetId}</td>
                  <td className="px-3 py-2"><StatusBadge status={s.status} /></td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {s.actualCount}{s.expectedCount ? ` / ${s.expectedCount}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); selectSession(s); }}
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

      {/* Session Detail */}
      {selected && (
        <div className={cardBg}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-white">{selected.name}</h3>
              <p className="text-sm text-slate-400">
                {selected.targetName ?? selected.targetId} · <StatusBadge status={selected.status} />
              </p>
              <div className="mt-2 flex gap-2">
                {selected.status === "draft" && (
                  <button onClick={() => doAction(() => apiFetch(`/api/attendance/sessions/${selected.id}/start`, { method: "POST" }), "Started")} className={`${btn} bg-green-700 hover:bg-green-600`}>Start</button>
                )}
                {selected.status === "active" && (
                  <>
                    <button onClick={() => doAction(() => apiFetch(`/api/attendance/sessions/${selected.id}/send-reminder`, { method: "POST" }), "Reminder sent")} className={`${btn} bg-blue-700 hover:bg-blue-600`}>Send Reminder</button>
                    <button onClick={() => doAction(() => apiFetch(`/api/attendance/sessions/${selected.id}/parse-messages`, { method: "POST" }), "Parsed")} className={`${btn} bg-purple-700 hover:bg-purple-600`}>Parse Messages</button>
                    <button onClick={() => doAction(() => apiFetch(`/api/attendance/sessions/${selected.id}/close`, { method: "POST" }), "Closed")} className={`${btn} bg-yellow-700 hover:bg-yellow-600`}>Close</button>
                  </>
                )}
                {(selected.status === "active" || selected.status === "closed") && (
                  <button onClick={() => exportCsv(selected.id)} className={`${btn} bg-teal-700 hover:bg-teal-600`}>Export CSV</button>
                )}
                {selected.status !== "cancelled" && selected.status !== "closed" && (
                  <button onClick={() => doAction(() => apiFetch(`/api/attendance/sessions/${selected.id}/cancel`, { method: "POST" }), "Cancelled")} className={`${btn} bg-red-700 hover:bg-red-600`}>Cancel</button>
                )}
              </div>
            </div>
          </div>

          {/* Records */}
          {records.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-sm font-semibold text-slate-300">
                Records ({records.length})
              </h4>
              <div className="overflow-x-auto rounded-md border border-slate-800">
                <table className="w-full text-xs">
                  <thead className="bg-slate-800 text-left text-slate-400">
                    <tr>
                      <th className="px-3 py-1.5">User</th>
                      <th className="px-3 py-1.5">Response</th>
                      <th className="px-3 py-1.5">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id} className="border-t border-slate-800 text-slate-200">
                        <td className="px-3 py-1.5">{r.userName ?? r.userId}</td>
                        <td className="px-3 py-1.5">{r.response ?? "—"}</td>
                        <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">
                          {new Date(r.checkedInAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Create Session Form ────────────────────────────────────────────
function CreateSessionForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    targetId: "",
    targetName: "",
    scheduledAt: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.targetId) {
      toast("Name and target ID are required", "error");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/attendance/sessions", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          targetId: form.targetId,
          targetName: form.targetName || undefined,
          scheduledAt: form.scheduledAt || undefined,
        }),
      });
      toast("Session created", "success");
      onDone();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Create failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const inp = "w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500";
  const lbl = "mb-1 block text-xs font-medium text-slate-400";

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="mb-3 text-lg font-semibold text-white">Create Attendance Session</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block"><span className={lbl}>Name *</span><input className={inp} value={form.name} onChange={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })} placeholder="Điểm danh tối nay" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Target ID *</span><input className={inp} value={form.targetId} onChange={(e) => setForm({ ...form, targetId: (e.target as HTMLInputElement).value })} placeholder="group-123" /></label>
          <label className="block"><span className={lbl}>Target Name</span><input className={inp} value={form.targetName} onChange={(e) => setForm({ ...form, targetName: (e.target as HTMLInputElement).value })} placeholder="Lớp Tu Học" /></label>
        </div>
        <label className="block"><span className={lbl}>Scheduled At</span><input type="datetime-local" className={inp} value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: (e.target as HTMLInputElement).value })} /></label>
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="rounded-md bg-slate-700 px-4 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-600 disabled:opacity-50">{saving ? "Creating…" : "Create"}</button>
          <button type="button" onClick={onCancel} className="rounded-md border border-slate-700 px-4 py-1.5 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
        </div>
      </form>
    </div>
  );
}
