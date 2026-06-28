"use client";

import { useState, useEffect, useCallback } from "react";
import {
  listRules,
  createRule,
  updateRule,
  enableRule,
  disableRule,
  getRule,
  getRuleVersions,
  getRuleExecutions,
  simulateRules,
  type RuleOutput,
  type RuleVersionOutput,
  type RuleExecutionOutput,
  type SimulatorOutput,
} from "../../lib/api-client";

// ── Constants ──────────────────────────────────────────────────────

const TRIGGER_TYPES = [
  { value: "keyword_contains", label: "Keyword Contains" },
  { value: "keyword_regex", label: "Keyword Regex" },
  { value: "message_type", label: "Message Type" },
  { value: "thread_type", label: "Thread Type" },
  { value: "sender_id", label: "Sender ID" },
] as const;

const ACTION_TYPES = [
  { value: "fixed_reply", label: "Fixed Reply" },
  { value: "route_to_hermes", label: "Route to Hermes" },
  { value: "ignore", label: "Ignore" },
] as const;

// ── Main Page ──────────────────────────────────────────────────────

export default function RulesPage() {
  const [rules, setRules] = useState<RuleOutput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formTrigger, setFormTrigger] = useState("keyword_contains");
  const [formAction, setFormAction] = useState("fixed_reply");
  const [formPriority, setFormPriority] = useState(100);
  const [formEnabled, setFormEnabled] = useState(true);
  const [formKeywords, setFormKeywords] = useState("");
  const [formReply, setFormReply] = useState("");
  const [formCaseSensitive, setFormCaseSensitive] = useState(false);
  const [formTargetThreads, setFormTargetThreads] = useState("");
  const [formCooldown, setFormCooldown] = useState("");
  const [formMessageType, setFormMessageType] = useState("text");
  const [formThreadType, setFormThreadType] = useState("user");
  const [formSenderId, setFormSenderId] = useState("");
  const [formChangeReason, setFormChangeReason] = useState("");
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Detail panel
  const [selectedRule, setSelectedRule] = useState<string | null>(null);
  const [versions, setVersions] = useState<RuleVersionOutput[]>([]);
  const [executions, setExecutions] = useState<RuleExecutionOutput[]>([]);

  // Simulator state
  const [simContent, setSimContent] = useState("");
  const [simThreadId, setSimThreadId] = useState("6792540503378312397");
  const [simThreadType, setSimThreadType] = useState("user");
  const [simMessageType, setSimMessageType] = useState("text");
  const [simSenderId, setSimSenderId] = useState("");
  const [simResult, setSimResult] = useState<SimulatorOutput | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  const fetchRules = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listRules();
      setRules(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // ── Open form for create/edit ────────────────────────────────
  const openCreate = () => {
    setEditId(null);
    setFormName("");
    setFormDesc("");
    setFormTrigger("keyword_contains");
    setFormAction("fixed_reply");
    setFormPriority(100);
    setFormEnabled(true);
    setFormKeywords("");
    setFormReply("");
    setFormCaseSensitive(false);
    setFormTargetThreads("");
    setFormCooldown("");
    setFormMessageType("text");
    setFormThreadType("user");
    setFormSenderId("");
    setFormChangeReason("");
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (rule: RuleOutput) => {
    setEditId(rule.id);
    setFormName(rule.name);
    setFormDesc(rule.description ?? "");
    setFormTrigger(rule.triggerType);
    setFormAction(rule.actionType);
    setFormPriority(rule.priority);
    setFormEnabled(rule.enabled);
    setFormKeywords(
      Array.isArray(rule.conditions.keywords)
        ? (rule.conditions.keywords as string[]).join(", ")
        : "",
    );
    setFormReply(
      typeof rule.actionConfig.reply === "string" ? rule.actionConfig.reply : "",
    );
    setFormCaseSensitive(rule.conditions.caseSensitive === true);
    setFormTargetThreads(
      rule.targetThreadIds ? rule.targetThreadIds.join(", ") : "",
    );
    setFormCooldown(rule.cooldownSeconds?.toString() ?? "");
    setFormMessageType(
      typeof rule.conditions.messageType === "string" ? rule.conditions.messageType : "text",
    );
    setFormThreadType(
      typeof rule.conditions.threadType === "string" ? rule.conditions.threadType : "user",
    );
    setFormSenderId(
      typeof rule.conditions.senderId === "string" ? rule.conditions.senderId : "",
    );
    setFormChangeReason("");
    setFormError(null);
    setShowForm(true);
  };

  // ── Build conditions JSON ────────────────────────────────────
  const buildConditions = (): Record<string, unknown> => {
    switch (formTrigger) {
      case "keyword_contains":
      case "keyword_regex":
        return {
          keywords: formKeywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
          caseSensitive: formCaseSensitive,
        };
      case "message_type":
        return { messageType: formMessageType };
      case "thread_type":
        return { threadType: formThreadType };
      case "sender_id":
        return { senderId: formSenderId };
      default:
        return {};
    }
  };

  const buildActionConfig = (): Record<string, unknown> => {
    switch (formAction) {
      case "fixed_reply":
        return { reply: formReply };
      default:
        return {};
    }
  };

  // ── Save ─────────────────────────────────────────────────────
  const handleSave = async () => {
    setFormSaving(true);
    setFormError(null);

    const body: Record<string, unknown> = {
      name: formName,
      description: formDesc || undefined,
      enabled: formEnabled,
      priority: formPriority,
      triggerType: formTrigger,
      conditions: buildConditions(),
      actionType: formAction,
      actionConfig: buildActionConfig(),
      targetThreadIds: formTargetThreads
        ? formTargetThreads.split(",").map((t) => t.trim()).filter(Boolean)
        : undefined,
      cooldownSeconds: formCooldown ? parseInt(formCooldown, 10) : undefined,
      changedBy: "admin",
      changeReason: formChangeReason || undefined,
    };

    try {
      if (editId) {
        await updateRule(editId, body);
      } else {
        await createRule(body);
      }
      setShowForm(false);
      fetchRules();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setFormSaving(false);
    }
  };

  // ── Toggle enable/disable ────────────────────────────────────
  const handleToggle = async (rule: RuleOutput) => {
    try {
      if (rule.enabled) {
        await disableRule(rule.id);
      } else {
        await enableRule(rule.id);
      }
      fetchRules();
    } catch {
      // ignore
    }
  };

  // ── View detail ──────────────────────────────────────────────
  const viewDetail = async (ruleId: string) => {
    setSelectedRule(ruleId === selectedRule ? null : ruleId);
    if (ruleId !== selectedRule) {
      try {
        const [v, e] = await Promise.all([
          getRuleVersions(ruleId),
          getRuleExecutions(ruleId, 20),
        ]);
        setVersions(v.data);
        setExecutions(e.data);
      } catch {
        setVersions([]);
        setExecutions([]);
      }
    }
  };

  // ── Simulator ────────────────────────────────────────────────
  const handleSimulate = async () => {
    if (!simContent.trim()) return;
    setSimLoading(true);
    setSimResult(null);
    try {
      const res = await simulateRules({
        content: simContent,
        threadId: simThreadId || undefined,
        threadType: simThreadType || undefined,
        senderId: simSenderId || undefined,
        messageType: simMessageType || undefined,
      });
      setSimResult(res.data);
    } catch (err) {
      setSimResult(null);
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setSimLoading(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">🧠 Rule Engine</h1>
          <p className="text-gray-600 mt-1">
            Quản lý auto-reply rules — fixed reply, ignore, route to Hermes
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          + New Rule
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* ── Simulator Panel ─────────────────────────────────────── */}
      <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
        <h2 className="font-semibold mb-3">🧪 Simulator</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <input
            className="border rounded px-3 py-2 text-sm"
            placeholder="Content (e.g. xin chào)"
            value={simContent}
            onChange={(e) => setSimContent(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSimulate()}
          />
          <input
            className="border rounded px-3 py-2 text-sm"
            placeholder="Thread ID"
            value={simThreadId}
            onChange={(e) => setSimThreadId(e.target.value)}
          />
          <select
            className="border rounded px-3 py-2 text-sm"
            value={simThreadType}
            onChange={(e) => setSimThreadType(e.target.value)}
          >
            <option value="user">DM (user)</option>
            <option value="group">Group</option>
          </select>
          <select
            className="border rounded px-3 py-2 text-sm"
            value={simMessageType}
            onChange={(e) => setSimMessageType(e.target.value)}
          >
            <option value="text">Text</option>
            <option value="image">Image</option>
            <option value="sticker">Sticker</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSimulate}
            disabled={simLoading || !simContent.trim()}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium disabled:opacity-50"
          >
            {simLoading ? "Testing..." : "▶ Test Rules"}
          </button>
          <span className="text-xs text-gray-500">
            Simulator không gửi Zalo thật — an toàn để test
          </span>
        </div>

        {simResult && (
          <div className="mt-3 p-3 bg-white border rounded text-sm space-y-1">
            <div>
              <strong>Matched:</strong>{" "}
              <span className={simResult.matched ? "text-green-600" : "text-red-600"}>
                {simResult.matched ? "✅ YES" : "❌ NO"}
              </span>
            </div>
            {simResult.matched && (
              <>
                <div>
                  <strong>Matched Rules:</strong>{" "}
                  {simResult.matchedRules.map((r) => r.ruleName).join(", ") || "None"}
                </div>
                {simResult.winningRule && (
                  <>
                    <div>
                      <strong>Winner:</strong> {simResult.winningRule.ruleName} →{" "}
                      <span className="font-mono text-xs bg-gray-100 px-1 rounded">
                        {simResult.winningRule.actionType}
                      </span>
                    </div>
                    <div>
                      <strong>Preview:</strong>{" "}
                      <span className="text-gray-600">{simResult.winningRule.actionPreview}</span>
                    </div>
                  </>
                )}
              </>
            )}
            <div>
              <strong>Would Send:</strong>{" "}
              <span className={simResult.wouldSend ? "text-orange-600" : "text-blue-600"}>
                {simResult.wouldSend ? "⚠️ YES (live mode)" : "🔒 NO (dry-run)"}
              </span>
            </div>
            <div>
              <strong>Reason:</strong>{" "}
              <span className="text-gray-500 font-mono text-xs">{simResult.reason}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Rules Table ─────────────────────────────────────────── */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : rules.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No rules yet. Create one with the button above.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">Enabled</th>
                <th className="p-3 font-medium">Priority</th>
                <th className="p-3 font-medium">Trigger</th>
                <th className="p-3 font-medium">Action</th>
                <th className="p-3 font-medium">Target</th>
                <th className="p-3 font-medium">Matches</th>
                <th className="p-3 font-medium">Last Match</th>
                <th className="p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-t hover:bg-gray-50">
                  <td className="p-3">
                    <button
                      onClick={() => viewDetail(rule.id)}
                      className="text-blue-600 hover:underline text-left font-medium"
                    >
                      {rule.name}
                    </button>
                    {rule.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{rule.description}</p>
                    )}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => handleToggle(rule)}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        rule.enabled
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-200 text-gray-500"
                      }`}
                    >
                      {rule.enabled ? "ON" : "OFF"}
                    </button>
                  </td>
                  <td className="p-3 font-mono text-xs">{rule.priority}</td>
                  <td className="p-3">
                    <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                      {rule.triggerType}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                      {rule.actionType}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-gray-500">
                    {rule.targetThreadIds ? rule.targetThreadIds.join(", ").slice(0, 30) : "All"}
                  </td>
                  <td className="p-3 font-mono text-xs">{rule.matchCount}</td>
                  <td className="p-3 text-xs text-gray-500">
                    {rule.lastMatchedAt
                      ? new Date(rule.lastMatchedAt).toLocaleString("vi-VN")
                      : "—"}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEdit(rule)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggle(rule)}
                        className="text-xs text-gray-600 hover:underline"
                      >
                        {rule.enabled ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Detail Panel ────────────────────────────────────────── */}
      {selectedRule && (
        <div className="p-4 bg-white border rounded-lg space-y-4">
          <h2 className="font-semibold">📋 Rule Details: {selectedRule}</h2>

          {versions.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">Version History</h3>
              <div className="max-h-40 overflow-y-auto text-xs space-y-1">
                {versions.map((v) => (
                  <div key={v.id} className="flex gap-3 text-gray-600">
                    <span className="font-mono">v{v.version}</span>
                    <span>{new Date(v.createdAt).toLocaleString("vi-VN")}</span>
                    <span>{v.changeReason ?? "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {executions.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">Recent Executions</h3>
              <div className="max-h-40 overflow-y-auto text-xs space-y-1">
                {executions.map((e) => (
                  <div key={e.id} className="flex gap-3 text-gray-600">
                    <span className={e.matched ? "text-green-600" : "text-red-600"}>
                      {e.matched ? "✅" : "❌"}
                    </span>
                    <span>{e.actionTaken ?? "—"}</span>
                    <span>{e.result ?? "—"}</span>
                    <span>{new Date(e.createdAt).toLocaleString("vi-VN")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Create/Edit Modal ───────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">
                {editId ? "Edit Rule" : "Create Rule"}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                {formError}
              </div>
            )}

            {/* ── Basic info ─────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium mb-1">Name *</label>
                <input
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Xin chào fixed reply"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Description</label>
                <input
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Auto reply when user says hello"
                />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium mb-1">Enabled</label>
                <select
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={formEnabled ? "true" : "false"}
                  onChange={(e) => setFormEnabled(e.target.value === "true")}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Priority (0-9999)</label>
                <input
                  type="number"
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={formPriority}
                  onChange={(e) => setFormPriority(parseInt(e.target.value, 10) || 0)}
                  min={0}
                  max={9999}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Trigger Type *</label>
                <select
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={formTrigger}
                  onChange={(e) => setFormTrigger(e.target.value)}
                >
                  {TRIGGER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Action Type *</label>
                <select
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={formAction}
                  onChange={(e) => setFormAction(e.target.value)}
                >
                  {ACTION_TYPES.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── Condition-specific fields ──────────────────── */}
            {(formTrigger === "keyword_contains" || formTrigger === "keyword_regex") && (
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium mb-1">
                    Keywords (comma-separated) *
                  </label>
                  <input
                    className="w-full border rounded px-3 py-2 text-sm font-mono"
                    value={formKeywords}
                    onChange={(e) => setFormKeywords(e.target.value)}
                    placeholder="xin chào, hello, chào bạn"
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formCaseSensitive}
                      onChange={(e) => setFormCaseSensitive(e.target.checked)}
                    />
                    Case Sensitive
                  </label>
                </div>
              </div>
            )}

            {formTrigger === "message_type" && (
              <div className="mb-4">
                <label className="block text-xs font-medium mb-1">Message Type *</label>
                <select
                  className="border rounded px-3 py-2 text-sm"
                  value={formMessageType}
                  onChange={(e) => setFormMessageType(e.target.value)}
                >
                  <option value="text">Text</option>
                  <option value="image">Image</option>
                  <option value="sticker">Sticker</option>
                </select>
              </div>
            )}

            {formTrigger === "thread_type" && (
              <div className="mb-4">
                <label className="block text-xs font-medium mb-1">Thread Type *</label>
                <select
                  className="border rounded px-3 py-2 text-sm"
                  value={formThreadType}
                  onChange={(e) => setFormThreadType(e.target.value)}
                >
                  <option value="user">DM (user)</option>
                  <option value="group">Group</option>
                </select>
              </div>
            )}

            {formTrigger === "sender_id" && (
              <div className="mb-4">
                <label className="block text-xs font-medium mb-1">Sender ID *</label>
                <input
                  className="border rounded px-3 py-2 text-sm font-mono w-full"
                  value={formSenderId}
                  onChange={(e) => setFormSenderId(e.target.value)}
                  placeholder="Zalo user UID..."
                />
              </div>
            )}

            {/* ── Action-specific fields ─────────────────────── */}
            {formAction === "fixed_reply" && (
              <div className="mb-4">
                <label className="block text-xs font-medium mb-1">Reply Text *</label>
                <textarea
                  className="w-full border rounded px-3 py-2 text-sm"
                  rows={3}
                  value={formReply}
                  onChange={(e) => setFormReply(e.target.value)}
                  placeholder="Chào bạn! Mình có thể giúp gì?"
                />
              </div>
            )}

            {/* ── Optional fields ────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium mb-1">Target Threads (comma-separated)</label>
                <input
                  className="w-full border rounded px-3 py-2 text-sm font-mono"
                  value={formTargetThreads}
                  onChange={(e) => setFormTargetThreads(e.target.value)}
                  placeholder="Leave empty for all threads"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Cooldown (seconds)</label>
                <input
                  type="number"
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={formCooldown}
                  onChange={(e) => setFormCooldown(e.target.value)}
                  placeholder="Optional"
                  min={0}
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium mb-1">Change Reason</label>
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                value={formChangeReason}
                onChange={(e) => setFormChangeReason(e.target.value)}
                placeholder={editId ? "Updated regex pattern" : "Initial creation"}
              />
            </div>

            {/* ── Buttons ─────────────────────────────────────── */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={formSaving || !formName.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
              >
                {formSaving ? "Saving..." : editId ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
