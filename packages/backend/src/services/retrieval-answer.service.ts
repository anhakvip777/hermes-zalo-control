// =============================================================================
// Retrieval Answer service — Phase 3.5B-A (service-only, no runtime wiring)
// =============================================================================
// Turns a scoped memory + attachment (OCR) search into an EVIDENCE-BACKED answer.
//
// Example: "gửi tôi thực đơn của cửa hàng B trong group A" → search the allowed
// thread's indexed attachments/messages → return { status, answerText, evidence }.
//
// HARD RULES (enforced here):
//   - Scope via resolveThreadScope: a non-admin can only read its own thread; a
//     cross-thread request → status "permission_denied" and NO search runs.
//   - No cross-thread leak; threadType always carried (no user/group id collision).
//   - Redact answerText + every snippet again (defensive) before returning.
//   - Never fabricate: OCR unavailable/pending/failed → say "found but unreadable";
//     zero matches → "not_found"; infra error → "unavailable".
//   - NO provider AI, NO sendOutbound, NO original-image resend, NO live.
// =============================================================================

import { redact } from "./tool-gateway/redaction.js";
import { resolveThreadScope } from "./tools/memory/scope.js";
import type { ToolRole } from "./tool-gateway/types.js";
import type { AttachmentSearchQuery, AttachmentSearchResult } from "./attachment.service.js";
import type { MessageQuery, MemoryMessage } from "./tools/memory/deps.js";

// ── Types ────────────────────────────────────────────────────────────

export interface RetrievalAnswerInput {
  query: string;
  requesterThreadId: string;
  requesterThreadType: "user" | "group";
  targetThreadId?: string;
  targetThreadType?: "user" | "group";
  dateFrom?: string;
  dateTo?: string;
  includeAttachments?: boolean;
  role: string;
}

export interface RetrievalEvidence {
  messageId: string;
  attachmentId?: string;
  createdAt: string;
  threadId: string;
  threadType: string;
  source: "message" | "attachment";
  kind?: string;
  extractionStatus?: string;
  snippetRedacted?: string;
  confidence?: number | string;
}

export interface RetrievalAnswerResult {
  status: "found" | "not_found" | "permission_denied" | "unavailable";
  answerText: string;
  evidence: RetrievalEvidence[];
  confidence: "high" | "medium" | "low";
}

export interface RetrievalAnswerDeps {
  searchAttachments?: (q: AttachmentSearchQuery) => Promise<AttachmentSearchResult[]>;
  getMessages?: (q: MessageQuery) => Promise<MemoryMessage[]>;
}

export interface ParsedRetrievalQuery {
  isRetrieval: boolean;
  keywords: string[];
  dateFrom?: string;
  dateTo?: string;
  targetThreadHint?: string;
}

// ── Constants ────────────────────────────────────────────────────────

const MAX_EVIDENCE = 3;
const SEARCH_LIMIT = 10;

// Vietnamese retrieval-intent cues (verbs + nouns). Lowercased match.
const INTENT_CUES = [
  "tìm", "lục lại", "lục", "gửi tôi", "gửi mình", "cho tôi xem", "cho mình xem",
  "tra cứu", "tìm kiếm", "thực đơn", "menu", "cửa hàng", "quán",
];

const STOPWORDS = new Set([
  "tôi", "mình", "cho", "gửi", "của", "trong", "là", "và", "cái", "the", "a",
  "xem", "lại", "hãy", "giúp", "với", "ở", "tại", "về",
]);

function redactText(v: string): string {
  return redact(v ?? "") as string;
}

// ── Parser ───────────────────────────────────────────────────────────

/**
 * Parse a Vietnamese retrieval query. Deterministic, no NLP.
 * NEVER uses a display name for permission — targetThreadHint is advisory only.
 */
export function parseRetrievalQuery(text: string): ParsedRetrievalQuery {
  const raw = String(text ?? "");
  const lower = raw.toLowerCase().normalize("NFC");

  const isRetrieval = INTENT_CUES.some((c) => lower.includes(c));

  // Keywords: meaningful tokens (len > 1, not a stopword, not a pure intent verb).
  const tokens = lower
    .replace(/[.,!?;:()"']/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  const keywords = Array.from(new Set(tokens));

  // Optional date: "ngày 10/5" or "10/5/2026" → single-day range.
  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  const dm = lower.match(/(?:ng[aà]y\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
  if (dm && dm[1] && dm[2]) {
    const day = parseInt(dm[1], 10);
    const month = parseInt(dm[2], 10);
    let year = dm[3] ? parseInt(dm[3], 10) : new Date().getFullYear();
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const from = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
      const to = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
      if (!isNaN(from.getTime())) {
        dateFrom = from.toISOString();
        dateTo = to.toISOString();
      }
    }
  }

  // Advisory group hint: word(s) after "group"/"nhóm" (NOT used for permission).
  let targetThreadHint: string | undefined;
  const gh = lower.match(/(?:group|nh[oó]m)\s+([a-z0-9._-]+)/);
  if (gh) targetThreadHint = gh[1];

  return { isRetrieval, keywords, dateFrom, dateTo, targetThreadHint };
}

// ── Default deps (lazy Prisma-backed) ────────────────────────────────

async function defaultSearchAttachmentsImpl(q: AttachmentSearchQuery): Promise<AttachmentSearchResult[]> {
  const { searchAttachments } = await import("./attachment.service.js");
  return searchAttachments(q);
}

async function defaultGetMessagesImpl(q: MessageQuery): Promise<MemoryMessage[]> {
  const { defaultGetMessages } = await import("./tools/memory/deps.js");
  return defaultGetMessages(q);
}

// ── Helpers ──────────────────────────────────────────────────────────

function toDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

function isReadable(a: AttachmentSearchResult): boolean {
  return a.extractionStatus === "success" && !!(a.snippet && a.snippet.trim());
}

function isPermissionError(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "blocked";
}

// ── Main ─────────────────────────────────────────────────────────────

export async function answerRetrieval(
  input: RetrievalAnswerInput,
  deps: RetrievalAnswerDeps = {},
): Promise<RetrievalAnswerResult> {
  const searchAttachmentsFn = deps.searchAttachments ?? defaultSearchAttachmentsImpl;
  const getMessagesFn = deps.getMessages ?? defaultGetMessagesImpl;

  // 1) Scope / permission — a cross-thread request never runs a search.
  let scopeThreadId: string | undefined;
  try {
    const scope = resolveThreadScope(
      input.role as ToolRole,
      input.requesterThreadId,
      input.targetThreadId,
    );
    scopeThreadId = scope.threadId; // undefined = admin global
  } catch (err: unknown) {
    if (isPermissionError(err)) {
      return {
        status: "permission_denied",
        answerText: "Mình không có quyền tìm trong thread/group đó.",
        evidence: [],
        confidence: "low",
      };
    }
    return {
      status: "unavailable",
      answerText: "Hiện chưa tìm được do lỗi hệ thống. Bạn thử lại sau nhé.",
      evidence: [],
      confidence: "low",
    };
  }

  // Effective threadType: use target's when it matches the scoped thread, else requester's.
  const effectiveThreadType =
    input.targetThreadId && input.targetThreadId === scopeThreadId
      ? input.targetThreadType
      : scopeThreadId === input.requesterThreadId
        ? input.requesterThreadType
        : input.targetThreadType ?? input.requesterThreadType;

  const dateFrom = toDate(input.dateFrom);
  const dateTo = toDate(input.dateTo);
  const includeAttachments = input.includeAttachments !== false; // default true

  // 2) Search (infra failure → unavailable).
  let attachments: AttachmentSearchResult[] = [];
  let messages: MemoryMessage[] = [];
  try {
    if (includeAttachments) {
      attachments = await searchAttachmentsFn({
        threadId: scopeThreadId,
        threadType: effectiveThreadType,
        query: input.query,
        dateFrom,
        dateTo,
        limit: SEARCH_LIMIT,
      });
    }
    messages = await getMessagesFn({
      threadId: scopeThreadId,
      threadType: effectiveThreadType,
      search: input.query,
      dateFrom,
      dateTo,
      limit: SEARCH_LIMIT,
    });
  } catch {
    return {
      status: "unavailable",
      answerText: "Hiện chưa tìm được do lỗi hệ thống. Bạn thử lại sau nhé.",
      evidence: [],
      confidence: "low",
    };
  }

  // 3) Build + prioritize evidence: readable attachment > unreadable attachment >
  //    message; newest first within each tier. Cap to top 3.
  const attachEvidence: RetrievalEvidence[] = attachments.map((a) => ({
    messageId: a.messageId,
    attachmentId: a.attachmentId,
    createdAt: a.createdAt,
    threadId: a.threadId,
    threadType: a.threadType,
    source: "attachment",
    kind: a.kind,
    extractionStatus: a.extractionStatus,
    snippetRedacted: a.snippet ? redactText(a.snippet).slice(0, 500) : "",
    confidence: a.confidence ?? undefined,
  }));
  const msgEvidence: RetrievalEvidence[] = messages
    // Avoid duplicating a message already represented by an attachment.
    .filter((m) => !attachEvidence.some((a) => a.messageId === m.id))
    .map((m) => ({
      messageId: m.id,
      createdAt: m.createdAt,
      threadId: m.threadId,
      threadType: String(effectiveThreadType ?? ""),
      source: "message" as const,
      kind: m.messageType ?? undefined,
      snippetRedacted: redactText(m.content ?? "").slice(0, 500),
    }));

  const tier = (e: RetrievalEvidence): number => {
    if (e.source === "attachment" && e.extractionStatus === "success" && e.snippetRedacted) return 0;
    if (e.source === "attachment") return 1;
    return 2;
  };
  const ranked = [...attachEvidence, ...msgEvidence].sort((a, b) => {
    const t = tier(a) - tier(b);
    if (t !== 0) return t;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); // newest first
  });
  const evidence = ranked.slice(0, MAX_EVIDENCE);

  // 4) Compose status + answerText (redacted, no fabrication).
  if (evidence.length === 0) {
    return {
      status: "not_found",
      answerText: "Mình chưa tìm thấy thông tin phù hợp trong phạm vi được phép.",
      evidence: [],
      confidence: "low",
    };
  }

  // NOTE: compose from already-redacted pieces (snippet is redacted; the date is
  // service-generated and safe). Do NOT re-run redact() over the whole answerText,
  // or an ISO date (8 digits + dashes) would be masked as a phone number.
  const readable = attachments.filter(isReadable);
  const topReadable = readable[0];
  if (topReadable) {
    const snippet = redactText(topReadable.snippet).slice(0, 400);
    const when = topReadable.createdAt ? topReadable.createdAt.slice(0, 10) : "";
    const answerText = `Mình tìm thấy thông tin liên quan (gửi ngày ${when}):\n${snippet}`;
    return { status: "found", answerText, evidence, confidence: "high" };
  }

  const topAttach = attachEvidence[0];
  if (topAttach) {
    // Found the attachment(s) but couldn't read the content — do NOT invent it.
    const when = topAttach.createdAt ? topAttach.createdAt.slice(0, 10) : "";
    const answerText = `Mình tìm thấy ảnh/tệp liên quan (gửi ngày ${when}) nhưng chưa đọc được nội dung.`;
    return { status: "found", answerText, evidence, confidence: "low" };
  }

  // Only text-message matches.
  const topMsg = evidence[0]!;
  const when = topMsg.createdAt ? topMsg.createdAt.slice(0, 10) : "";
  const answerText = `Mình tìm thấy tin nhắn liên quan (ngày ${when}):\n${topMsg.snippetRedacted ?? ""}`;
  return { status: "found", answerText, evidence, confidence: "medium" };
}
