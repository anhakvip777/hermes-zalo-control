"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  PageHeader,
  LoadingSpinner,
  EmptyState,
  ErrorBanner,
  DarkButton,
  DarkCheckbox,
  DarkInput,
  DarkTable,
  DarkThead,
  DarkTh,
  DarkTr,
  DarkTd,
  StatusPill,
} from "../../components/ui/dark";

// ── Types ──────────────────────────────────────────────────────────────
interface ThreadSettings {
  threadId: string;
  type: "user" | "group";
  autoReplyEnabled: boolean;
  groupMentionRequired: boolean;
  groupReplyWindowSeconds: number;
  allowCreateReminder: boolean;
  allowMedia: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

function getHeaders(): Record<string, string> {
  const ADMIN_PASS =
    typeof window !== "undefined"
      ? localStorage.getItem("admin_pass") || ""
      : "";
  return {
    "Content-Type": "application/json",
    Authorization: "Basic " + btoa("admin:" + ADMIN_PASS),
  };
}

// ── Inline Edit Row ────────────────────────────────────────────────────
function EditRow({
  settings,
  onSave,
  onCancel,
}: {
  settings: ThreadSettings;
  onSave: (updated: ThreadSettings) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ThreadSettings>({ ...settings });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/threads/${settings.threadId}/settings`,
        {
          method: "PATCH",
          headers: getHeaders(),
          body: JSON.stringify({
            autoReplyEnabled: form.autoReplyEnabled,
            groupMentionRequired: form.groupMentionRequired,
            groupReplyWindowSeconds: form.groupReplyWindowSeconds,
            allowCreateReminder: form.allowCreateReminder,
            allowMedia: form.allowMedia,
          }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      onSave(data as ThreadSettings);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("Lỗi khi lưu: " + msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DarkTr highlight="blue">
      <DarkTd><span className="font-mono text-xs text-slate-400">{settings.threadId}</span></DarkTd>
      <DarkTd><span className="text-slate-300 text-sm">{settings.type}</span></DarkTd>
      <DarkTd>
        <DarkCheckbox label="Tự động" checked={form.autoReplyEnabled} onChange={(v) => setForm((f) => ({ ...f, autoReplyEnabled: v }))} />
      </DarkTd>
      <DarkTd>
        <DarkCheckbox label="Mention" checked={form.groupMentionRequired} onChange={(v) => setForm((f) => ({ ...f, groupMentionRequired: v }))} />
      </DarkTd>
      <DarkTd>
        <div className="flex items-center gap-1.5">
          <DarkInput
            type="number"
            value={form.groupReplyWindowSeconds}
            onChange={(e) => setForm((f) => ({ ...f, groupReplyWindowSeconds: Number(e.target.value) }))}
            className="w-20"
            min={0}
          />
          <span className="text-xs text-slate-500">s</span>
        </div>
      </DarkTd>
      <DarkTd>
        <DarkCheckbox label="Nhắc nhở" checked={form.allowCreateReminder} onChange={(v) => setForm((f) => ({ ...f, allowCreateReminder: v }))} />
      </DarkTd>
      <DarkTd>
        <DarkCheckbox label="Media" checked={form.allowMedia} onChange={(v) => setForm((f) => ({ ...f, allowMedia: v }))} />
      </DarkTd>
      <DarkTd>
        <div className="flex gap-1.5">
          <DarkButton variant="success" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Đang lưu..." : "💾 Lưu"}
          </DarkButton>
          <DarkButton variant="ghost" size="sm" onClick={onCancel}>Hủy</DarkButton>
        </div>
      </DarkTd>
    </DarkTr>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────
export default function ThreadSettingsPage() {
  const [threads, setThreads] = useState<ThreadSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/threads/settings`, { headers: getHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.threads ?? [];
      setThreads(list);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError("Không thể tải cài đặt: " + msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const handleSaved = (updated: ThreadSettings) => {
    setThreads((prev) => prev.map((t) => (t.threadId === updated.threadId ? updated : t)));
    setEditingId(null);
  };

  if (loading && threads.length === 0 && !error) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="⚙️ Cài đặt Thread"
        subtitle="Quản lý cài đặt tự động trả lời và các tuỳ chọn cho từng thread"
        onRefresh={fetchSettings}
      />

      {error && <ErrorBanner message={error} />}

      {!loading && !error && threads.length === 0 ? (
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
            <DarkTh>Thao tác</DarkTh>
          </DarkThead>
          <tbody>
            {threads.map((t) =>
              editingId === t.threadId ? (
                <EditRow key={t.threadId} settings={t} onSave={handleSaved} onCancel={() => setEditingId(null)} />
              ) : (
                <DarkTr key={t.threadId}>
                  <DarkTd><span className="font-mono text-xs text-slate-400">{t.threadId}</span></DarkTd>
                  <DarkTd>
                    <StatusPill variant={t.type === "group" ? "warn" : "info"}>
                      {t.type === "group" ? "👥 Nhóm" : "👤 Cá nhân"}
                    </StatusPill>
                  </DarkTd>
                  <DarkTd>
                    <StatusPill variant={t.autoReplyEnabled ? "active" : "inactive"}>
                      {t.autoReplyEnabled ? "✅ Bật" : "❌ Tắt"}
                    </StatusPill>
                  </DarkTd>
                  <DarkTd>
                    <StatusPill variant={t.groupMentionRequired ? "active" : "inactive"}>
                      {t.groupMentionRequired ? "✅ Bật" : "❌ Tắt"}
                    </StatusPill>
                  </DarkTd>
                  <DarkTd><span className="text-slate-300 text-sm">{t.groupReplyWindowSeconds}s</span></DarkTd>
                  <DarkTd>
                    <StatusPill variant={t.allowCreateReminder ? "active" : "inactive"}>
                      {t.allowCreateReminder ? "✅ Bật" : "❌ Tắt"}
                    </StatusPill>
                  </DarkTd>
                  <DarkTd>
                    <StatusPill variant={t.allowMedia ? "active" : "inactive"}>
                      {t.allowMedia ? "✅ Bật" : "❌ Tắt"}
                    </StatusPill>
                  </DarkTd>
                  <DarkTd>
                    <DarkButton variant="primary" size="sm" onClick={() => setEditingId(t.threadId)}>
                      ✏️ Sửa
                    </DarkButton>
                  </DarkTd>
                </DarkTr>
              )
            )}
          </tbody>
        </DarkTable>
      )}
    </div>
  );
}
