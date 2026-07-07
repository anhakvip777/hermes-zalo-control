// =============================================================================
// Memory tools — injectable dependencies (Phase 4)
// =============================================================================
// DB-free testable. Defaults use Prisma / runtime-config / principal service /
// ZaloProvider. Tools return WHITELISTED fields only — never raw metadata,
// AgentTask.input/result, or session/token/cookie.
// =============================================================================

export interface MemoryMessage {
  id: string;
  threadId: string;
  role: string;
  senderId: string | null;
  content: string;
  messageType: string | null;
  createdAt: string;
  /** Phase 3.5A: set when this result came from an indexed attachment. */
  attachmentId?: string | null;
  /** Phase 3.5A: attachment extraction status (image/file OCR/vision). */
  extractionStatus?: string | null;
  /** Phase 3.5A: "message" | "attachment". */
  source?: string;
}

export interface AttachmentSearch {
  threadId?: string;
  threadType?: "user" | "group";
  query?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit: number;
}

export interface MemoryOutbound {
  threadId: string;
  content: string;
  source: string;
  dryRun: boolean;
  decision: string;
  reason: string;
  sentMessageId: string | null;
  createdAt: string;
}

export interface MemoryAgentTask {
  id: string;
  agentName: string;
  taskType: string;
  status: string;
  messageId: string | null;
  scheduleId: string | null;
  createdAt: string;
}

export interface MemoryRuleExecution {
  ruleId: string | null;
  matched: boolean;
  actionTaken: string | null;
  result: string | null;
  errorCode: string | null;
  createdAt: string;
}

export interface MemoryRoleInfo {
  principalId: string;
  role: string;
  status: string;
  fromDb: boolean;
}

export interface MemoryRuntimeStatus {
  dryRun: boolean;
  cooldownSeconds: number;
  batchingEnabled: boolean;
  zalo: { connected: boolean; listenerActive?: boolean };
}

export interface MessageQuery {
  threadId?: string; // undefined = global (admin only, enforced by caller)
  threadType?: "user" | "group";
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit: number;
  /**
   * Exclude one message (by Zalo message id) from results. Used so a retrieval
   * query never matches the querying user's own just-persisted request message
   * as evidence for itself.
   */
  excludeZaloMessageId?: string | null;
}

export interface MemoryDeps {
  getMessages?: (q: MessageQuery) => Promise<MemoryMessage[]>;
  searchAttachments?: (q: AttachmentSearch) => Promise<MemoryMessage[]>;
  getOutboundRecords?: (q: { threadId?: string; limit: number }) => Promise<MemoryOutbound[]>;
  getAgentTasks?: (q: { limit: number; status?: string }) => Promise<MemoryAgentTask[]>;
  getRuleExecutions?: (q: { threadId?: string; messageId?: string; limit: number }) => Promise<MemoryRuleExecution[]>;
  getUserRole?: (principalId: string, threadId?: string) => Promise<MemoryRoleInfo>;
  getRuntimeStatus?: () => Promise<MemoryRuntimeStatus>;
}

const isoOrEmpty = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d ?? ""));

// ── Default Prisma-backed readers ────────────────────────────────────

export async function defaultGetMessages(q: MessageQuery): Promise<MemoryMessage[]> {
  const { prisma } = await import("../../../db.js");
  const where: Record<string, unknown> = {};
  if (q.threadId) where.threadId = q.threadId;
  if (q.threadType) where.threadType = q.threadType;
  if (q.search) where.content = { contains: q.search };
  if (q.excludeZaloMessageId) where.zaloMessageId = { not: q.excludeZaloMessageId };
  if (q.dateFrom || q.dateTo) {
    where.createdAt = {
      ...(q.dateFrom ? { gte: q.dateFrom } : {}),
      ...(q.dateTo ? { lte: q.dateTo } : {}),
    };
  }
  const rows = await (prisma as any).message.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: q.limit,
    select: { id: true, threadId: true, role: true, senderId: true, content: true, messageType: true, createdAt: true },
  });
  return rows.map((r: any) => ({
    id: r.id,
    threadId: r.threadId,
    role: r.role,
    senderId: r.senderId ?? null,
    content: String(r.content ?? "").slice(0, 2000),
    messageType: r.messageType ?? null,
    createdAt: isoOrEmpty(r.createdAt),
    source: "message",
  }));
}

// Phase 3.5A: search indexed attachments by extracted (OCR/vision) text.
export async function defaultSearchAttachments(q: AttachmentSearch): Promise<MemoryMessage[]> {
  const { searchAttachments } = await import("../../attachment.service.js");
  const rows = await searchAttachments({
    threadId: q.threadId,
    threadType: q.threadType,
    query: q.query,
    dateFrom: q.dateFrom,
    dateTo: q.dateTo,
    limit: q.limit,
  });
  return rows.map((r) => ({
    id: r.messageId,
    threadId: r.threadId,
    role: "user",
    senderId: null,
    content: r.snippet,
    messageType: r.kind,
    createdAt: r.createdAt,
    attachmentId: r.attachmentId,
    extractionStatus: r.extractionStatus,
    source: "attachment",
  }));
}

export async function defaultGetOutboundRecords(q: { threadId?: string; limit: number }): Promise<MemoryOutbound[]> {
  const { prisma } = await import("../../../db.js");
  const where: Record<string, unknown> = {};
  if (q.threadId) where.threadId = q.threadId;
  const rows = await (prisma as any).outboundRecord.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: q.limit,
    select: { threadId: true, content: true, source: true, dryRun: true, decision: true, reason: true, sentMessageId: true, createdAt: true },
  });
  return rows.map((r: any) => ({
    threadId: r.threadId,
    content: String(r.content ?? "").slice(0, 2000),
    source: r.source,
    dryRun: !!r.dryRun,
    decision: r.decision,
    reason: r.reason,
    sentMessageId: r.sentMessageId ?? null,
    createdAt: isoOrEmpty(r.createdAt),
  }));
}

export async function defaultGetAgentTasks(q: { limit: number; status?: string }): Promise<MemoryAgentTask[]> {
  const { prisma } = await import("../../../db.js");
  const where: Record<string, unknown> = {};
  if (q.status) where.status = q.status;
  const rows = await (prisma as any).agentTask.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: q.limit,
    // WHITELIST — never select input/result (content-bearing JSON).
    select: { id: true, agentName: true, taskType: true, status: true, messageId: true, scheduleId: true, createdAt: true },
  });
  return rows.map((r: any) => ({
    id: r.id,
    agentName: r.agentName,
    taskType: r.taskType,
    status: r.status,
    messageId: r.messageId ?? null,
    scheduleId: r.scheduleId ?? null,
    createdAt: isoOrEmpty(r.createdAt),
  }));
}

export async function defaultGetRuleExecutions(q: {
  threadId?: string;
  messageId?: string;
  limit: number;
}): Promise<MemoryRuleExecution[]> {
  const { prisma } = await import("../../../db.js");
  const where: Record<string, unknown> = {};
  if (q.threadId) where.threadId = q.threadId;
  if (q.messageId) where.messageId = q.messageId;
  const rows = await (prisma as any).ruleExecution.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: q.limit,
    // WHITELIST — never select metadata (content-bearing JSON).
    select: { ruleId: true, matched: true, actionTaken: true, result: true, errorCode: true, createdAt: true },
  });
  return rows.map((r: any) => ({
    ruleId: r.ruleId ?? null,
    matched: !!r.matched,
    actionTaken: r.actionTaken ?? null,
    result: r.result ? String(r.result).slice(0, 500) : null,
    errorCode: r.errorCode ?? null,
    createdAt: isoOrEmpty(r.createdAt),
  }));
}

export async function defaultGetUserRole(principalId: string, threadId?: string): Promise<MemoryRoleInfo> {
  const { resolvePrincipal } = await import("../../principal.service.js");
  const ctx = await resolvePrincipal(principalId, threadId ?? null);
  return { principalId, role: ctx.role, status: ctx.status, fromDb: ctx.fromDb };
}

export async function defaultGetRuntimeStatus(): Promise<MemoryRuntimeStatus> {
  const rc = await import("../../runtime-config.service.js");
  const dryRun = rc.getCurrentEffectiveDryRun();
  let cooldownSeconds = 0;
  let batchingEnabled = false;
  try {
    cooldownSeconds = rc.getEffectiveCooldownSeconds();
  } catch { /* non-fatal */ }
  try {
    const b = rc.getEffectiveBatchingConfig();
    batchingEnabled = !!(b as any)?.enabled;
  } catch { /* non-fatal */ }

  let zalo = { connected: false } as { connected: boolean; listenerActive?: boolean };
  try {
    const { getZaloProvider } = await import("../../zalo-provider/zca-js-provider.js");
    const s = getZaloProvider().getRuntimeStatus();
    zalo = { connected: s.connected, listenerActive: s.listenerActive };
  } catch { /* non-fatal */ }

  return { dryRun, cooldownSeconds, batchingEnabled, zalo };
}

export function resolveMemoryDeps(deps: MemoryDeps): Required<MemoryDeps> {
  return {
    getMessages: deps.getMessages ?? defaultGetMessages,
    searchAttachments: deps.searchAttachments ?? defaultSearchAttachments,
    getOutboundRecords: deps.getOutboundRecords ?? defaultGetOutboundRecords,
    getAgentTasks: deps.getAgentTasks ?? defaultGetAgentTasks,
    getRuleExecutions: deps.getRuleExecutions ?? defaultGetRuleExecutions,
    getUserRole: deps.getUserRole ?? defaultGetUserRole,
    getRuntimeStatus: deps.getRuntimeStatus ?? defaultGetRuntimeStatus,
  };
}
