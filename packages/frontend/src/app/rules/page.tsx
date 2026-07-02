"use client";

import { useState, useEffect, useCallback } from "react";
import {
  listRules,
  createRule,
  updateRule,
  enableRule,
  disableRule,
  getRuleVersions,
  getRuleExecutions,
  simulateRules,
  type RuleOutput,
  type RuleVersionOutput,
  type RuleExecutionOutput,
  type SimulatorOutput,
} from "../../lib/api-client";
import {
  Card,
  PageHeader,
  LoadingSpinner,
  EmptyState,
  ErrorBanner,
  DarkButton,
  DarkInput,
  DarkSelect,
  DarkTextarea,
  DarkCheckbox,
  DarkModal,
  StatusPill,
  DarkTable,
  DarkThead,
  DarkTh,
  DarkTr,
  DarkTd,
  SectionLabel,
  InlineCode,
} from "../../components/ui/dark";

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

  const [selectedRule, setSelectedRule] = useState<string | null>(null);
  const [versions, setVersions] = useState<RuleVersionOutput[]>([]);
  const [executions, setExecutions] = useState<RuleExecutionOutput[]>([]);

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

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const openCreate = () => {
    setEditId(null); setFormName(""); setFormDesc("");
    setFormTrigger("keyword_contains"); setFormAction("fixed_reply");
    setFormPriority(100); setFormEnabled(true); setFormKeywords(""); setFormReply("");
    setFormCaseSensitive(false); setFormTargetThreads(""); setFormCooldown("");
    setFormMessageType("text"); setFormThreadType("user"); setFormSenderId(""); setFormChangeReason("");
    setFormError(null); setShowForm(true);
  };

  const openEdit = (rule: RuleOutput) => {
    setEditId(rule.id); setFormName(rule.name); setFormDesc(rule.description ?? "");
    setFormTrigger(rule.triggerType); setFormAction(rule.actionType);
    setFormPriority(rule.priority); setFormEnabled(rule.enabled);
    setFormKeywords(Array.isArray(rule.conditions.keywords) ? (rule.conditions.keywords as string[]).join(", ") : "");
    setFormReply(typeof rule.actionConfig.reply === "string" ? rule.actionConfig.reply : "");
    setFormCaseSensitive(rule.conditions.caseSensitive === true);
    setFormTargetThreads(rule.targetThreadIds ? rule.targetThreadIds.join(", ") : "");
    setFormCooldown(rule.cooldownSeconds?.toString() ?? "");
    setFormMessageType(typeof rule.conditions.messageType === "string" ? rule.conditions.messageType : "text");
    setFormThreadType(typeof rule.conditions.threadType === "string" ? rule.conditions.threadType : "user");
    setFormSenderId(typeof rule.conditions.senderId === "string" ? rule.conditions.senderId : "");
    setFormChangeReason(""); setFormError(null); setShowForm(true);
  };

  const buildConditions = (): Record<string, unknown> => {
    switch (formTrigger) {
      case "keyword_contains": case "keyword_regex":
        return { keywords: formKeywords.split(",").map(k => k.trim()).filter(Boolean), caseSensitive: formCaseSensitive };
      case "message_type": return { messageType: formMessageType };
      case "thread_type": return { threadType: formThreadType };
      case "sender_id": return { senderId: formSenderId };
      default: return {};
    }
  };

  const buildActionConfig = (): Record<string, unknown> => {
    if (formAction === "fixed_reply") return { reply: formReply };
    return {};
  };

  const handleSave = async () => {
    setFormSaving(true); setFormError(null);
    const body: Record<string, unknown> = {
      name: formName, description: formDesc || undefined, enabled: formEnabled,
      priority: formPriority, triggerType: formTrigger, conditions: buildConditions(),
      actionType: formAction, actionConfig: buildActionConfig(),
      targetThreadIds: formTargetThreads ? formTargetThreads.split(",").map(t => t.trim()).filter(Boolean) : undefined,
      cooldownSeconds: formCooldown ? parseInt(formCooldown, 10) : undefined,
      changedBy: "admin", changeReason: formChangeReason || undefined,
    };
    try {
      if (editId) await updateRule(editId, body);
      else await createRule(body);
      setShowForm(false); fetchRules();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally { setFormSaving(false); }
  };

  const handleToggle = async (rule: RuleOutput) => {
    try {
      if (rule.enabled) await disableRule(rule.id);
      else await enableRule(rule.id);
      fetchRules();
    } catch { /* ignore */ }
  };

  const viewDetail = async (ruleId: string) => {
    setSelectedRule(ruleId === selectedRule ? null : ruleId);
    if (ruleId !== selectedRule) {
      try {
        const [v, e] = await Promise.all([getRuleVersions(ruleId), getRuleExecutions(ruleId, 20)]);
        setVersions(v.data); setExecutions(e.data);
      } catch { setVersions([]); setExecutions([]); }
    }
  };

  const handleSimulate = async () => {
    if (!simContent.trim()) return;
    setSimLoading(true); setSimResult(null);
    try {
      const res = await simulateRules({
        content: simContent, threadId: simThreadId || undefined,
        threadType: simThreadType || undefined, senderId: simSenderId || undefined,
        messageType: simMessageType || undefined,
      });
      setSimResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally { setSimLoading(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="🧠 Rule Engine"
        subtitle="Quản lý auto-reply rules — fixed reply, ignore, route to Hermes"
        onRefresh={fetchRules}
      >
        <DarkButton variant="primary" size="sm" onClick={openCreate}>+ New Rule</DarkButton>
      </PageHeader>

      {error && <ErrorBanner message={error} />}

      {/* Simulator Panel */}
      <Card>
        <h2 className="font-semibold text-slate-100 mb-3">🧪 Simulator</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <DarkInput
            placeholder="Content (e.g. xin chào)"
            value={simContent}
            onChange={(e) => setSimContent(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSimulate()}
          />
          <DarkInput
            placeholder="Thread ID"
            value={simThreadId}
            onChange={(e) => setSimThreadId(e.target.value)}
          />
          <DarkSelect value={simThreadType} onChange={(e) => setSimThreadType(e.target.value)}>
            <option value="user">DM (user)</option>
            <option value="group">Group</option>
          </DarkSelect>
          <DarkSelect value={simMessageType} onChange={(e) => setSimMessageType(e.target.value)}>
            <option value="text">Text</option>
            <option value="image">Image</option>
            <option value="sticker">Sticker</option>
          </DarkSelect>
        </div>
        <div className="flex items-center gap-3">
          <DarkButton variant="success" size="md" onClick={handleSimulate} disabled={simLoading || !simContent.trim()}>
            {simLoading ? "Testing..." : "▶ Test Rules"}
          </DarkButton>
          <span className="text-xs text-slate-500">Simulator không gửi Zalo thật — an toàn để test</span>
        </div>

        {simResult && (
          <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-2 text-sm">
            <div>
              <span className="text-slate-400">Matched: </span>
              <span className={simResult.matched ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>
                {simResult.matched ? "✅ YES" : "❌ NO"}
              </span>
            </div>
            {simResult.matched && (
              <>
                <div>
                  <span className="text-slate-400">Matched Rules: </span>
                  <span className="text-slate-200">{simResult.matchedRules.map(r => r.ruleName).join(", ") || "None"}</span>
                </div>
                {simResult.winningRule && (
                  <>
                    <div>
                      <span className="text-slate-400">Winner: </span>
                      <span className="text-slate-200">{simResult.winningRule.ruleName}</span>
                      <span className="text-slate-500"> → </span>
                      <InlineCode>{simResult.winningRule.actionType}</InlineCode>
                    </div>
                    <div>
                      <span className="text-slate-400">Preview: </span>
                      <span className="text-slate-300">{simResult.winningRule.actionPreview}</span>
                    </div>
                  </>
                )}
              </>
            )}
            <div>
              <span className="text-slate-400">Would Send: </span>
              <span className={simResult.wouldSend ? "text-orange-400" : "text-blue-400"}>
                {simResult.wouldSend ? "⚠️ YES (live mode)" : "🔒 NO (dry-run)"}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Reason: </span>
              <InlineCode>{simResult.reason}</InlineCode>
            </div>
          </div>
        )}
      </Card>

      {/* Rules Table */}
      {loading ? (
        <LoadingSpinner />
      ) : rules.length === 0 ? (
        <EmptyState message="Chưa có rule nào. Tạo rule mới bên trên." icon="🧠" />
      ) : (
        <DarkTable>
          <DarkThead>
            <DarkTh>Tên</DarkTh>
            <DarkTh>Enabled</DarkTh>
            <DarkTh>Priority</DarkTh>
            <DarkTh>Trigger</DarkTh>
            <DarkTh>Action</DarkTh>
            <DarkTh>Target</DarkTh>
            <DarkTh>Matches</DarkTh>
            <DarkTh>Last Match</DarkTh>
            <DarkTh>Actions</DarkTh>
          </DarkThead>
          <tbody>
            {rules.map((rule) => (
              <DarkTr key={rule.id}>
                <DarkTd>
                  <button onClick={() => viewDetail(rule.id)} className="text-blue-400 hover:underline text-left font-medium text-sm">
                    {rule.name}
                  </button>
                  {rule.description && <p className="text-xs text-slate-500 mt-0.5">{rule.description}</p>}
                </DarkTd>
                <DarkTd>
                  <button onClick={() => handleToggle(rule)}>
                    <StatusPill variant={rule.enabled ? "active" : "inactive"}>{rule.enabled ? "ON" : "OFF"}</StatusPill>
                  </button>
                </DarkTd>
                <DarkTd><span className="font-mono text-xs text-slate-400">{rule.priority}</span></DarkTd>
                <DarkTd><StatusPill variant="info">{rule.triggerType}</StatusPill></DarkTd>
                <DarkTd><StatusPill variant="dry-run">{rule.actionType}</StatusPill></DarkTd>
                <DarkTd><span className="text-xs text-slate-500">{rule.targetThreadIds ? rule.targetThreadIds.join(", ").slice(0, 30) : "All"}</span></DarkTd>
                <DarkTd><span className="font-mono text-xs text-slate-400">{rule.matchCount}</span></DarkTd>
                <DarkTd><span className="text-xs text-slate-500">{rule.lastMatchedAt ? new Date(rule.lastMatchedAt).toLocaleString("vi-VN") : "—"}</span></DarkTd>
                <DarkTd>
                  <div className="flex gap-1.5">
                    <DarkButton variant="primary" size="sm" onClick={() => openEdit(rule)}>Edit</DarkButton>
                    <DarkButton variant="ghost" size="sm" onClick={() => handleToggle(rule)}>
                      {rule.enabled ? "Disable" : "Enable"}
                    </DarkButton>
                  </div>
                </DarkTd>
              </DarkTr>
            ))}
          </tbody>
        </DarkTable>
      )}

      {/* Detail Panel */}
      {selectedRule && (
        <Card>
          <h2 className="font-semibold text-slate-100 mb-4">📋 Rule Details</h2>
          {versions.length > 0 && (
            <div className="mb-4">
              <SectionLabel>Version History</SectionLabel>
              <div className="max-h-40 overflow-y-auto text-xs space-y-1">
                {versions.map((v) => (
                  <div key={v.id} className="flex gap-3 text-slate-500">
                    <span className="font-mono text-slate-400">v{v.version}</span>
                    <span>{new Date(v.createdAt).toLocaleString("vi-VN")}</span>
                    <span>{v.changeReason ?? "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {executions.length > 0 && (
            <div>
              <SectionLabel>Recent Executions</SectionLabel>
              <div className="max-h-40 overflow-y-auto text-xs space-y-1">
                {executions.map((e) => (
                  <div key={e.id} className="flex gap-3 text-slate-500">
                    <span className={e.matched ? "text-green-400" : "text-red-400"}>{e.matched ? "✅" : "❌"}</span>
                    <span>{e.actionTaken ?? "—"}</span>
                    <span>{e.result ?? "—"}</span>
                    <span>{new Date(e.createdAt).toLocaleString("vi-VN")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <DarkModal onClose={() => setShowForm(false)}>
          <div className="max-h-[80vh] overflow-y-auto pr-1">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-100">{editId ? "Edit Rule" : "Create Rule"}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
            </div>

            {formError && <div className="mb-4 rounded-lg border border-red-700/60 bg-red-900/20 p-3 text-red-300 text-sm">{formError}</div>}

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Name *</label>
                <DarkInput value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Xin chào fixed reply" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Description</label>
                <DarkInput value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Auto reply when user says hello" />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Enabled</label>
                <DarkSelect value={formEnabled ? "true" : "false"} onChange={(e) => setFormEnabled(e.target.value === "true")}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </DarkSelect>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Priority</label>
                <DarkInput type="number" value={formPriority} onChange={(e) => setFormPriority(parseInt(e.target.value, 10) || 0)} min={0} max={9999} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Trigger *</label>
                <DarkSelect value={formTrigger} onChange={(e) => setFormTrigger(e.target.value)}>
                  {TRIGGER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </DarkSelect>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Action *</label>
                <DarkSelect value={formAction} onChange={(e) => setFormAction(e.target.value)}>
                  {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </DarkSelect>
              </div>
            </div>

            {(formTrigger === "keyword_contains" || formTrigger === "keyword_regex") && (
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Keywords (comma-separated) *</label>
                  <DarkInput className="font-mono" value={formKeywords} onChange={(e) => setFormKeywords(e.target.value)} placeholder="xin chào, hello" />
                </div>
                <div className="flex items-end pb-1">
                  <DarkCheckbox label="Case Sensitive" checked={formCaseSensitive} onChange={setFormCaseSensitive} />
                </div>
              </div>
            )}

            {formTrigger === "message_type" && (
              <div className="mb-3">
                <label className="block text-xs font-medium text-slate-400 mb-1">Message Type *</label>
                <DarkSelect value={formMessageType} onChange={(e) => setFormMessageType(e.target.value)}>
                  <option value="text">Text</option>
                  <option value="image">Image</option>
                  <option value="sticker">Sticker</option>
                </DarkSelect>
              </div>
            )}

            {formTrigger === "thread_type" && (
              <div className="mb-3">
                <label className="block text-xs font-medium text-slate-400 mb-1">Thread Type *</label>
                <DarkSelect value={formThreadType} onChange={(e) => setFormThreadType(e.target.value)}>
                  <option value="user">DM (user)</option>
                  <option value="group">Group</option>
                </DarkSelect>
              </div>
            )}

            {formTrigger === "sender_id" && (
              <div className="mb-3">
                <label className="block text-xs font-medium text-slate-400 mb-1">Sender ID *</label>
                <DarkInput className="font-mono" value={formSenderId} onChange={(e) => setFormSenderId(e.target.value)} placeholder="Zalo user UID..." />
              </div>
            )}

            {formAction === "fixed_reply" && (
              <div className="mb-3">
                <label className="block text-xs font-medium text-slate-400 mb-1">Reply Text *</label>
                <DarkTextarea rows={3} value={formReply} onChange={(e) => setFormReply(e.target.value)} placeholder="Chào bạn! Mình có thể giúp gì?" />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Target Threads (comma-separated)</label>
                <DarkInput className="font-mono" value={formTargetThreads} onChange={(e) => setFormTargetThreads(e.target.value)} placeholder="Leave empty for all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Cooldown (seconds)</label>
                <DarkInput type="number" value={formCooldown} onChange={(e) => setFormCooldown(e.target.value)} placeholder="Optional" min={0} />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-400 mb-1">Change Reason</label>
              <DarkInput value={formChangeReason} onChange={(e) => setFormChangeReason(e.target.value)} placeholder={editId ? "Updated regex pattern" : "Initial creation"} />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-700">
              <DarkButton variant="ghost" size="md" onClick={() => setShowForm(false)}>Cancel</DarkButton>
              <DarkButton variant="primary" size="md" onClick={handleSave} disabled={formSaving || !formName.trim()}>
                {formSaving ? "Saving..." : editId ? "Update" : "Create"}
              </DarkButton>
            </div>
          </div>
        </DarkModal>
      )}
    </div>
  );
}
