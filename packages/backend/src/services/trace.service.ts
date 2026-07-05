// =============================================================================
// Decision Trace service (Phase 7) — READ-ONLY
// =============================================================================
// Reconstructs the full decision path for a single inbound message:
//   inbound message → identity/principal → thread gate → matched rules →
//   agent tasks → tool calls → Zalo actions (reaction/poll) → assistant reply →
//   outbound decision (dryRun/live, sentMessageId or blocked reason).
//
// IRON LAWS enforced here:
//   - Pure read. No zca-js / getApi / sendMessage. No writes, no replay.
//   - Only redacted payloads leave this service. Raw AgentTask.input/result and
//     Message.metadata are NEVER surfaced. Tokens/cookies/session never surfaced.
//   - No FK assumptions — every join is a manual string-ID lookup.
//
// The data access is behind a TraceDataSource interface so tests run DB-free
// with an in-memory stub (mirrors the tool-gateway evidence-sink pattern).
// =============================================================================

import { redact } from "./tool-gateway/redaction.js";

// ── Row shapes (subset of Prisma models we actually read) ────────────
export interface MessageRow {
  id: string;
  zaloMessageId: string | null;
  threadId: string;
  threadType: string;
  senderId: string | null;
  senderName: string | null;
  content: string;
  isFromBot: boolean;
  messageType: string | null;
  role: string;
  relatedMessageId: string | null;
  receivedAt: Date;
  createdAt: Date;
}

export interface PrincipalRow {
  principalId: string;
  role: string;
  status: string;
  threadId: string | null;
}

export interface ThreadSettingRow {
  threadId: string;
  autoReplyEnabled: boolean;
  groupMentionRequired: boolean;
  groupReplyWindowSeconds: number;
  allowCreateReminder: boolean;
  allowMedia: boolean;
  allowImageUnderstanding: boolean;
  allowDocumentUnderstanding: boolean;
}

export interface RuleExecutionRow {
  id: string;
  ruleId: string | null;
  messageId: string | null;
  threadId: string | null;
  matched: boolean;
  actionTaken: string | null;
  result: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: string | null;
  createdAt: Date;
}

export interface RuleRow {
  id: string;
  name: string;
}

export interface AgentTaskRow {
  id: string;
  agentName: string;
  taskType: string;
  status: string;
  scheduleId: string | null;
  messageId: string | null;
  errorMessage: string | null;
  createdAt: Date;
  // NOTE: input/result intentionally excluded — never read them here.
}

export interface ToolCallRow {
  id: string;
  agentName: string;
  toolName: string;
  kind: string;
  threadId: string;
  executionStatus: string;
  deliveryStatus: string;
  idempotencyKey: string | null;
  argsRedacted: string | null;
  resultRedacted: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  evidence: string | null;
  outboundRecordId: string | null;
  zaloActionRecordId: string | null;
  agentTaskId: string | null;
  relatedMessageId: string | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface ZaloActionRow {
  id: string;
  actionType: string;
  threadId: string;
  trigger: string;
  targetMsgId: string | null;
  payloadRedacted: string | null;
  dryRun: boolean;
  decision: string;
  reason: string;
  executionStatus: string;
  deliveryStatus: string;
  providerResultId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  toolCallRecordId: string | null;
  createdAt: Date;
}

export interface OutboundRecordRow {
  id: string;
  threadId: string;
  content: string;
  sentMessageId: string | null;
  source: string;
  dryRun: boolean;
  errorCode: string | null;
  decision: string;
  reason: string;
  createdAt: Date;
}

// ── Data source interface (Prisma impl + test stub) ──────────────────
export interface TraceListParams {
  threadId?: string;
  page?: number;
  pageSize?: number;
}

export interface TraceDataSource {
  getMessageById(id: string): Promise<MessageRow | null>;
  /** Prefer thread-scoped principal, fall back to global (threadId=null). */
  getPrincipal(principalId: string, threadId: string): Promise<PrincipalRow | null>;
  getThreadSetting(threadId: string): Promise<ThreadSettingRow | null>;
  getRuleExecutions(messageId: string): Promise<RuleExecutionRow[]>;
  getRulesByIds(ruleIds: string[]): Promise<RuleRow[]>;
  getAgentTasks(messageId: string): Promise<AgentTaskRow[]>;
  getToolCalls(messageId: string, agentTaskIds: string[]): Promise<ToolCallRow[]>;
  getZaloActions(toolCallIds: string[], threadId: string): Promise<ZaloActionRow[]>;
  /** Assistant reply: relatedMessageId === messageId AND isFromBot === true. */
  getAssistantReply(messageId: string): Promise<MessageRow | null>;
  /** Outbound records for the thread at/after the inbound time (best-effort link). */
  getOutboundRecords(threadId: string, sinceCreatedAt: Date): Promise<OutboundRecordRow[]>;
  /** Inbound (role=user) messages for the list endpoint. */
  listInboundMessages(params: TraceListParams): Promise<{ rows: MessageRow[]; total: number }>;
}

// ── Output DTOs (all payloads redacted) ──────────────────────────────
export interface TraceDetail {
  message: {
    id: string;
    threadId: string;
    threadType: string;
    senderId: string | null;
    senderName: string | null;
    role: string;
    messageType: string | null;
    contentRedacted: string;
    receivedAt: string;
  };
  identity: { principalId: string; role: string; status: string; scope: "thread" | "global" } | null;
  gate:
    | {
        autoReplyEnabled: boolean;
        groupMentionRequired: boolean;
        groupReplyWindowSeconds: number;
        allowCreateReminder: boolean;
        allowMedia: boolean;
        allowImageUnderstanding: boolean;
        allowDocumentUnderstanding: boolean;
      }
    | null;
  rules: Array<{
    id: string;
    ruleId: string | null;
    ruleName: string | null;
    matched: boolean;
    actionTaken: string | null;
    resultRedacted: unknown;
    errorCode: string | null;
    createdAt: string;
  }>;
  agentTasks: Array<{
    id: string;
    agentName: string;
    taskType: string;
    status: string;
    errorMessage: string | null;
    createdAt: string;
  }>;
  toolCalls: Array<{
    id: string;
    agentName: string;
    toolName: string;
    kind: string;
    executionStatus: string;
    deliveryStatus: string;
    argsRedacted: unknown;
    resultRedacted: unknown;
    errorCode: string | null;
    evidence: unknown;
    durationMs: number | null;
    createdAt: string;
  }>;
  zaloActions: Array<{
    id: string;
    actionType: string;
    trigger: string;
    decision: string;
    reason: string;
    dryRun: boolean;
    executionStatus: string;
    deliveryStatus: string;
    targetMsgId: string | null;
    payloadRedacted: unknown;
    providerResultId: string | null;
    errorCode: string | null;
    createdAt: string;
  }>;
  outbound: {
    linkConfidence: "exact" | "best_effort" | "none";
    reply: { id: string; contentRedacted: string; zaloMessageId: string | null; receivedAt: string } | null;
    record:
      | {
          decision: string;
          reason: string;
          dryRun: boolean;
          source: string;
          sentMessageId: string | null;
          errorCode: string | null;
          createdAt: string;
        }
      | null;
  };
}

export interface TraceSummary {
  messageId: string;
  threadId: string;
  threadType: string;
  senderName: string | null;
  role: string;
  contentPreviewRedacted: string;
  receivedAt: string;
  ruleMatched: boolean;
  agentTaskCount: number;
  toolCallCount: number;
  zaloActionCount: number;
  outboundDecision: string | null;
  outboundDryRun: boolean | null;
  sentMessageId: string | null;
}

// ── Redaction helpers (phones always masked, per policy) ─────────────
const REDACT_OPTS = { allowPhone: false } as const;

function redactText(value: string): string {
  return redact(value, REDACT_OPTS) as string;
}

/** Parse a stored JSON string then deep-redact. Returns null on empty/invalid. */
function redactJsonString(value: string | null | undefined): unknown {
  if (value == null || value === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // Not JSON — treat as an opaque string and still redact secrets in it.
    return redactText(value);
  }
  return redact(parsed, REDACT_OPTS);
}

function iso(d: Date): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

// =============================================================================
// Prisma-backed data source (runtime). Uses dynamic import so the in-memory
// test stub never pulls in @prisma/client.
// =============================================================================
export class PrismaTraceDataSource implements TraceDataSource {
  private async db() {
    const { prisma } = await import("../db.js");
    return prisma as any;
  }

  async getMessageById(id: string): Promise<MessageRow | null> {
    const db = await this.db();
    return (await db.message.findUnique({ where: { id } })) ?? null;
  }

  async getPrincipal(principalId: string, threadId: string): Promise<PrincipalRow | null> {
    const db = await this.db();
    const scoped = await db.zaloPrincipal.findFirst({ where: { principalId, threadId } });
    if (scoped) return scoped;
    return (await db.zaloPrincipal.findFirst({ where: { principalId, threadId: null } })) ?? null;
  }

  async getThreadSetting(threadId: string): Promise<ThreadSettingRow | null> {
    const db = await this.db();
    return (await db.threadSetting.findUnique({ where: { threadId } })) ?? null;
  }

  async getRuleExecutions(messageId: string): Promise<RuleExecutionRow[]> {
    const db = await this.db();
    return db.ruleExecution.findMany({ where: { messageId }, orderBy: { createdAt: "asc" } });
  }

  async getRulesByIds(ruleIds: string[]): Promise<RuleRow[]> {
    if (ruleIds.length === 0) return [];
    const db = await this.db();
    return db.rule.findMany({ where: { id: { in: ruleIds } }, select: { id: true, name: true } });
  }

  async getAgentTasks(messageId: string): Promise<AgentTaskRow[]> {
    const db = await this.db();
    // Explicit select — never read input/result.
    return db.agentTask.findMany({
      where: { messageId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        agentName: true,
        taskType: true,
        status: true,
        scheduleId: true,
        messageId: true,
        errorMessage: true,
        createdAt: true,
      },
    });
  }

  async getToolCalls(messageId: string, agentTaskIds: string[]): Promise<ToolCallRow[]> {
    const db = await this.db();
    const or: any[] = [{ relatedMessageId: messageId }];
    if (agentTaskIds.length > 0) or.push({ agentTaskId: { in: agentTaskIds } });
    return db.toolCallRecord.findMany({ where: { OR: or }, orderBy: { createdAt: "asc" } });
  }

  async getZaloActions(toolCallIds: string[], threadId: string): Promise<ZaloActionRow[]> {
    const db = await this.db();
    const or: any[] = [];
    if (toolCallIds.length > 0) or.push({ toolCallRecordId: { in: toolCallIds } });
    // Fallback: agent-tool triggered actions in the same thread with no tool link.
    or.push({ threadId, trigger: "agent_tool" });
    return db.zaloActionRecord.findMany({ where: { OR: or }, orderBy: { createdAt: "asc" } });
  }

  async getAssistantReply(messageId: string): Promise<MessageRow | null> {
    const db = await this.db();
    return (
      (await db.message.findFirst({
        where: { relatedMessageId: messageId, isFromBot: true },
        orderBy: { createdAt: "asc" },
      })) ?? null
    );
  }

  async getOutboundRecords(threadId: string, sinceCreatedAt: Date): Promise<OutboundRecordRow[]> {
    const db = await this.db();
    return db.outboundRecord.findMany({
      where: { threadId, createdAt: { gte: sinceCreatedAt } },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
  }

  async listInboundMessages(params: TraceListParams): Promise<{ rows: MessageRow[]; total: number }> {
    const db = await this.db();
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(Math.max(1, params.pageSize ?? 30), 100);
    const where: any = { role: "user" };
    if (params.threadId) where.threadId = params.threadId;
    const [rows, total] = await Promise.all([
      db.message.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.message.count({ where }),
    ]);
    return { rows, total };
  }
}

// ── Default source (Prisma); tests inject a stub ─────────────────────
let defaultSource: TraceDataSource | null = null;

export function getTraceDataSource(): TraceDataSource {
  if (!defaultSource) defaultSource = new PrismaTraceDataSource();
  return defaultSource;
}

export function setTraceDataSourceForTest(src: TraceDataSource | null): void {
  defaultSource = src;
}

// =============================================================================
// Assemblers
// =============================================================================

const PREVIEW_LEN = 120;

/**
 * Build a full decision trace for one message.
 * Returns null if the message does not exist.
 */
export async function buildTrace(
  messageId: string,
  source: TraceDataSource = getTraceDataSource(),
): Promise<TraceDetail | null> {
  const message = await source.getMessageById(messageId);
  if (!message) return null;

  const threadId = message.threadId;

  // Identity / principal (thread-scoped preferred, else global).
  let identity: TraceDetail["identity"] = null;
  if (message.senderId) {
    const principal = await source.getPrincipal(message.senderId, threadId);
    if (principal) {
      identity = {
        principalId: principal.principalId,
        role: principal.role,
        status: principal.status,
        scope: principal.threadId ? "thread" : "global",
      };
    }
  }

  // Thread gate / settings.
  const setting = await source.getThreadSetting(threadId);
  const gate: TraceDetail["gate"] = setting
    ? {
        autoReplyEnabled: setting.autoReplyEnabled,
        groupMentionRequired: setting.groupMentionRequired,
        groupReplyWindowSeconds: setting.groupReplyWindowSeconds,
        allowCreateReminder: setting.allowCreateReminder,
        allowMedia: setting.allowMedia,
        allowImageUnderstanding: setting.allowImageUnderstanding,
        allowDocumentUnderstanding: setting.allowDocumentUnderstanding,
      }
    : null;

  // Rules matched for this message.
  const ruleExecs = await source.getRuleExecutions(messageId);
  const ruleIds = [...new Set(ruleExecs.map((r) => r.ruleId).filter((x): x is string => !!x))];
  const ruleRows = await source.getRulesByIds(ruleIds);
  const ruleNameById = new Map(ruleRows.map((r) => [r.id, r.name] as const));
  const rules = ruleExecs.map((r) => ({
    id: r.id,
    ruleId: r.ruleId,
    ruleName: r.ruleId ? ruleNameById.get(r.ruleId) ?? null : null,
    matched: r.matched,
    actionTaken: r.actionTaken,
    resultRedacted: redactJsonString(r.result),
    errorCode: r.errorCode,
    createdAt: iso(r.createdAt),
  }));

  // Agent tasks (never surface input/result).
  const agentTaskRows = await source.getAgentTasks(messageId);
  const agentTaskIds = agentTaskRows.map((t) => t.id);
  const agentTasks = agentTaskRows.map((t) => ({
    id: t.id,
    agentName: t.agentName,
    taskType: t.taskType,
    status: t.status,
    errorMessage: t.errorMessage,
    createdAt: iso(t.createdAt),
  }));

  // Tool calls (already-redacted args/result stored at write time).
  const toolCallRows = await source.getToolCalls(messageId, agentTaskIds);
  const toolCallIds = toolCallRows.map((t) => t.id);
  const toolCalls = toolCallRows.map((t) => ({
    id: t.id,
    agentName: t.agentName,
    toolName: t.toolName,
    kind: t.kind,
    executionStatus: t.executionStatus,
    deliveryStatus: t.deliveryStatus,
    argsRedacted: redactJsonString(t.argsRedacted),
    resultRedacted: redactJsonString(t.resultRedacted),
    errorCode: t.errorCode,
    evidence: redactJsonString(t.evidence),
    durationMs: t.durationMs,
    createdAt: iso(t.createdAt),
  }));

  // Zalo write actions — reaction / poll.
  const zaloActionRows = await source.getZaloActions(toolCallIds, threadId);
  const zaloActions = zaloActionRows.map((a) => ({
    id: a.id,
    actionType: a.actionType,
    trigger: a.trigger,
    decision: a.decision,
    reason: a.reason,
    dryRun: a.dryRun,
    executionStatus: a.executionStatus,
    deliveryStatus: a.deliveryStatus,
    targetMsgId: a.targetMsgId,
    payloadRedacted: redactJsonString(a.payloadRedacted),
    providerResultId: a.providerResultId,
    errorCode: a.errorCode,
    createdAt: iso(a.createdAt),
  }));

  // Assistant reply + outbound decision.
  const reply = await source.getAssistantReply(messageId);
  const outbound = await resolveOutbound(source, message, reply);

  return {
    message: {
      id: message.id,
      threadId: message.threadId,
      threadType: message.threadType,
      senderId: message.senderId,
      senderName: message.senderName,
      role: message.role,
      messageType: message.messageType,
      contentRedacted: redactText(message.content),
      receivedAt: iso(message.receivedAt),
    },
    identity,
    gate,
    rules,
    agentTasks,
    toolCalls,
    zaloActions,
    outbound,
  };
}

/**
 * Link the assistant reply to an OutboundRecord with honest confidence:
 *   exact       — OutboundRecord.sentMessageId === reply.zaloMessageId
 *   best_effort — same thread, created at/after inbound, nearest in time
 *   none        — no candidate found
 */
async function resolveOutbound(
  source: TraceDataSource,
  message: MessageRow,
  reply: MessageRow | null,
): Promise<TraceDetail["outbound"]> {
  const replyDto = reply
    ? {
        id: reply.id,
        contentRedacted: redactText(reply.content),
        zaloMessageId: reply.zaloMessageId,
        receivedAt: iso(reply.receivedAt),
      }
    : null;

  const candidates = await source.getOutboundRecords(message.threadId, message.createdAt);
  if (candidates.length === 0) {
    return { linkConfidence: "none", reply: replyDto, record: null };
  }

  let matched: OutboundRecordRow | null = null;
  let confidence: "exact" | "best_effort" | "none" = "none";

  if (reply?.zaloMessageId) {
    matched = candidates.find((c) => c.sentMessageId && c.sentMessageId === reply.zaloMessageId) ?? null;
    if (matched) confidence = "exact";
  }

  if (!matched) {
    // Best-effort: earliest outbound in-thread at/after the inbound message.
    matched = candidates[0] ?? null;
    if (matched) confidence = "best_effort";
  }

  const record = matched
    ? {
        decision: matched.decision,
        reason: matched.reason,
        dryRun: matched.dryRun,
        source: matched.source,
        sentMessageId: matched.sentMessageId,
        errorCode: matched.errorCode,
        createdAt: iso(matched.createdAt),
      }
    : null;

  return { linkConfidence: confidence, reply: replyDto, record };
}

/**
 * List traceable inbound messages with a compact per-message decision summary.
 */
export async function listTraces(
  params: TraceListParams,
  source: TraceDataSource = getTraceDataSource(),
): Promise<{ data: TraceSummary[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(Math.max(1, params.pageSize ?? 30), 100);
  const { rows, total } = await source.listInboundMessages({ ...params, page, pageSize });

  const data: TraceSummary[] = [];
  for (const m of rows) {
    const [ruleExecs, agentTaskRows, reply] = await Promise.all([
      source.getRuleExecutions(m.id),
      source.getAgentTasks(m.id),
      source.getAssistantReply(m.id),
    ]);
    const agentTaskIds = agentTaskRows.map((t) => t.id);
    const toolCallRows = await source.getToolCalls(m.id, agentTaskIds);
    const toolCallIds = toolCallRows.map((t) => t.id);
    const zaloActionRows = await source.getZaloActions(toolCallIds, m.threadId);
    const outbound = await resolveOutbound(source, m, reply);

    data.push({
      messageId: m.id,
      threadId: m.threadId,
      threadType: m.threadType,
      senderName: m.senderName,
      role: m.role,
      contentPreviewRedacted: redactText(m.content).slice(0, PREVIEW_LEN),
      receivedAt: iso(m.receivedAt),
      ruleMatched: ruleExecs.some((r) => r.matched),
      agentTaskCount: agentTaskRows.length,
      toolCallCount: toolCallRows.length,
      zaloActionCount: zaloActionRows.length,
      outboundDecision: outbound.record?.decision ?? null,
      outboundDryRun: outbound.record?.dryRun ?? null,
      sentMessageId: outbound.record?.sentMessageId ?? null,
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { data, total, page, pageSize, totalPages };
}
