"use client";

import { useState, useEffect, useCallback } from "react";
import {
  listPrincipals,
  createPrincipal,
  updatePrincipalRole,
  updatePrincipalStatus,
  updatePrincipal,
  listAudit,
  type ZaloPrincipal,
  type PrincipalAuditEntry,
} from "../../lib/api-client";
import { useToast } from "../../components/toast";
import { formatVnTime } from "../../components/ui/TimeText";

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

const ROLES = ["form_only", "basic_chat", "advanced", "admin"] as const;
const STATUSES = ["active", "blocked"] as const;
const TYPES = ["user", "group", "thread"] as const;

const ROLE_LABELS: Record<string, string> = {
  form_only: "📋 Form Only",
  basic_chat: "💬 Basic Chat",
  advanced: "⭐ Advanced",
  admin: "👑 Admin",
};

const ROLE_COLORS: Record<string, string> = {
  form_only: "bg-slate-100 text-slate-700 border-slate-300",
  basic_chat: "bg-blue-100 text-blue-700 border-blue-300",
  advanced: "bg-purple-100 text-purple-700 border-purple-300",
  admin: "bg-red-100 text-red-700 border-red-300",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700 border-green-300",
  blocked: "bg-red-100 text-red-700 border-red-300",
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  created: "✨ Created",
  role_changed: "🔄 Role",
  status_changed: "🔒 Status",
  updated: "✏️ Updated",
  deleted: "🗑️ Deleted",
};

// ═══════════════════════════════════════════════════════════════════
// Badges
// ═══════════════════════════════════════════════════════════════════

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${ROLE_COLORS[role] ?? "bg-slate-100 text-slate-600 border-slate-300"}`}
    >
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600 border-slate-300"}`}
    >
      {status === "active" ? "✅ Active" : "🚫 Blocked"}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    user: "👤 User",
    group: "👥 Group",
    thread: "🧵 Thread",
  };
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono bg-slate-100 text-slate-600 border border-slate-200">
      {labels[type] ?? type}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════════

export default function AccessControlPage() {
  const { toast } = useToast();

  // Principals list
  const [principals, setPrincipals] = useState<ZaloPrincipal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterQ, setFilterQ] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newPrincipalId, setNewPrincipalId] = useState("");
  const [newType, setNewType] = useState("user");
  const [newRole, setNewRole] = useState("form_only");
  const [newStatus, setNewStatus] = useState("active");
  const [newThreadId, setNewThreadId] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editThreadId, setEditThreadId] = useState("");
  const [saving, setSaving] = useState(false);

  // Audit panel
  const [showAudit, setShowAudit] = useState(false);
  const [auditEntries, setAuditEntries] = useState<PrincipalAuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);

  // ═════════════════════════════════════════════════════════════════
  // Fetch principals
  // ═════════════════════════════════════════════════════════════════

  const fetchPrincipals = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params: Record<string, string> = {};
      if (filterQ.trim()) params.q = filterQ.trim();
      if (filterRole) params.role = filterRole;
      if (filterStatus) params.status = filterStatus;
      if (filterType) params.type = filterType;

      const result = await listPrincipals(params);
      setPrincipals(result.items);
      setTotal(result.total);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast("Không tải được danh sách principals", "error");
    } finally {
      setLoading(false);
    }
  }, [filterQ, filterRole, filterStatus, filterType, toast]);

  useEffect(() => {
    fetchPrincipals();
  }, [fetchPrincipals]);

  // ═════════════════════════════════════════════════════════════════
  // Create
  // ═════════════════════════════════════════════════════════════════

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newPrincipalId.trim()) {
      setCreateError("Principal ID is required");
      return;
    }
    try {
      setCreating(true);
      setCreateError(null);
      await createPrincipal({
        principalId: newPrincipalId.trim(),
        type: newType,
        role: newRole,
        status: newStatus,
        threadId: newThreadId.trim() || null,
        displayName: newDisplayName.trim() || null,
        notes: newNotes.trim() || null,
      });
      toast(`✅ Đã tạo principal "${newPrincipalId.trim()}"`, "success");
      // Reset form
      setNewPrincipalId("");
      setNewType("user");
      setNewRole("form_only");
      setNewStatus("active");
      setNewThreadId("");
      setNewDisplayName("");
      setNewNotes("");
      setShowCreate(false);
      fetchPrincipals();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCreateError(msg);
      toast(`❌ ${msg}`, "error");
    } finally {
      setCreating(false);
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // Role change
  // ═════════════════════════════════════════════════════════════════

  async function handleRoleChange(p: ZaloPrincipal, newRole: string) {
    if (newRole === p.role) return;

    // Confirm for dangerous promotions
    if (newRole === "advanced" && p.role !== "admin") {
      if (!window.confirm(`⚠️ Nâng "${p.principalId}" lên Advanced?\nHọ sẽ được dùng Hermes chat + document + OCR.`)) return;
    }
    if (newRole === "admin") {
      if (!window.confirm(`🚨 Nâng "${p.principalId}" lên ADMIN?\nTOÀN QUYỀN: manage rules, settings, live test, document ingest.`)) return;
    }

    try {
      await updatePrincipalRole(p.id, {
        role: newRole,
        actor: "admin",
        reason: `UI role change: ${p.role} → ${newRole}`,
      });
      toast(`✅ ${p.principalId}: ${p.role} → ${newRole}`, "success");
      fetchPrincipals();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`❌ ${msg}`, "error");
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // Status toggle
  // ═════════════════════════════════════════════════════════════════

  async function handleStatusToggle(p: ZaloPrincipal) {
    const newStatus = p.status === "active" ? "blocked" : "active";

    if (newStatus === "blocked") {
      if (!window.confirm(`🔒 Chặn "${p.principalId}"?\nTất cả tin nhắn từ người này sẽ bị silent skip.`)) return;
    }

    try {
      await updatePrincipalStatus(p.id, {
        status: newStatus,
        actor: "admin",
        reason: `UI status change: ${p.status} → ${newStatus}`,
      });
      toast(`✅ ${p.principalId}: ${p.status} → ${newStatus}`, "success");
      fetchPrincipals();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`❌ ${msg}`, "error");
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // Inline edit
  // ═════════════════════════════════════════════════════════════════

  function startEdit(p: ZaloPrincipal) {
    setEditingId(p.id);
    setEditDisplayName(p.displayName ?? "");
    setEditNotes(p.notes ?? "");
    setEditThreadId(p.threadId ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDisplayName("");
    setEditNotes("");
    setEditThreadId("");
  }

  async function handleSaveEdit(p: ZaloPrincipal) {
    try {
      setSaving(true);
      await updatePrincipal(p.id, {
        displayName: editDisplayName.trim() || null,
        notes: editNotes.trim() || null,
        threadId: editThreadId.trim() || null,
        actor: "admin",
        reason: "UI edit",
      });
      toast(`✅ Đã cập nhật "${p.principalId}"`, "success");
      cancelEdit();
      fetchPrincipals();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`❌ ${msg}`, "error");
    } finally {
      setSaving(false);
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // Audit
  // ═════════════════════════════════════════════════════════════════

  async function fetchAudit() {
    try {
      setShowAudit(!showAudit);
      if (!showAudit) {
        setAuditLoading(true);
        const result = await listAudit({ limit: "30" });
        setAuditEntries(result.items);
        setAuditTotal(result.total);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`❌ ${msg}`, "error");
    } finally {
      setAuditLoading(false);
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // Render
  // ═════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">🔑 Access Control</h1>
          <p className="text-sm text-slate-500 mt-1">
            Quản lý quyền truy cập Zalo — không cần SQLite thủ công.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchAudit}
            className="px-4 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            📋 {showAudit ? "Ẩn audit" : "Xem audit"}
          </button>
          <button
            onClick={fetchPrincipals}
            className="px-4 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            🔄 Làm mới
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="🔍 Search (ID, name, notes)..."
          value={filterQ}
          onChange={(e) => setFilterQ(e.target.value)}
          className="px-3 py-2 text-sm border rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          <option value="">All Roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          <option value="">All Status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s === "active" ? "✅ Active" : "🚫 Blocked"}</option>
          ))}
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          <option value="">All Types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>{t === "user" ? "👤 User" : t === "group" ? "👥 Group" : "🧵 Thread"}</option>
          ))}
        </select>

        <button
          onClick={() => setShowCreate(!showCreate)}
          className="ml-auto px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors font-medium"
        >
          {showCreate ? "✕ Đóng" : "+ Tạo Principal"}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="rounded-xl border bg-white shadow-sm p-5 space-y-4">
          <h2 className="text-lg font-semibold">Tạo Principal Mới</h2>
          {createError && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-700 text-sm">{createError}</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Principal ID *</label>
              <input
                type="text"
                placeholder="Zalo sender ID"
                value={newPrincipalId}
                onChange={(e) => setNewPrincipalId(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Type *</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Role *</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Thread ID (scope)</label>
              <input
                type="text"
                placeholder="Optional — empty = global"
                value={newThreadId}
                onChange={(e) => setNewThreadId(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Display Name</label>
              <input
                type="text"
                placeholder="For UI label only"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea
              placeholder="Admin notes (optional)"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              rows={2}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 text-sm bg-green-600 text-white hover:bg-green-700 rounded-lg transition-colors font-medium disabled:opacity-50"
            >
              {creating ? "Đang tạo..." : "✅ Tạo Principal"}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Hủy
            </button>
          </div>
        </form>
      )}

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800 text-sm">
          ❌ {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-slate-50 text-sm text-slate-500">
          {loading ? "Đang tải..." : `${total} principal${total !== 1 ? "s" : ""}`}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left p-3 font-medium text-slate-600">Name</th>
                <th className="text-left p-3 font-medium text-slate-600">Type</th>
                <th className="text-left p-3 font-medium text-slate-600">Principal ID</th>
                <th className="text-left p-3 font-medium text-slate-600">Thread ID</th>
                <th className="text-left p-3 font-medium text-slate-600">Role</th>
                <th className="text-left p-3 font-medium text-slate-600">Status</th>
                <th className="text-left p-3 font-medium text-slate-600">Updated</th>
                <th className="text-left p-3 font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {principals.length === 0 && !loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    Chưa có principal nào. Nhấn "+ Tạo Principal" để thêm.
                  </td>
                </tr>
              ) : (
                principals.map((p) => (
                  <tr key={p.id} className="border-b hover:bg-slate-50">
                    {/* Name */}
                    <td className="p-3 max-w-[180px] truncate" title={p.displayName ?? ""}>
                      {p.displayName ? (
                        <span className="font-medium">{p.displayName}</span>
                      ) : (
                        <span className="text-slate-400 italic">—</span>
                      )}
                    </td>
                    {/* Type */}
                    <td className="p-3">
                      <TypeBadge type={p.type} />
                    </td>
                    {/* Principal ID */}
                    <td className="p-3">
                      <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">{p.principalId}</code>
                    </td>
                    {/* Thread ID */}
                    <td className="p-3">
                      {p.threadId ? (
                        <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{p.threadId}</code>
                      ) : (
                        <span className="text-slate-400 text-xs italic">Global</span>
                      )}
                    </td>
                    {/* Role */}
                    <td className="p-3">
                      {editingId === p.id ? (
                        <RoleBadge role={p.role} />
                      ) : (
                        <select
                          value={p.role}
                          onChange={(e) => handleRoleChange(p, e.target.value)}
                          className="text-xs border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    {/* Status */}
                    <td className="p-3">
                      {editingId === p.id ? (
                        <StatusBadge status={p.status} />
                      ) : (
                        <button
                          onClick={() => handleStatusToggle(p)}
                          className="text-xs border rounded px-2 py-1 hover:bg-slate-100 transition-colors"
                          title={`Click to ${p.status === "active" ? "block" : "unblock"}`}
                        >
                          <StatusBadge status={p.status} />
                        </button>
                      )}
                    </td>
                    {/* Updated */}
                    <td className="p-3 text-xs text-slate-500">
                      {formatVnTime(p.updatedAt)}
                    </td>
                    {/* Actions */}
                    <td className="p-3">
                      {editingId === p.id ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleSaveEdit(p)}
                            disabled={saving}
                            className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            {saving ? "..." : "Save"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(p)}
                          className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                          title="Edit display name, notes, thread scope"
                        >
                          ✏️ Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inline edit form (shown when editing) */}
      {editingId && (
        <div className="rounded-xl border bg-amber-50 shadow-sm p-5 space-y-3">
          <h3 className="text-sm font-semibold text-amber-800">
            ✏️ Editing: {principals.find((p) => p.id === editingId)?.principalId ?? editingId}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Display Name</label>
              <input
                type="text"
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="Label only — not for permission"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
              <input
                type="text"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="Admin notes"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Thread ID (scope)</label>
              <input
                type="text"
                value={editThreadId}
                onChange={(e) => setEditThreadId(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="Empty = global"
              />
            </div>
          </div>
        </div>
      )}

      {/* Audit panel */}
      {showAudit && (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-slate-50 text-sm text-slate-500 flex justify-between items-center">
            <span>
              📋 Audit Log — {auditTotal} entries (showing last {auditEntries.length})
            </span>
            <button
              onClick={() => { setShowAudit(false); setAuditEntries([]); }}
              className="text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
          {auditLoading ? (
            <div className="p-8 text-center text-slate-400">Đang tải audit log...</div>
          ) : auditEntries.length === 0 ? (
            <div className="p-8 text-center text-slate-400">Chưa có audit entry nào.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left p-3 font-medium text-slate-600">Time</th>
                    <th className="text-left p-3 font-medium text-slate-600">Principal</th>
                    <th className="text-left p-3 font-medium text-slate-600">Action</th>
                    <th className="text-left p-3 font-medium text-slate-600">Old → New</th>
                    <th className="text-left p-3 font-medium text-slate-600">Actor</th>
                    <th className="text-left p-3 font-medium text-slate-600">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((a) => (
                    <tr key={a.id} className="border-b hover:bg-slate-50">
                      <td className="p-3 text-xs text-slate-500 whitespace-nowrap">
                        {formatVnTime(a.createdAt)}
                      </td>
                      <td className="p-3">
                        <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{a.principalId}</code>
                        {a.threadId && (
                          <span className="text-xs text-slate-400 ml-1">in {a.threadId}</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="text-xs">{AUDIT_ACTION_LABELS[a.action] ?? a.action}</span>
                      </td>
                      <td className="p-3 text-xs">
                        {a.oldValue && <span className="text-slate-400 line-through mr-1">{a.oldValue}</span>}
                        {a.oldValue && a.newValue && <span className="text-slate-400 mr-1">→</span>}
                        {a.newValue && <span className="text-slate-700 font-medium">{a.newValue}</span>}
                      </td>
                      <td className="p-3 text-xs text-slate-500">{a.actor ?? "—"}</td>
                      <td className="p-3 text-xs text-slate-500 max-w-[200px] truncate" title={a.reason ?? ""}>
                        {a.reason ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Safety footer */}
      <div className="text-xs text-slate-400 space-y-1">
        <p>🔐 Quyền được xác định bằng <strong>Principal ID</strong> (không phải Display Name).</p>
        <p>📋 Display Name chỉ là nhãn hiển thị — không dùng để phân quyền.</p>
        <p>🛡️ Các action nguy hiểm (nâng lên advanced/admin, chặn) đều có confirm.</p>
      </div>
    </div>
  );
}
