"use client";

// =============================================================================
// Decision Trace (Phase 7) — READ-ONLY view
// =============================================================================
// Reconstructs the decision path for an inbound message:
//   inbound → identity → gate → rules → agent tasks → tool calls →
//   Zalo actions (reaction/poll) → assistant reply → outbound decision.
// This page performs NO writes and triggers NO actions — only GET fetches.
// All payloads are redacted server-side before they reach here.
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import {
  listTraces,
  getTrace,
  type TraceSummary,
  type TraceDetail,
} from "../../lib/api-client";
import { useToast } from "../../components/toast";
import { formatVnTime, formatRelativeTime } from "../../components/ui/TimeText";

/* ── Small UI atoms ───────────────────────────────────────────── */
function Pill({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>
      {label}
    </span>
  );
}

function decisionCls(decision: string | null): string {
  switch (decision) {
    case "allow":
      return "bg-green-950 text-green-400 border-green-800";
    case "skip":
      return "bg-yellow-950 text-yellow-400 border-yellow-800";
    case "block":
      return "bg-red-950 text-red-400 border-red-800";
    default:
      return "bg-slate-800 text-slate-500 border-slate-700";
  }
}

function execCls(status: string): string {
  switch (status) {
    case "success":
      return "bg-green-950 text-green-400 border-green-800";
    case "failed":
      return "bg-red-950 text-red-400 border-red-800";
    case "blocked":
      return "bg-orange-950 text-orange-400 border-orange-800";
    case "unavailable":
      return "bg-slate-800 text-slate-500 border-slate-700";
    default:
      return "bg-blue-950 text-blue-400 border-blue-800";
  }
}

function JsonBlock({ value }: { value: unknown }) {
  if (value == null) return <span className="text-slate-700 text-[11px]">—</span>;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="rounded-md bg-slate-950 border border-slate-800 p-2 text-[11px] text-slate-300 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
      {text}
    </pre>
  );
}

/* ── Page ─────────────────────────────────────────────────────── */
export default function TracePage() {
  const { toast } = useToast();
  const [data, setData] = useState<TraceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [threadFilter, setThreadFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = { page: String(page), pageSize: "30" };
    if (threadFilter) params.threadId = threadFilter;
    listTraces(params)
      .then((r) => {
        setData(r.data);
        setTotal(r.total);
        setTotalPages(r.totalPages ?? 1);
      })
      .catch(() => toast("Không tải được trace", "error"))
      .finally(() => setLoading(false));
  }, [page, threadFilter, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const inpCls =
    "min-w-[200px] rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none";

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Decision Trace</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Read-only · đường đi quyết định của mỗi tin · tổng {total}
          </p>
        </div>
        <button
          onClick={fetchData}
          className="px-3 py-1.5 text-xs border border-slate-700 text-slate-400 rounded-md hover:bg-slate-800 transition-colors"
        >
          🔄 Refresh
        </button>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Thread ID…"
          value={threadFilter}
          onChange={(e) => {
            setThreadFilter(e.target.value);
            setPage(1);
          }}
          className={inpCls}
        />
        <button
          onClick={() => {
            setThreadFilter("");
            setPage(1);
          }}
          className="px-2.5 py-1.5 text-xs text-slate-400 border border-slate-700 rounded-md hover:bg-slate-800 transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Table */}
      {loading && data.length === 0 ? (
        <div className="space-y-1">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-slate-800 border border-slate-700" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-12 text-center">
          <p className="text-slate-500 text-sm">Chưa có tin nào để trace</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 border-b border-slate-700">
              <tr>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Time</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Sender</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Content</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Rule</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Tools</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Actions</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Outbound</th>
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr
                  key={t.messageId}
                  className="border-b border-slate-700/60 hover:bg-slate-700/30 transition-colors cursor-pointer"
                  onClick={() => setSelected(t.messageId)}
                >
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <p className="text-xs text-slate-300">{formatRelativeTime(t.receivedAt)}</p>
                    <p className="text-[10px] text-slate-600">{formatVnTime(t.receivedAt, { showDate: false, showUtcLabel: false })}</p>
                  </td>
                  <td className="px-3 py-2.5 max-w-[120px]">
                    <p className="text-[11px] text-slate-400 truncate">{t.senderName ?? "—"}</p>
                    <p className="text-[10px] font-mono text-slate-600 truncate" title={t.threadId}>{t.threadId.slice(-10)}</p>
                  </td>
                  <td className="px-3 py-2.5 max-w-[260px]">
                    <p className="text-xs text-slate-300 truncate" title={t.contentPreviewRedacted}>
                      {t.contentPreviewRedacted}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    {t.ruleMatched ? <Pill label="MATCHED" cls="bg-green-950 text-green-400 border-green-800" /> : <span className="text-slate-700 text-[11px]">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[11px] text-slate-400 font-mono">{t.toolCallCount} tool · {t.agentTaskCount} task</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {t.zaloActionCount > 0 ? (
                      <span className="text-[11px] text-purple-400 font-mono">{t.zaloActionCount} action</span>
                    ) : (
                      <span className="text-slate-700 text-[11px]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {t.outboundDecision ? (
                      <div className="flex items-center gap-1.5">
                        <Pill label={t.outboundDecision.toUpperCase()} cls={decisionCls(t.outboundDecision)} />
                        {t.outboundDryRun ? <span className="text-[10px] text-amber-400">🛡</span> : <span className="text-[10px] text-red-400">⚡</span>}
                      </div>
                    ) : (
                      <span className="text-slate-700 text-[11px]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Trang {page}/{totalPages} · {total} tin</span>
          <div className="flex gap-1.5">
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 text-xs border border-slate-700 text-slate-400 rounded-md hover:bg-slate-800 disabled:opacity-30 transition-colors">← Trước</button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1 text-xs border border-slate-700 text-slate-400 rounded-md hover:bg-slate-800 disabled:opacity-30 transition-colors">Sau →</button>
          </div>
        </div>
      )}

      {/* Detail */}
      {selected && <TraceDetailPanel messageId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* ── Detail waterfall ─────────────────────────────────────────── */
function Step({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
  return (
    <div className="relative pl-8">
      <div className="absolute left-0 top-0.5 w-6 h-6 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center text-[11px] font-bold text-slate-400">
        {index}
      </div>
      <div className="absolute left-3 top-6 bottom-[-16px] w-px bg-slate-700/60" />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{title}</p>
      <div className="pb-4">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-slate-600 uppercase tracking-wider">{label}</span>
      <span className="text-slate-300 text-xs">{value}</span>
    </div>
  );
}

function TraceDetailPanel({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getTrace(messageId)
      .then((r) => setTrace(r.data))
      .catch(() => toast("Không tải được chi tiết trace", "error"))
      .finally(() => setLoading(false));
  }, [messageId, toast]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl bg-slate-900 border-l border-slate-700 shadow-raised overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 shrink-0">
          <p className="text-sm font-semibold text-slate-200">Decision Trace</p>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">×</button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {loading || !trace ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-md bg-slate-800 border border-slate-700" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {/* 1. Inbound */}
              <Step index={1} title="Inbound message">
                <div className="rounded-md bg-slate-800 border border-slate-700 p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Thread" value={<code className="font-mono text-[11px] text-slate-400">{trace.message.threadId}</code>} />
                    <Field label="Type" value={trace.message.threadType} />
                    <Field label="Sender" value={trace.message.senderName ?? trace.message.senderId ?? "—"} />
                    <Field label="Time" value={formatVnTime(trace.message.receivedAt)} />
                  </div>
                  <div className="rounded bg-slate-950 border border-slate-800 p-2 text-xs text-slate-200 whitespace-pre-wrap">
                    {trace.message.contentRedacted || <span className="text-slate-600">Empty</span>}
                  </div>
                </div>
              </Step>

              {/* 2. Identity */}
              <Step index={2} title="Identity / role">
                {trace.identity ? (
                  <div className="rounded-md bg-slate-800 border border-slate-700 p-3 grid grid-cols-2 gap-2">
                    <Field label="Principal" value={<code className="font-mono text-[11px] text-slate-400">{trace.identity.principalId}</code>} />
                    <Field label="Role" value={<Pill label={trace.identity.role} cls="bg-blue-950 text-blue-400 border-blue-800" />} />
                    <Field label="Status" value={trace.identity.status} />
                    <Field label="Scope" value={trace.identity.scope} />
                  </div>
                ) : (
                  <p className="text-xs text-slate-600">Không có principal (mặc định form_only).</p>
                )}
              </Step>

              {/* 3. Gate */}
              <Step index={3} title="Thread gate / settings">
                {trace.gate ? (
                  <div className="rounded-md bg-slate-800 border border-slate-700 p-3 grid grid-cols-2 gap-2">
                    <Field label="Auto-reply" value={trace.gate.autoReplyEnabled ? "ON" : "OFF"} />
                    <Field label="Mention required" value={trace.gate.groupMentionRequired ? "YES" : "NO"} />
                    <Field label="Reply window" value={`${trace.gate.groupReplyWindowSeconds}s`} />
                    <Field label="Allow media" value={trace.gate.allowMedia ? "YES" : "NO"} />
                  </div>
                ) : (
                  <p className="text-xs text-slate-600">Không có thread setting (mặc định).</p>
                )}
              </Step>

              {/* 4. Rules */}
              <Step index={4} title={`Matched rules (${trace.rules.length})`}>
                {trace.rules.length === 0 ? (
                  <p className="text-xs text-slate-600">Không có rule execution.</p>
                ) : (
                  <div className="space-y-1.5">
                    {trace.rules.map((r) => (
                      <div key={r.id} className="rounded-md bg-slate-800 border border-slate-700 p-2.5 flex items-center justify-between">
                        <div>
                          <p className="text-xs text-slate-300">{r.ruleName ?? r.ruleId ?? "—"}</p>
                          <p className="text-[10px] text-slate-600 font-mono">{r.actionTaken ?? "—"}</p>
                        </div>
                        {r.matched ? <Pill label="MATCHED" cls="bg-green-950 text-green-400 border-green-800" /> : <Pill label="NO" cls="bg-slate-800 text-slate-500 border-slate-700" />}
                      </div>
                    ))}
                  </div>
                )}
              </Step>

              {/* 5. Agent tasks */}
              <Step index={5} title={`Agent tasks (${trace.agentTasks.length})`}>
                {trace.agentTasks.length === 0 ? (
                  <p className="text-xs text-slate-600">Không có agent task.</p>
                ) : (
                  <div className="space-y-1.5">
                    {trace.agentTasks.map((t) => (
                      <div key={t.id} className="rounded-md bg-slate-800 border border-slate-700 p-2.5 flex items-center justify-between">
                        <div>
                          <p className="text-xs text-slate-300">{t.taskType}</p>
                          <p className="text-[10px] text-slate-600 font-mono">{t.agentName}{t.errorMessage ? ` · ${t.errorMessage}` : ""}</p>
                        </div>
                        <Pill label={t.status.toUpperCase()} cls={execCls(t.status === "completed" ? "success" : t.status === "failed" ? "failed" : "requested")} />
                      </div>
                    ))}
                  </div>
                )}
              </Step>

              {/* 6. Tool calls */}
              <Step index={6} title={`Tool calls (${trace.toolCalls.length})`}>
                {trace.toolCalls.length === 0 ? (
                  <p className="text-xs text-slate-600">Không có tool call.</p>
                ) : (
                  <div className="space-y-2">
                    {trace.toolCalls.map((t) => (
                      <div key={t.id} className="rounded-md bg-slate-800 border border-slate-700 p-2.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <code className="font-mono text-[11px] text-slate-300">{t.toolName}</code>
                          <div className="flex items-center gap-1.5">
                            <Pill label={t.kind} cls="bg-slate-900 text-slate-400 border-slate-700" />
                            <Pill label={t.executionStatus} cls={execCls(t.executionStatus)} />
                            <Pill label={t.deliveryStatus} cls="bg-slate-900 text-slate-400 border-slate-700" />
                          </div>
                        </div>
                        <Field label="Args (redacted)" value={<JsonBlock value={t.argsRedacted} />} />
                        <Field label="Result (redacted)" value={<JsonBlock value={t.resultRedacted} />} />
                        {t.evidence != null && <Field label="Evidence" value={<JsonBlock value={t.evidence} />} />}
                        {t.errorCode && <Field label="Error" value={<span className="text-red-400">{t.errorCode}</span>} />}
                      </div>
                    ))}
                  </div>
                )}
              </Step>

              {/* 7. Zalo actions */}
              <Step index={7} title={`Zalo actions — reaction/poll (${trace.zaloActions.length})`}>
                {trace.zaloActions.length === 0 ? (
                  <p className="text-xs text-slate-600">Không có reaction/poll.</p>
                ) : (
                  <div className="space-y-2">
                    {trace.zaloActions.map((a) => (
                      <div key={a.id} className="rounded-md bg-slate-800 border border-slate-700 p-2.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-300 font-medium">{a.actionType} · <span className="text-slate-500">{a.trigger}</span></span>
                          <div className="flex items-center gap-1.5">
                            <Pill label={a.decision.toUpperCase()} cls={decisionCls(a.decision)} />
                            {a.dryRun ? <span className="text-[10px] text-amber-400">🛡 DRY</span> : <span className="text-[10px] text-red-400">⚡ LIVE</span>}
                          </div>
                        </div>
                        <Field label="Reason" value={a.reason} />
                        <Field label="Payload (redacted)" value={<JsonBlock value={a.payloadRedacted} />} />
                        {a.providerResultId && <Field label="Provider result" value={<code className="text-green-400 text-[11px]">{a.providerResultId}</code>} />}
                        {a.errorCode && <Field label="Error" value={<span className="text-red-400">{a.errorCode}</span>} />}
                      </div>
                    ))}
                  </div>
                )}
              </Step>

              {/* 8. Outbound */}
              <Step index={8} title="Outbound decision">
                <div className="rounded-md bg-slate-800 border border-slate-700 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-600 uppercase tracking-wider">Link</span>
                    <Pill
                      label={trace.outbound.linkConfidence}
                      cls={
                        trace.outbound.linkConfidence === "exact"
                          ? "bg-green-950 text-green-400 border-green-800"
                          : trace.outbound.linkConfidence === "best_effort"
                            ? "bg-yellow-950 text-yellow-400 border-yellow-800"
                            : "bg-slate-900 text-slate-500 border-slate-700"
                      }
                    />
                  </div>
                  {trace.outbound.record ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Decision" value={<Pill label={trace.outbound.record.decision.toUpperCase()} cls={decisionCls(trace.outbound.record.decision)} />} />
                      <Field label="dryRun" value={trace.outbound.record.dryRun ? "🛡 YES" : "⚡ NO"} />
                      <Field label="Source" value={trace.outbound.record.source} />
                      <Field label="Reason" value={trace.outbound.record.reason} />
                      <Field label="Sent ID" value={trace.outbound.record.sentMessageId ? <code className="font-mono text-green-400 text-[11px]">{trace.outbound.record.sentMessageId}</code> : <span className="text-slate-600">—</span>} />
                      {trace.outbound.record.errorCode && <Field label="Error" value={<span className="text-red-400">{trace.outbound.record.errorCode}</span>} />}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600">Không có outbound record.</p>
                  )}
                  {trace.outbound.reply && (
                    <div className="rounded bg-slate-950 border border-slate-800 p-2 text-xs text-slate-200 whitespace-pre-wrap">
                      {trace.outbound.reply.contentRedacted}
                    </div>
                  )}
                </div>
              </Step>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
