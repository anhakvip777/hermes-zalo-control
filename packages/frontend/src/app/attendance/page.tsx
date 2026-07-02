"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "../../lib/api";
import { StatusBadge } from "../../components/status-badge";
import { useToast } from "../../components/toast";
import {
  Card,
  PageHeader,
  LoadingSpinner,
  EmptyState,
  ErrorBanner,
  DarkButton,
  DarkInput,
  StatusPill,
  DarkTable,
  DarkThead,
  DarkTh,
  DarkTr,
  DarkTd,
} from "../../components/ui/dark";

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

function sessionStatusVariant(status: string): "active" | "inactive" | "ready" | "failed" | "warn" {
  switch (status) {
    case "active": return "active";
    case "draft": return "inactive";
    case "closed": return "ready";
    case "cancelled": return "failed";
    default: return "warn";
  }
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

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

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
    if (s.status === "active" || s.status === "closed") fetchRecords(s.id);
    else setRecords([]);
  };

  const exportCsv = (id: string) => {
    window.open(`/api/attendance/sessions/${id}/export.csv`, "_blank");
  };

  if (loading && sessions.length === 0) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="📋 Attendance"
        subtitle="Quản lý điểm danh — tạo session, theo dõi, export CSV"
        onRefresh={fetchSessions}
      >
        <DarkButton variant="primary" size="sm" onClick={() => setShowCreate(true)}>
          + Tạo Session
        </DarkButton>
      </PageHeader>

      {showCreate && (
        <CreateSessionForm
          onDone={() => { setShowCreate(false); fetchSessions(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {sessions.length === 0 ? (
        <EmptyState message="Chưa có session nào. Tạo session mới để bắt đầu." icon="📋" />
      ) : (
        <DarkTable>
          <DarkThead>
            <DarkTh>Tên</DarkTh>
            <DarkTh>Target</DarkTh>
            <DarkTh>Status</DarkTh>
            <DarkTh>Count</DarkTh>
            <DarkTh>Thao tác</DarkTh>
          </DarkThead>
          <tbody>
            {sessions.map((s) => (
              <DarkTr key={s.id} highlight={selected?.id === s.id ? "blue" : undefined}>
                <DarkTd>
                  <button
                    onClick={() => selectSession(s)}
                    className="font-medium text-slate-200 hover:text-blue-400 text-left transition-colors"
                  >
                    {s.name}
                  </button>
                </DarkTd>
                <DarkTd><span className="text-slate-400 text-xs">{s.targetName ?? s.targetId}</span></DarkTd>
                <DarkTd>
                  <StatusPill variant={sessionStatusVariant(s.status)}>{s.status}</StatusPill>
                </DarkTd>
                <DarkTd>
                  <span className="text-slate-400 text-xs">
                    {s.actualCount}{s.expectedCount ? ` / ${s.expectedCount}` : ""}
                  </span>
                </DarkTd>
                <DarkTd>
                  <DarkButton variant="ghost" size="sm" onClick={() => selectSession(s)}>View</DarkButton>
                </DarkTd>
              </DarkTr>
            ))}
          </tbody>
        </DarkTable>
      )}

      {/* Session Detail */}
      {selected && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-100">{selected.name}</h3>
              <p className="text-sm text-slate-400">
                {selected.targetName ?? selected.targetId} ·{" "}
                <StatusPill variant={sessionStatusVariant(selected.status)}>{selected.status}</StatusPill>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selected.status === "draft" && (
                <DarkButton variant="success" size="sm" onClick={() => doAction(() => apiFetch(`/api/attendance/sessions/${selected.id}/start`, { method: "POST" }), "Started")}>
                  ▶ Start
                </DarkButton>
              )}
              {selected.status === "active" && (
                <>
                  <DarkButton variant="primary" size="sm" onClick={() => doAction(() => apiFetch(`/api/attendance/sessions/${selected.id}/send-reminder`, { method: "POST" }), "Reminder sent")}>
                    🔔 Nhắc nhở
                  </DarkButton>
                  <DarkButton variant="ghost" size="sm" onClick={() => doAction(() => apiFetch(`/api/attendance/sessions/${selected.id}/parse-messages`, { method: "POST" }), "Parsed")}>
                    🔍 Parse
                  </DarkButton>
                  <DarkButton variant="warn" size="sm" onClick={() => doAction(() => apiFetch(`/api/attendance/sessions/${selected.id}/close`, { method: "POST" }), "Closed")}>
                    ✓ Đóng
                  </DarkButton>
                </>
              )}
              {(selected.status === "active" || selected.status === "closed") && (
                <DarkButton variant="ghost" size="sm" onClick={() => exportCsv(selected.id)}>
                  📊 Export CSV
                </DarkButton>
              )}
              {selected.status !== "cancelled" && selected.status !== "closed" && (
                <DarkButton variant="danger" size="sm" onClick={() => doAction(() => apiFetch(`/api/attendance/sessions/${selected.id}/cancel`, { method: "POST" }), "Cancelled")}>
                  ✕ Hủy
                </DarkButton>
              )}
            </div>
          </div>

          {records.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-400 mb-2">Records ({records.length})</p>
              <DarkTable>
                <DarkThead>
                  <DarkTh>User</DarkTh>
                  <DarkTh>Response</DarkTh>
                  <DarkTh>Time</DarkTh>
                </DarkThead>
                <tbody>
                  {records.map((r) => (
                    <DarkTr key={r.id}>
                      <DarkTd><span className="text-slate-300 text-xs">{r.userName ?? r.userId}</span></DarkTd>
                      <DarkTd><span className="text-slate-400 text-xs">{r.response ?? "—"}</span></DarkTd>
                      <DarkTd><span className="text-slate-500 text-xs whitespace-nowrap">{new Date(r.checkedInAt).toLocaleString()}</span></DarkTd>
                    </DarkTr>
                  ))}
                </tbody>
              </DarkTable>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Create Session Form ────────────────────────────────────────────
function CreateSessionForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", targetId: "", targetName: "", scheduledAt: "" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.targetId) { toast("Name and target ID are required", "error"); return; }
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
    } finally { setSaving(false); }
  };

  return (
    <Card>
      <h3 className="text-lg font-semibold text-slate-100 mb-4">Tạo Attendance Session</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Tên *</label>
          <DarkInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Điểm danh tối nay" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Target ID *</label>
            <DarkInput value={form.targetId} onChange={(e) => setForm({ ...form, targetId: e.target.value })} placeholder="group-123" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Target Name</label>
            <DarkInput value={form.targetName} onChange={(e) => setForm({ ...form, targetName: e.target.value })} placeholder="Lớp Tu Học" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Scheduled At</label>
          <DarkInput type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <DarkButton type="submit" variant="primary" size="md" disabled={saving}>{saving ? "Đang tạo…" : "Tạo"}</DarkButton>
          <DarkButton type="button" variant="ghost" size="md" onClick={onCancel}>Hủy</DarkButton>
        </div>
      </form>
    </Card>
  );
}
