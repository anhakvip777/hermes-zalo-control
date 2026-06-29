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

const CATEGORY_LABELS: Record<string, { title: string; icon: string; color: string }> = {
  autoReply: { title: "Auto Reply", icon: "💬", color: "border-blue-500 bg-blue-50" },
  messageBatching: { title: "Message Batching", icon: "📦", color: "border-green-500 bg-green-50" },
  document: { title: "Document Understanding", icon: "📄", color: "border-purple-500 bg-purple-50" },
  vision: { title: "Vision / OCR", icon: "👁️", color: "border-orange-500 bg-orange-50" },
  ruleEngine: { title: "Rule Engine", icon: "⚙️", color: "border-gray-500 bg-gray-50" },
};

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
    setSaving(true);
    try {
      let value: unknown = editValue;
      // Coerce types
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

      const res = await apiFetch<{ success: boolean; error?: string; errorCode?: string; oldValue?: string; newValue?: string }>(
        "/api/system/runtime-settings",
        {
          method: "PATCH",
          body: JSON.stringify({ key, value, reason }),
        },
      );

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

  const formatValue = (entry: SettingEntry): string => {
    if (entry.value.startsWith("[") && entry.value.endsWith("]")) {
      return entry.value; // Already JSON array string
    }
    return entry.value;
  };

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">⚙️ Runtime Settings</h1>
        <p className="text-gray-500">Đang tải...</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">⚙️ Runtime Settings</h1>
        <button
          onClick={() => { setShowAudit(!showAudit); if (!showAudit) fetchAudit(); }}
          className="text-sm px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          {showAudit ? "Ẩn Audit" : "📋 Xem Audit Log"}
        </button>
      </div>

      <p className="text-sm text-gray-500 mb-6">
        Chỉnh sửa các thông số vận hành. Thay đổi có hiệu lực ngay lập tức, không cần restart.
        Các giá trị <code className="bg-gray-100 px-1 rounded">gạch chân</code> là từ file .env (mặc định).
      </p>

      {/* Settings Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {Object.entries(grouped).map(([category, entries]) => {
          const cat = CATEGORY_LABELS[category] || { title: category, icon: "📌", color: "border-gray-300" };
          return (
            <div key={category} className={`border-2 rounded-lg p-4 ${cat.color} bg-white shadow-sm`}>
              <h2 className="font-bold text-lg mb-3">
                {cat.icon} {cat.title}
              </h2>
              <div className="space-y-3">
                {entries.map((entry) => {
                  const isEditing = editingKey === entry.key;
                  const meta = settings?.meta.find((m) => m.key === entry.key);
                  return (
                    <div key={entry.key} className="border-t pt-2 first:border-t-0 first:pt-0">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-700">
                          {entry.label}
                        </label>
                        {!isEditing && (
                          <button
                            onClick={() => startEdit(entry)}
                            className="text-xs px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors"
                          >
                            ✏️ Sửa
                          </button>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="mt-2 space-y-2">
                          {/* Value input based on type */}
                          {meta?.type === "boolean" ? (
                            <select
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-full border rounded px-2 py-1 text-sm"
                            >
                              <option value="true">true (Bật)</option>
                              <option value="false">false (Tắt)</option>
                            </select>
                          ) : meta?.type === "string[]" ? (
                            <input
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-full border rounded px-2 py-1 text-sm font-mono"
                              placeholder='e.g. ["user"]'
                            />
                          ) : (
                            <input
                              type={meta?.type === "number" ? "number" : "text"}
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-full border rounded px-2 py-1 text-sm font-mono"
                            />
                          )}
                          <input
                            type="text"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Lý do thay đổi (bắt buộc)"
                            className="w-full border rounded px-2 py-1 text-sm"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveSetting(entry.key)}
                              disabled={saving || !reason.trim()}
                              className="text-xs px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                            >
                              {saving ? "Đang lưu..." : "💾 Lưu"}
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 transition-colors"
                            >
                              Hủy
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm mt-1">
                          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono break-all">
                            {formatValue(entry)}
                          </code>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {entry.updatedBy !== "default" ? `bởi ${entry.updatedBy}` : "mặc định"}
                          </div>
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

      {/* Audit Log */}
      {showAudit && (
        <div className="border rounded-lg p-4 bg-white shadow-sm">
          <h2 className="font-bold text-lg mb-3">📋 Audit Log</h2>
          {audit.length === 0 ? (
            <p className="text-sm text-gray-400">Chưa có thay đổi nào.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="py-1 pr-3">Thời gian</th>
                    <th className="py-1 pr-3">Key</th>
                    <th className="py-1 pr-3">Cũ</th>
                    <th className="py-1 pr-3">Mới</th>
                    <th className="py-1 pr-3">Lý do</th>
                    <th className="py-1">Người đổi</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id} className="border-b last:border-b-0">
                      <td className="py-1 pr-3 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(a.createdAt).toLocaleString("vi-VN")}
                      </td>
                      <td className="py-1 pr-3 font-mono text-xs">{a.key}</td>
                      <td className="py-1 pr-3 font-mono text-xs text-gray-400 max-w-[120px] truncate">
                        {a.oldValue ?? "—"}
                      </td>
                      <td className="py-1 pr-3 font-mono text-xs max-w-[120px] truncate">{a.newValue}</td>
                      <td className="py-1 pr-3 text-xs max-w-[150px] truncate">{a.reason || "—"}</td>
                      <td className="py-1 text-xs">{a.changedBy}</td>
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
