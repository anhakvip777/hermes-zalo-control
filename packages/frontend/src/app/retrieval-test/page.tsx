"use client";

// =============================================================================
// Phase 3.5D — Retrieval Answer test panel (admin, READ-ONLY)
// =============================================================================
// Manually exercise POST /api/agent/tools/retrieval-answer from the browser.
// There is NO send button, NO sendOutbound, NO provider AI, NO bridge, NO live.
// It only calls the read-only retrievalAnswer route and renders the evidence.
// =============================================================================

import { useState } from "react";
import {
  retrievalAnswer,
  type RetrievalAnswerInput,
  type RetrievalAnswerResult,
} from "../../lib/api-client";
import { ApiError } from "../../lib/api";
import {
  Card,
  PageHeader,
  WarnBanner,
  ErrorBanner,
  DarkButton,
  DarkInput,
  DarkSelect,
  DarkTextarea,
  DarkCheckbox,
  StatusPill,
  DarkTable,
  DarkThead,
  DarkTh,
  DarkTr,
  DarkTd,
  SectionLabel,
} from "../../components/ui/dark";

type StatusPillVariant = "ready" | "warn" | "blocked" | "not-ready" | "info" | "low" | "medium" | "high";

function statusVariant(status: RetrievalAnswerResult["status"]): StatusPillVariant {
  switch (status) {
    case "found": return "ready";
    case "not_found": return "not-ready";
    case "permission_denied": return "blocked";
    case "unavailable": return "warn";
    default: return "info";
  }
}

function confidenceVariant(c: RetrievalAnswerResult["confidence"]): "low" | "medium" | "high" {
  return c === "high" ? "high" : c === "medium" ? "medium" : "low";
}

export default function RetrievalTestPage() {
  const [query, setQuery] = useState("");
  const [requesterThreadId, setRequesterThreadId] = useState("");
  const [requesterThreadType, setRequesterThreadType] = useState<"user" | "group">("group");
  const [targetThreadId, setTargetThreadId] = useState("");
  const [targetThreadType, setTargetThreadType] = useState<"" | "user" | "group">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [role, setRole] = useState<"form_only" | "basic_chat" | "advanced" | "admin">("admin");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RetrievalAnswerResult | null>(null);

  const canSubmit = query.trim().length > 0 && requesterThreadId.trim().length > 0 && !loading;

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    const input: RetrievalAnswerInput = {
      query: query.trim(),
      requesterThreadId: requesterThreadId.trim(),
      requesterThreadType,
      targetThreadId: targetThreadId.trim() || requesterThreadId.trim(),
      targetThreadType: targetThreadType || requesterThreadType,
      includeAttachments,
      role,
    };
    if (dateFrom.trim()) input.dateFrom = dateFrom.trim();
    if (dateTo.trim()) input.dateTo = dateTo.trim();

    try {
      const res = await retrievalAnswer(input);
      setResult(res);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.status} — ${err.message}` : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="◔ Retrieval Test"
        subtitle="Admin read-only panel để test retrievalAnswer thủ công"
      />

      <WarnBanner message="Read-only test. Không gửi Zalo. Không bật autoReply. Không live." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Form ── */}
        <Card>
          <h2 className="text-lg font-semibold text-slate-100 mb-4">Query</h2>
          <div className="space-y-3">
            <div>
              <SectionLabel>query *</SectionLabel>
              <DarkTextarea
                rows={3}
                placeholder="vd: gửi tôi thực đơn cửa hàng B trong group A"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <SectionLabel>requesterThreadId *</SectionLabel>
                <DarkInput
                  placeholder="group-A"
                  value={requesterThreadId}
                  onChange={(e) => setRequesterThreadId(e.target.value)}
                />
              </div>
              <div>
                <SectionLabel>requesterThreadType</SectionLabel>
                <DarkSelect
                  value={requesterThreadType}
                  onChange={(e) => setRequesterThreadType(e.target.value as "user" | "group")}
                >
                  <option value="group">group</option>
                  <option value="user">user</option>
                </DarkSelect>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <SectionLabel>targetThreadId (optional)</SectionLabel>
                <DarkInput
                  placeholder="(để trống = dùng requester thread)"
                  value={targetThreadId}
                  onChange={(e) => setTargetThreadId(e.target.value)}
                />
              </div>
              <div>
                <SectionLabel>targetThreadType (optional)</SectionLabel>
                <DarkSelect
                  value={targetThreadType}
                  onChange={(e) => setTargetThreadType(e.target.value as "" | "user" | "group")}
                >
                  <option value="">—</option>
                  <option value="group">group</option>
                  <option value="user">user</option>
                </DarkSelect>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <SectionLabel>dateFrom (optional, ISO)</SectionLabel>
                <DarkInput
                  placeholder="2026-05-01T00:00:00Z"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div>
                <SectionLabel>dateTo (optional, ISO)</SectionLabel>
                <DarkInput
                  placeholder="2026-05-31T23:59:59Z"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <SectionLabel>role (simulation)</SectionLabel>
                <DarkSelect
                  value={role}
                  onChange={(e) => setRole(e.target.value as typeof role)}
                >
                  <option value="admin">admin</option>
                  <option value="advanced">advanced</option>
                  <option value="basic_chat">basic_chat</option>
                  <option value="form_only">form_only</option>
                </DarkSelect>
              </div>
              <div className="pb-2">
                <DarkCheckbox
                  label="includeAttachments"
                  checked={includeAttachments}
                  onChange={setIncludeAttachments}
                />
              </div>
            </div>

            <div className="pt-2">
              <DarkButton variant="primary" size="md" onClick={onSubmit} disabled={!canSubmit}>
                {loading ? "Đang tìm…" : "Run retrieval (read-only)"}
              </DarkButton>
            </div>
          </div>
        </Card>

        {/* ── Result ── */}
        <Card>
          <h2 className="text-lg font-semibold text-slate-100 mb-4">Result</h2>

          {error && <ErrorBanner message={error} />}

          {!error && !result && (
            <p className="text-sm text-slate-500">Chưa có kết quả. Nhập query và bấm Run.</p>
          )}

          {result && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <StatusPill variant={statusVariant(result.status)}>{result.status}</StatusPill>
                <StatusPill variant={confidenceVariant(result.confidence)}>
                  confidence: {result.confidence}
                </StatusPill>
              </div>

              <div>
                <SectionLabel>answerText</SectionLabel>
                <div className="whitespace-pre-wrap text-sm text-slate-200 bg-slate-900 border border-slate-700 rounded-lg p-3">
                  {result.answerText}
                </div>
              </div>

              <div>
                <SectionLabel>evidence ({result.evidence.length})</SectionLabel>
                {result.evidence.length === 0 ? (
                  <p className="text-sm text-slate-500">Không có evidence.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <DarkTable>
                      <DarkThead>
                        <DarkTh>messageId</DarkTh>
                        <DarkTh>attachmentId</DarkTh>
                        <DarkTh>source</DarkTh>
                        <DarkTh>threadId</DarkTh>
                        <DarkTh>threadType</DarkTh>
                        <DarkTh>createdAt</DarkTh>
                        <DarkTh>extractionStatus</DarkTh>
                        <DarkTh>snippet</DarkTh>
                      </DarkThead>
                      <tbody>
                        {result.evidence.map((e, i) => (
                          <DarkTr key={`${e.messageId}-${i}`}>
                            <DarkTd><span className="font-mono text-xs">{e.messageId}</span></DarkTd>
                            <DarkTd><span className="font-mono text-xs">{e.attachmentId ?? "—"}</span></DarkTd>
                            <DarkTd>{e.source}</DarkTd>
                            <DarkTd><span className="font-mono text-xs">{e.threadId}</span></DarkTd>
                            <DarkTd>{e.threadType}</DarkTd>
                            <DarkTd><span className="text-xs">{e.createdAt}</span></DarkTd>
                            <DarkTd>{e.extractionStatus ?? "—"}</DarkTd>
                            <DarkTd><span className="text-xs text-slate-400">{e.snippetRedacted ?? "—"}</span></DarkTd>
                          </DarkTr>
                        ))}
                      </tbody>
                    </DarkTable>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
