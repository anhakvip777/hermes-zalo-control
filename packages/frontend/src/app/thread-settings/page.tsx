"use client";

import { useState, useEffect, useCallback } from "react";

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

function toggle(value: boolean): string {
  return value ? "✅ Bật" : "❌ Tắt";
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
    } catch (err: any) {
      alert("Lỗi khi lưu: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="bg-blue-50">
      <td className="px-4 py-3 font-mono text-sm">{settings.threadId}</td>
      <td className="px-4 py-3 text-sm">{settings.type}</td>
      <td className="px-4 py-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.autoReplyEnabled}
            onChange={(e) =>
              setForm((f) => ({ ...f, autoReplyEnabled: e.target.checked }))
            }
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Tự động trả lời
        </label>
      </td>
      <td className="px-4 py-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.groupMentionRequired}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                groupMentionRequired: e.target.checked,
              }))
            }
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Yêu cầu mention
        </label>
      </td>
      <td className="px-4 py-3">
        <input
          type="number"
          value={form.groupReplyWindowSeconds}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              groupReplyWindowSeconds: Number(e.target.value),
            }))
          }
          className="w-20 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          min={0}
        />
        <span className="ml-1 text-xs text-gray-500">giây</span>
      </td>
      <td className="px-4 py-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.allowCreateReminder}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                allowCreateReminder: e.target.checked,
              }))
            }
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Nhắc nhở
        </label>
      </td>
      <td className="px-4 py-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.allowMedia}
            onChange={(e) =>
              setForm((f) => ({ ...f, allowMedia: e.target.checked }))
            }
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Media
        </label>
      </td>
      <td className="px-4 py-3 space-x-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-green-600 px-3 py-1.5 text-xs font-semibold text-white
                     hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Đang lưu..." : "💾 Lưu"}
        </button>
        <button
          onClick={onCancel}
          className="rounded bg-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700
                     hover:bg-gray-400 transition-colors"
        >
          Hủy
        </button>
      </td>
    </tr>
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
      const res = await fetch(`${API_BASE}/api/threads/settings`, {
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Handle both array response and { threads: [...] } wrapper
      const list = Array.isArray(data) ? data : data.threads ?? [];
      setThreads(list);
    } catch (err: any) {
      setError("Không thể tải cài đặt: " + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSaved = (updated: ThreadSettings) => {
    setThreads((prev) =>
      prev.map((t) => (t.threadId === updated.threadId ? updated : t))
    );
    setEditingId(null);
  };

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">
          ⚙️ Cài đặt Thread
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Quản lý cài đặt tự động trả lời và các tuỳ chọn cho từng thread
        </p>
      </div>

      {/* Messages */}
      {loading && (
        <div className="mb-4 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
          Đang tải dữ liệu...
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Refresh button */}
      <div className="mb-4">
        <button
          onClick={fetchSettings}
          className="rounded bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700
                     hover:bg-slate-300 transition-colors"
        >
          🔄 Tải lại
        </button>
      </div>

      {/* Table */}
      {!loading && !error && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  Thread ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  Loại
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  Tự động trả lời
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  Yêu cầu Mention
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  Thời gian trả lời
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  Tạo nhắc nhở
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  Cho phép Media
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {threads.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-sm text-gray-400"
                  >
                    Không có dữ liệu thread nào
                  </td>
                </tr>
              ) : (
                threads.map((t) =>
                  editingId === t.threadId ? (
                    <EditRow
                      key={t.threadId}
                      settings={t}
                      onSave={handleSaved}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <tr
                      key={t.threadId}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-sm text-gray-700">
                        {t.threadId}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {t.type === "group" ? "👥 Nhóm" : "👤 Cá nhân"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {toggle(t.autoReplyEnabled)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {toggle(t.groupMentionRequired)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {t.groupReplyWindowSeconds}s
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {toggle(t.allowCreateReminder)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {toggle(t.allowMedia)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setEditingId(t.threadId)}
                          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white
                                     hover:bg-blue-700 transition-colors"
                        >
                          ✏️ Sửa
                        </button>
                      </td>
                    </tr>
                  )
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
