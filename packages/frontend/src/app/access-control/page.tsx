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

const ROLE_DARK: Record<string, string> = {
  form_only: "bg-slate-700/60 text-slate-300 border-slate-600",
  basic_chat: "bg-blue-900/40 text-blue-300 border-blue-700/60",
  advanced: "bg-purple-900/40 text-purple-300 border-purple-700/60",
  admin: "bg-red-900/40 text-red-300 border-red-700/60",
};

const STATUS_DARK: Record<string, string> = {
  active: "bg-green-900/40 text-green-300 border-green-700/60",
  blocked: "bg-red-900/40 text-red-300 border-red-700/60",
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
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${
        ROLE_DARK[role] ?? "bg-slate-700 text-slate-300 border-slate-600"
      }`}
    >
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${
        STATUS_DARK[status] ?? "bg-slate-700 text-slate-300 border-slate-600"
      }`}
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
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono bg-slate-700/60 text-slate-400 border border-slate-600">
      {labels[type] ?? type}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Input helper
// ═══════════════════════════════════════════════════════════════════

function DarkInput({
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 ${props.className ?? ""}`}
    />
  );
}

function DarkSelect({
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 ${props.className ?? ""}`}
    >
      {children}
    </select>
  );
}

function DarkTextarea({
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 ${props.className ?? ""}`}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════════

export default function AccessControlPage() {
  const { toast } = useToast();

  // State: principals list
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

  async function handleRoleChange(p: ZaloPrincipal, role: string) {
    if (role === p.role) return;
    if (role === "advanced" && p.role !== "admin") {
      if (
        !window.confirm(
          `⚠️ Nâng "${p.principalId}" lên Advanced?\nHọ sẽ được dùng Hermes chat + document + OCR.`,
        )
      )
        return;
    }
    if (role === "admin") {
      if (
        !window.confirm(
          `🚨 Nâng "${p.principalId}" lên ADMIN?\nTOÀN QUYỀN: manage rules, settings, live test, document ingest.`,
        )
      )
        return;
    }
    try {
      await updatePrincipalRole(p.id, {
        role,
        actor: "admin",
        reason: `UI role change: ${p.role} → ${role}`,
      });
      toast(`✅ ${p.principalId}: ${p.role} → ${role}`, "success");
      fetchPrincipals();
    } catch (err: unknown) {
      toast(`❌ ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // Status toggle
  // ═════════════════════════════════════════════════════════════════

  async function handleStatusToggle(p: ZaloPrincipal) {
    const ns = p.status === "active" ? "blocked" : "active";
    if (ns === "blocked") {
      if (
        !window.confirm(
          `🔒 Chặn "${p.principalId}"?\nTất cả tin nhắn từ người này sẽ bị silent skip.`,
        )
      )
        return;
    }
    try {
      await updatePrincipalStatus(p.id, {
        status: ns,
        actor: "admin",
        reason: `UI status change: ${p.status} → ${ns}`,
      });
      toast(`✅ ${p.principalId}: ${p.status} → ${ns}`, "success");
      fetchPrincipals();
    } catch (err: unknown) {
      toast(`❌ ${err instanceof Error ? err.message : String(err)}`, "error");
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
      toast(`❌ ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setSaving(false);
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // Audit
  // ═════════════════════════════════════════════════════════════════

  async function toggleAudit() {
    const next = !showAudit;
    setShowAudit(next);
    if (next) {
      try {
        setAuditLoading(true);
        const result = await listAudit({ limit: "30" });
        setAuditEntries(result.items);
        setAuditTotal(result.total);
      } catch (err: unknown) {
        toast(`❌ ${err instanceof Error ? err.message : String(err)}`, "error");
      } finally {
        setAuditLoading(false);
      }
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
          <h1 className="text-2xl font-bold text-slate-100">🔑 Access Control</h1>
          <p className="text-sm text-slate-400 mt-1">
            Phân quyền theo <strong>người gửi</strong> (principal / role). Khác với <em>Allow Threads</em> —
            là nơi chọn <strong>thread</strong> nào bot được hoạt động.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={toggleAudit}
            className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600 transition-colors"
          >
            📋 {showAudit ? "Ẩn audit" : "Audit Log"}
          </button>
          <button
            onClick={fetchPrincipals}
            className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600 transition-colors"
          >
            🔄 Làm mới
          </button>
        </div>
      </div>

      {/* Filters + Create button */}
      <div className="flex flex-wrap gap-3 items-center">
        <DarkInput
          type="text"
          placeholder="🔍 Search (ID, name, notes)..."
          value={filterQ}
          onChange={(e) => setFilterQ(e.target.value)}
          className="w-56"
        />
        <DarkSelect
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="w-36"
        >
          <option value="">All Roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </DarkSelect>
        <DarkSelect
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="w-32"
        >
          <option value="">All Status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "active" ? "✅ Active" : "🚫 Blocked"}
            </option>
          ))}
        </DarkSelect>
        <DarkSelect
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="w-32"
        >
          <option value="">All Types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t === "user" ? "👤 User" : t === "group" ? "👥 Group" : "🧵 Thread"}
            </option>
          ))}
        </DarkSelect>

        <button
          onClick={() => setShowCreate(!showCreate)}
          className="ml-auto px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-500 rounded-lg transition-colors font-medium"
        >
          {showCreate ? "✕ Đóng" : "+ Tạo Principal"}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-slate-700 bg-slate-800/60 p-5 space-y-4"
        >
          <h2 className="text-base font-semibold text-slate-200">Tạo Principal Mới</h2>
          {createError && (
            <div className="rounded-lg border border-red-700/60 bg-red-900/20 p-3 text-red-300 text-sm">
              ❌ {createError}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Principal ID *
              </label>
              <DarkInput
                type="text"
                placeholder="Zalo sender ID"
                value={newPrincipalId}
                onChange={(e) => setNewPrincipalId(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Type *</label>
              <DarkSelect value={newType} onChange={(e) => setNewType(e.target.value)}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </DarkSelect>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Role *</label>
              <DarkSelect value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </DarkSelect>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Status</label>
              <DarkSelect value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </DarkSelect>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Thread ID (scope)
              </label>
              <DarkInput
                type="text"
                placeholder="Optional — empty = global"
                value={newThreadId}
                onChange={(e) => setNewThreadId(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Display Name
              </label>
              <DarkInput
                type="text"
                placeholder="Tên hiển thị"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Notes</label>
            <DarkTextarea
              placeholder="Admin notes (optional)"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              rows={2}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 text-sm bg-green-600 text-white hover:bg-green-500 rounded-lg transition-colors font-medium disabled:opacity-50"
            >
              {creating ? "Đang tạo..." : "✅ Tạo Principal"}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 rounded-lg transition-colors"
            >
              Hủy
            </button>
          </div>
        </form>
      )}

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-red-700/60 bg-red-900/20 p-4 text-red-300 text-sm">
          ❌ {error}
        </div>
      )}

      {/* Principals table */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
        {/* Table header row */}
        <div className="px-4 py-3 border-b border-slate-700 flex justify-between items-center">
          <span className="text-xs text-slate-500 font-medium">
            {loading
              ? "Đang tải..."
              : `${total} principal${total !== 1 ? "s" : ""}`}
          </span>
          {loading && (
            <div className="w-4 h-4 border border-blue-500 border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        {/* Desktop table — hidden on mobile */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-700">
              <tr>
                {[
                  "Name",
                  "Type",
                  "Principal ID",
                  "Thread ID",
                  "Role",
                  "Status",
                  "Updated",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-2.5 font-medium text-slate-500 uppercase tracking-wide text-[11px]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {principals.length === 0 && !loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500 text-sm">
                    Chưa có principal nào. Nhấn &ldquo;+ Tạo Principal&rdquo; để thêm.
                  </td>
                </tr>
              ) : (
                principals.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors"
                  >
                    {/* Name */}
                    <td className="px-4 py-3 max-w-[160px] truncate" title={p.displayName ?? ""}>
                      {p.displayName ? (
                        <span className="font-medium text-slate-200">{p.displayName}</span>
                      ) : (
                        <span className="text-slate-600 italic text-xs">—</span>
                      )}
                    </td>
                    {/* Type */}
                    <td className="px-4 py-3">
                      <TypeBadge type={p.type} />
                    </td>
                    {/* Principal ID */}
                    <td className="px-4 py-3">
                      <code className="text-xs bg-slate-900 border border-slate-700 px-1.5 py-0.5 rounded text-slate-300">
                        {p.principalId}
                      </code>
                    </td>
                    {/* Thread ID */}
                    <td className="px-4 py-3">
                      {p.threadId ? (
                        <code className="text-xs bg-slate-900 border border-slate-700 px-1.5 py-0.5 rounded text-slate-400">
                          {p.threadId}
                        </code>
                      ) : (
                        <span className="text-slate-600 text-xs italic">Global</span>
                      )}
                    </td>
                    {/* Role */}
                    <td className="px-4 py-3">
                      {editingId === p.id ? (
                        <RoleBadge role={p.role} />
                      ) : (
                        <select
                          value={p.role}
                          onChange={(e) => handleRoleChange(p, e.target.value)}
                          className="text-xs bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3">
                      {editingId === p.id ? (
                        <StatusBadge status={p.status} />
                      ) : (
                        <button
                          onClick={() => handleStatusToggle(p)}
                          title={`Click to ${p.status === "active" ? "block" : "unblock"}`}
                          className="hover:opacity-80 transition-opacity"
                        >
                          <StatusBadge status={p.status} />
                        </button>
                      )}
                    </td>
                    {/* Updated */}
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {formatVnTime(p.updatedAt)}
                    </td>
                    {/* Actions */}
                    <td className="px-4 py-3">
                      {editingId === p.id ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleSaveEdit(p)}
                            disabled={saving}
                            className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 transition-colors"
                          >
                            {saving ? "..." : "💾 Save"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-2.5 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 rounded transition-colors"
                          >
                            Hủy
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(p)}
                          className="px-2.5 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 rounded transition-colors"
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

        {/* Mobile cards — shown only on small screens */}
        <div className="md:hidden divide-y divide-slate-700/50">
          {principals.length === 0 && !loading ? (
            <div className="px-4 py-10 text-center text-slate-500 text-sm">
              Chưa có principal nào.
            </div>
          ) : (
            principals.map((p) => (
              <div key={p.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-200 text-sm truncate">
                      {p.displayName || (
                        <span className="text-slate-500 italic">No name</span>
                      )}
                    </p>
                    <code className="text-xs text-slate-400 break-all">{p.principalId}</code>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <TypeBadge type={p.type} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <RoleBadge role={p.role} />
                  <button onClick={() => handleStatusToggle(p)} className="hover:opacity-80">
                    <StatusBadge status={p.status} />
                  </button>
                </div>
                {p.threadId && (
                  <p className="text-xs text-slate-500">
                    Thread: <code className="text-slate-400">{p.threadId}</code>
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => startEdit(p)}
                    className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 rounded-lg transition-colors"
                  >
                    ✏️ Edit
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Inline edit panel */}
      {editingId && (
        <div className="rounded-xl border border-blue-700/60 bg-blue-900/20 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-blue-300">
            ✏️ Editing:{" "}
            <code className="font-mono">
              {principals.find((p) => p.id === editingId)?.principalId ?? editingId}
            </code>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Display Name
              </label>
              <DarkInput
                type="text"
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                placeholder="Tên hiển thị"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Notes</label>
              <DarkInput
                type="text"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Admin notes"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Thread ID (scope)
              </label>
              <DarkInput
                type="text"
                value={editThreadId}
                onChange={(e) => setEditThreadId(e.target.value)}
                placeholder="Empty = global"
              />
            </div>
          </div>
        </div>
      )}

      {/* Audit panel */}
      {showAudit && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-700 flex justify-between items-center">
            <span className="text-sm font-semibold text-slate-300">
              📋 Audit Log
              <span className="ml-2 text-slate-500 font-normal text-xs">
                — {auditTotal} entries (showing last {auditEntries.length})
              </span>
            </span>
            <button
              onClick={() => {
                setShowAudit(false);
                setAuditEntries([]);
              }}
              className="text-slate-500 hover:text-slate-300 text-lg leading-none transition-colors"
            >
              ✕
            </button>
          </div>

          {auditLoading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-slate-500 text-sm">
              <div className="w-4 h-4 border border-blue-500 border-t-transparent rounded-full animate-spin" />
              Đang tải audit log...
            </div>
          ) : auditEntries.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-sm">
              Chưa có audit entry nào.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-700">
                  <tr>
                    {["Time", "Principal", "Action", "Old → New", "Actor", "Reason"].map(
                      (h) => (
                        <th
                          key={h}
                          className="text-left px-4 py-2 font-medium text-slate-500 uppercase tracking-wide text-[11px]"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((a) => (
                    <tr
                      key={a.id}
                      className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                        {formatVnTime(a.createdAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <code className="bg-slate-900 border border-slate-700 px-1.5 py-0.5 rounded text-slate-300">
                          {a.principalId}
                        </code>
                        {a.threadId && (
                          <span className="text-slate-500 ml-1 text-[11px]">
                            in {a.threadId}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-300">
                        {AUDIT_ACTION_LABELS[a.action] ?? a.action}
                      </td>
                      <td className="px-4 py-2.5">
                        {a.oldValue && (
                          <span className="text-slate-600 line-through mr-1">{a.oldValue}</span>
                        )}
                        {a.oldValue && a.newValue && (
                          <span className="text-slate-600 mr-1">→</span>
                        )}
                        {a.newValue && (
                          <span className="text-slate-200 font-medium">{a.newValue}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{a.actor ?? "—"}</td>
                      <td
                        className="px-4 py-2.5 text-slate-400 max-w-[180px] truncate"
                        title={a.reason ?? ""}
                      >
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
      <div className="rounded-lg border border-slate-700/60 bg-slate-800/40 px-4 py-3 text-xs text-slate-500 space-y-1">
        <p>🔐 Quyền được xác định bằng <strong className="text-slate-400">Principal ID</strong> — không phải Display Name.</p>
        <p>📋 Display Name chỉ là nhãn hiển thị — không dùng để phân quyền.</p>
        <p>🛡️ Các action nguy hiểm (nâng lên advanced/admin, chặn) đều có confirm dialog.</p>
      </div>
    </div>
  );
}
