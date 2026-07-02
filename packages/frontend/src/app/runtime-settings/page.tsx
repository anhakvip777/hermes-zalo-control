"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useToast } from "../../components/toast";

// ── Types ──────────────────────────────────────────────────────────────

interface SettingMeta {
  key: string;
  label: string;
  category: string;
  type: "boolean" | "number" | "string" | "string[]";
}

interface SettingEntry {
  key: string;
  value: string;
  label: string;
  category: string;
  updatedBy: string;
  updatedAt: string;
}

interface SettingsResponse {
  settings: SettingEntry[];
  meta: SettingMeta[];
}

interface AuditEntry {
  id: string;
  key: string;
  oldValue?: string;
  newValue: string;
  changedBy: string;
  reason?: string;
  createdAt: string;
}

// ── Category labels ────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<
  string,
  { title: string; icon: string; accent: string }
> = {
  autoReply: {
    title: "Auto Reply",
    icon: "💬",
    accent: "border-l-blue-500",
  },
  messageBatching: {
    title: "Message Batching",
    icon: "📦",
    accent: "border-l-green-500",
  },
  document: {
    title: "Document Understanding",
    icon: "📄",
    accent: "border-l-purple-500",
  },
  vision: {
    title: "Vision / OCR",
    icon: "👁️",
    accent: "border-l-orange-500",
  },
  ruleEngine: {
    title: "Rule Engine",
    icon: "⚙️",
    accent: "border-l-slate-500",
  },
};

// ── Danger zone keys ───────────────────────────────────────────────────

const DANGER_KEYS = new Set(["autoReply.dryRun", "autoReply.enabled", "autoReply.liveTest"]);

// ── Component ──────────────────────────────────────────────────────────

export default function RuntimeSettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const { toast } = useToast();

  const fetchData = () => {
    setLoading(true);
    apiFetch<SettingsResponse>("/api/system/runtime-settings")
      .then(setSettings)
      .catch(() => toast("Không tải được runtime settings", "error"))
      .finally(() => setLoading(false));
  };

  const fetchAudit = () => {
    apiFetch<AuditEntry[]>("/api/system/runtime-settings/audit?limit=30")
      .then(setAudit)
      .catch(() => {});
  };

  useEffect(() => {
    fetchData();
    fetchAudit();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Group settings by category
  const grouped: Record<string, SettingEntry[]> = {};
  if (settings?.settings) {
    for (const s of settings.settings) {
      if (!grouped[s.category]) grouped[s.category] = [];
      grouped[s.category]!.push(s);
    }
  }

  const startEdit = (entry: SettingEntry) => {
    setEditingKey(entry.key);
    setEditValue(entry.value);
    setReason("");
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue("");
    setReason("");
  };

  const saveSetting = async (key: string) => {
    if (!reason.trim()) {
      toast("Vui lòng nhập lý do thay đổi", "error");
      return;
    }
    if (DANGER_KEYS.has(key)) {
      const ok = window.confirm(
        `⚠️ DANGER ZONE\n\nThay đổi "${key}" ảnh hưởng trực tiếp đến live/dryRun.\nBạn chắc chắn không?`,
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      let value: unknown = editValue;
      const meta = settings?.meta.find((m) => m.key === key);
      if (meta?.type === "number") {
        value = parseFloat(editValue);
        if (isNaN(value as number)) {
          toast("Giá trị phải là số", "error");
          setSaving(false);
          return;
        }
      } else if (meta?.type === "boolean") {
        value = editValue.toLowerCase() === "true" || editValue === "1";
      }

      const res = await apiFetch<{
        success: boolean;
        error?: string;
        errorCode?: string;
        oldValue?: string;
        newValue?: string;
      }>("/api/system/runtime-settings", {
        method: "PATCH",
        body: JSON.stringify({ key, value, reason }),
      });

      if (res.success) {
        toast(`✅ ${key} đã được cập nhật`, "success");
        setEditingKey(null);
        setEditValue("");
        setReason("");
        fetchData();
        fetchAudit();
      } else {
        toast(`❌ ${res.error || "Lỗi không xác định"}`, "error");
      }
    } catch {
      toast("❌ Lỗi kết nối", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Loading / error states ─────────────────────────────────────────

  if (loading && !settings) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-sm">Đang tải runtime settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">⚙️ Runtime Settings</h1>
          <p className="text-sm text-slate-400 mt-1">
            Thay đổi có hiệu lực ngay — không cần restart. Auto-refresh 30s.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setShowAudit(!showAudit);
              if (!showAudit) fetchAudit();
            }}
            className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600 transition-colors"
          >
            {showAudit ? "✕ Ẩn audit" : "📋 Audit Log"}
          </button>
          <button
            onClick={fetchData}
            className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600 transition-colors"
          >
            🔄 Làm mới
          </button>
        </div>
      </div>

      {/* Danger zone banner */}
      <div className="rounded-xl border border-red-800/60 bg-red-900/20 px-5 py-4 flex items-start gap-3">
        <span className="text-2xl shrink-0">🚨</span>
        <div>
          <p className="text-sm font-semibold text-red-300">Danger Zone</p>
          <p className="text-xs text-red-400/80 mt-0.5">
            Các trường <code className="bg-red-900/40 px-1 rounded">dryRun</code>,{" "}
            <code className="bg-red-900/40 px-1 rounded">enabled</code>,{" "}
            <code className="bg-red-900/40 px-1 rounded">liveTest</code> ảnh hưởng trực tiếp tới
            việc gửi tin thật. Luôn giữ dryRun=true nếu chưa được authorize live.
          </p>
        </div>
      </div>

      {/* Settings cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.keys(grouped).length === 0 && !loading && (
          <div className="col-span-2 rounded-xl border border-slate-700 bg-slate-800/60 p-10 text-center text-slate-500">
            Không tải được settings — kiểm tra kết nối backend.
          </div>
        )}
        {Object.entries(grouped).map(([category, entries]) => {
          const cat = CATEGORY_LABELS[category] || {
            title: category,
            icon: "📌",
            accent: "border-l-slate-500",
          };
          return (
            <div
              key={category}
              className={`rounded-lg border border-slate-700 bg-slate-800/60 p-5 border-l-2 ${cat.accent}`}
            >
              <h2 className="font-bold text-slate-200 mb-4">
                {cat.icon} {cat.title}
              </h2>
              <div className="space-y-4">
                {entries.map((entry) => {
                  const isEditing = editingKey === entry.key;
                  const meta = settings?.meta.find((m) => m.key === entry.key);
                  const isDanger = DANGER_KEYS.has(entry.key);

                  return (
                    <div
                      key={entry.key}
                      className={`border-t border-slate-700/60 pt-3 first:border-t-0 first:pt-0 ${
                        isDanger ? "rounded-lg border border-red-800/40 bg-red-900/10 p-3 mt-2" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <label className="text-sm font-medium text-slate-300 flex items-center gap-1.5">
                            {isDanger && (
                              <span className="text-[10px] font-bold bg-red-800/60 text-red-300 px-1.5 py-0.5 rounded border border-red-700/60 uppercase tracking-wide">
                                DANGER
                              </span>
                            )}
                            {entry.label}
                          </label>
                          <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                            {entry.key}
                          </p>
                        </div>
                        {!isEditing && (
                          <button
                            onClick={() => startEdit(entry)}
                            className="shrink-0 text-xs px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 transition-colors"
                          >
                            ✏️ Sửa
                          </button>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="mt-3 space-y-2">
                          {meta?.type === "boolean" ? (
                            <select
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="true">true — Bật</option>
                              <option value="false">false — Tắt</option>
                            </select>
                          ) : meta?.type === "string[]" ? (
                            <input
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder='e.g. ["user"]'
                            />
                          ) : (
                            <input
                              type={meta?.type === "number" ? "number" : "text"}
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          )}
                          <input
                            type="text"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Lý do thay đổi (bắt buộc)"
                            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveSetting(entry.key)}
                              disabled={saving || !reason.trim()}
                              className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 transition-colors font-medium"
                            >
                              {saving ? "Đang lưu..." : "💾 Lưu"}
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 transition-colors"
                            >
                              Hủy
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2">
                          <code className="bg-slate-900 border border-slate-700 px-2 py-1 rounded text-xs font-mono text-slate-200 break-all">
                            {entry.value}
                          </code>
                          <p className="text-[11px] text-slate-600 mt-1">
                            {entry.updatedBy !== "default"
                              ? `bởi ${entry.updatedBy}`
                              : "mặc định (.env)"}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Audit log */}
      {showAudit && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-700 flex justify-between items-center">
            <h2 className="text-sm font-semibold text-slate-300">
              📋 Audit Log
              <span className="ml-2 text-slate-500 font-normal">
                — {audit.length} entries
              </span>
            </h2>
            <button
              onClick={() => setShowAudit(false)}
              className="text-slate-500 hover:text-slate-300 transition-colors text-lg leading-none"
            >
              ✕
            </button>
          </div>
          {audit.length === 0 ? (
            <div className="p-10 text-center text-slate-500">Chưa có thay đổi nào.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-700">
                  <tr>
                    {["Thời gian", "Key", "Cũ", "Mới", "Lý do", "Người đổi"].map((h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-2 font-medium text-slate-500 uppercase tracking-wide text-[11px]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr
                      key={a.id}
                      className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                        {new Date(a.createdAt).toLocaleString("vi-VN")}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-300">{a.key}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-500 max-w-[100px] truncate">
                        {a.oldValue ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-200 max-w-[100px] truncate">
                        {a.newValue}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400 max-w-[140px] truncate">
                        {a.reason || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{a.changedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
