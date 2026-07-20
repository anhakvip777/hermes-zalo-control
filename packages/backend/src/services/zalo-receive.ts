// =============================================================================
// Zalo Receive — normalize, dedup, anti-loop, save incoming messages
// =============================================================================
// Batch 13: Added file/document message type detection for Zalo attachments.

import { prisma } from "../db.js";
import { normalizeThreadId } from "./thread-id.js";
import { upsertThreadProfileFromMessage, getThreadProfiles } from "./thread-profile.service.js";
import { redact } from "./tool-gateway/redaction.js";
import { normalizeInboundIdentity, type IdentityConfidence } from "./inbound-identity.js";
import { createHash } from "node:crypto";

export interface NormalizedMessage {
  zaloMessageId: string | null;
  /** Transient internal Message.id, attached after persistence; never from Zalo. */
  dbMessageId?: string;
  threadId: string;
  threadType: "user" | "group";
  threadName?: string;
  senderId: string;
  senderName?: string;
  content: string;
  messageType: string;
  isSelf?: boolean;
  isFromBot?: boolean;
  /** User IDs mentioned in the message (extracted from raw Zalo event). */
  mentions?: string[];
  /** Whether the bot was mentioned (checked against selfUserId at dispatch time). */
  isMentioned?: boolean;
  /** KI-H1: how confidently the (threadId, threadType, senderId) triad was resolved. */
  identityConfidence?: IdentityConfidence;
  /** KI-H1: raw fields the identity was derived from (for the trace). */
  identitySource?: string[];
  rawMetadata: string; // JSON stringified raw message for debugging
  /** Image attachment info (set when messageType=image). */
  imageUrl?: string;
  imageThumbnailUrl?: string;
  /** File/document attachment info (set when messageType=file). */
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  fileExtension?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Normalize incoming Zalo message
// ═══════════════════════════════════════════════════════════════════

/** Document file extensions we support for automated ingestion. */
const DOCUMENT_EXTENSIONS = new Set([
  "pdf", "docx", "pptx", "xlsx", "txt", "md", "csv", "html",
  "png", "jpg", "jpeg", "webp",
]);

export function normalizeMessage(raw: Record<string, unknown>): NormalizedMessage | null {
  if (!raw || typeof raw !== "object") return null;

  const data = (raw.data ?? raw) as Record<string, unknown>;

  // ── KI-H1: robust identity resolution (threadId/threadType/senderId) ──
  // Replaces the previous "threadId = raw.threadId ?? data.threadId, else drop"
  // logic, which silently dropped messages whose threadId arrived null but had a
  // groupId/to/sender fallback. We now derive with fallbacks + a confidence label.
  const identity = normalizeInboundIdentity(raw);
  const threadId = identity.threadId ? normalizeThreadId(identity.threadId) : "";

  const rawContent = data.content ?? data.msg ?? "";
  const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);

  // Still drop only when NO threadId could be resolved even with fallbacks.
  if (!threadId) return null;

  const msgType = String(data.type ?? data.msgType ?? raw.messageType ?? "").toLowerCase();
  const isPhoto = msgType.includes("photo") || msgType.includes("image");
  
  let imageUrl: string | undefined;
  let imageThumbnailUrl: string | undefined;
  
  if (isPhoto && typeof rawContent === "object" && rawContent !== null) {
    const c = rawContent as Record<string, unknown>;
    imageUrl = typeof c.href === "string" ? c.href : typeof c.url === "string" ? c.url : undefined;
    imageThumbnailUrl = typeof c.thumb === "string" ? c.thumb : typeof c.thumbnail === "string" ? c.thumbnail : undefined;
  } else if (typeof rawContent === "string" && rawContent.startsWith("http")) {
    // Fallback: content is a direct URL
    imageUrl = rawContent;
  }

  // Batch 13: Detect file/document attachments
  // Zalo may send files via:
  // - msgType: "chat.file" / "chat.document" / "chat.attachment"
  // - data.attach: { href, fileName, fileSize, ... }
  // - data.content: object with file info
  const isFile = msgType.includes("file") || msgType.includes("document") || msgType.includes("attach");
  let fileUrl: string | undefined;
  let fileName: string | undefined;
  let fileSize: number | undefined;
  let fileExtension: string | undefined;

  if (isFile) {
    // Try structured attachment data
    const attach = (data.attach ?? data.attachment ?? data.file) as Record<string, unknown> | undefined;
    if (attach) {
      fileUrl = typeof attach.href === "string" ? attach.href : typeof attach.url === "string" ? attach.url : undefined;
      fileName = typeof attach.fileName === "string" ? attach.fileName : typeof attach.name === "string" ? attach.name : undefined;
      fileSize = typeof attach.fileSize === "number" ? attach.fileSize : typeof attach.size === "number" ? attach.size : undefined;
    }
    // Try content as object (alternate format)
    if (!fileUrl && typeof rawContent === "object" && rawContent !== null) {
      const c = rawContent as Record<string, unknown>;
      fileUrl = typeof c.href === "string" ? c.href : typeof c.url === "string" ? c.url : undefined;
      fileName = typeof c.fileName === "string" ? c.fileName : typeof c.name === "string" ? c.name : undefined;
      fileSize = typeof c.fileSize === "number" ? c.fileSize : typeof c.size === "number" ? c.size : undefined;
    }
    // Try content as URL string (direct file link)
    if (!fileUrl && typeof rawContent === "string" && rawContent.startsWith("http")) {
      fileUrl = rawContent;
    }

    // Extract extension from filename
    if (fileName) {
      const dotIdx = fileName.lastIndexOf(".");
      if (dotIdx > 0) {
        fileExtension = fileName.slice(dotIdx + 1).toLowerCase();
      }
    }
  }

  // Determine the display type
  let detectedType: string;
  if (isPhoto && imageUrl) {
    detectedType = "image";
  } else if (isFile && fileUrl) {
    detectedType = "file";
  } else if (msgType.includes("photo") || msgType.includes("image")) {
    detectedType = "image";
  } else if (msgType.includes("file") || msgType.includes("document")) {
    detectedType = "file";
  } else {
    detectedType = String(data.type ?? raw.messageType ?? "text");
  }

  // Display content
  let displayContent: string;
  if (detectedType === "image") {
    displayContent = "[Ảnh Zalo]";
  } else if (detectedType === "file") {
    displayContent = fileName ? `[File: ${fileName}]` : "[File Zalo]";
  } else {
    displayContent = content;
  }

  // Storage threadType stays "user" | "group" (downstream fns are typed that way).
  // A genuinely "unknown" resolution is stored as "user" (lowest blast radius) but
  // carries identityConfidence="unknown" so the dispatcher never elevates it.
  const storedThreadType: "user" | "group" =
    identity.threadType === "group" ? "group" : "user";

  return {
    zaloMessageId: String(data.messageId ?? data.msgId ?? raw.msgId ?? raw.messageId ?? ""),
    threadId,
    threadType: storedThreadType,
    threadName: (data.threadName ?? data.groupName ?? raw.threadName ?? raw.groupName) as string | undefined,
    // KI-H1: senderId never derived from displayName; blank stays "" (falsy) so
    // the dispatcher's identity guard and principal fallback both handle it safely.
    senderId: identity.senderId ?? "",
    senderName: (identity.senderName ?? data.senderName ?? raw.senderName ?? data.fromName ?? raw.fromName) as string | undefined,
    content: displayContent,
    messageType: detectedType,
    isSelf: (raw.isSelf ?? data.isSelf) as boolean | undefined,
    isFromBot: (data.isFromBot ?? raw.isFromBot) as boolean | undefined,
    mentions: extractMentions(raw, data),
    identityConfidence: identity.identityConfidence,
    identitySource: identity.identitySource,
    rawMetadata: buildMetadataWithIdentity(raw, identity),
    imageUrl,
    imageThumbnailUrl,
    fileUrl,
    fileName,
    fileSize,
    fileExtension,
  };
}

/**
 * KI-H1: embed the resolved identity confidence into the sanitized metadata JSON.
 * Stored (and later redacted) with the Message so the Decision Trace can surface
 * identityConfidence/identitySource without a DB schema change. The enum labels
 * are non-secret and unaffected by redaction.
 */
function buildMetadataWithIdentity(
  raw: Record<string, unknown>,
  identity: ReturnType<typeof normalizeInboundIdentity>,
): string {
  try {
    const obj = JSON.parse(sanitizeMetadata(raw)) as Record<string, unknown>;
    obj._identity = {
      confidence: identity.identityConfidence,
      source: identity.identitySource,
      threadType: identity.threadType,
      hasSender: !!identity.senderId,
    };
    return JSON.stringify(obj);
  } catch {
    return sanitizeMetadata(raw);
  }
}

// M10: Handle numeric ThreadType enum values from zca-js v2
function resolveThreadType(rawType: unknown): "user" | "group" {
  if (rawType === undefined || rawType === null) return "group";
  if (typeof rawType === "number") return rawType === 0 ? "user" : "group";
  return String(rawType) === "User" ? "user" : "group";
}

/**
 * Extract mentioned user IDs from raw Zalo event.
 */
function extractMentions(
  raw: Record<string, unknown>,
  data: Record<string, unknown>,
): string[] | undefined {
  const mentionsRaw =
    data.mentions ?? raw.mentions ?? data.mentionList ?? raw.mentionList;

  if (!Array.isArray(mentionsRaw) || mentionsRaw.length === 0) return undefined;

  const ids: string[] = [];
  for (const m of mentionsRaw) {
    if (typeof m === "object" && m !== null) {
      const uid = (m as Record<string, unknown>).userId ?? (m as Record<string, unknown>).uid ?? (m as Record<string, unknown>).id;
      if (typeof uid === "string" && uid.length > 0) {
        ids.push(uid);
      }
    } else if (typeof m === "string") {
      ids.push(m);
    }
  }

  return ids.length > 0 ? ids : undefined;
}

// H9: Sanitize raw Zalo metadata
function sanitizeMetadata(raw: Record<string, unknown>): string {
  const safe: Record<string, unknown> = {};
  const ALLOWED_KEYS = new Set([
    "type", "threadId", "data", "isSelf",
    "msgId", "messageId", "msgType", "content", "msg",
    "senderId", "senderName", "fromId", "fromName",
    "threadName", "groupName", "timestamp", "ts",
    "quote", "mentions", "sticker", "attach",
  ]);
  for (const key of Object.keys(raw)) {
    if (ALLOWED_KEYS.has(key)) {
      const val = raw[key];
      if (key === "data" && typeof val === "object" && val !== null) {
        safe[key] = sanitizeDataField(val as Record<string, unknown>);
      } else {
        safe[key] = val;
      }
    }
  }
  safe._sanitized = true;
  return JSON.stringify(safe);
}

function sanitizeDataField(data: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  const ALLOWED = new Set([
    "content", "msg", "messageId", "msgId", "type", "msgType",
    "senderId", "senderName", "fromId", "fromName",
    "threadName", "groupName", "timestamp", "ts",
    "quote", "mentions", "sticker", "attach",
  ]);
  for (const key of Object.keys(data)) {
    if (ALLOWED.has(key)) {
      safe[key] = data[key];
    }
  }
  return safe;
}

// ═══════════════════════════════════════════════════════════════════
// Dedup and save incoming message
// ═══════════════════════════════════════════════════════════════════

export function dedupKey(msg: NormalizedMessage): string {
  if (msg.zaloMessageId) return `zmid:${msg.zaloMessageId}`;
  const hash = simpleHash(`${msg.threadId}|${msg.senderId}|${msg.content}`);
  return `fallback:${msg.threadId}:${msg.senderId}:${hash}`;
}

export const FALLBACK_DEDUP_WINDOW_MS = 60_000;

interface SaveIncomingMessageResult {
  saved: boolean;
  reason?: string;
  dbMessageId?: string;
}

interface RecentDedupEntry {
  dbMessageId: string;
  expiresAt: number;
}

const recentDedupEntries = new Map<string, RecentDedupEntry>();
const pendingDedupSaves = new Map<string, Promise<SaveIncomingMessageResult>>();
const DEDUP_MAX_SIZE = 10000;

export async function saveIncomingMessage(
  msg: NormalizedMessage,
  selfUserId: string | null,
): Promise<SaveIncomingMessageResult> {
  // Anti-loop: skip if from self
  if (selfUserId && msg.senderId === selfUserId) {
    return { saved: false, reason: "anti-loop: isSelf" };
  }

  const key = dedupKey(msg);
  const pending = pendingDedupSaves.get(key);
  if (pending) {
    const first = await pending;
    return {
      saved: false,
      reason: "dedup: concurrent duplicate",
      dbMessageId: first.dbMessageId,
    };
  }

  const operation = saveIncomingMessageUnlocked(msg, key);
  pendingDedupSaves.set(key, operation);
  try {
    return await operation;
  } finally {
    if (pendingDedupSaves.get(key) === operation) {
      pendingDedupSaves.delete(key);
    }
  }
}

async function saveIncomingMessageUnlocked(
  msg: NormalizedMessage,
  key: string,
): Promise<SaveIncomingMessageResult> {
  const recent = recentDedupEntries.get(key);
  const recentIsActive = !!recent && (
    !!msg.zaloMessageId || Date.now() <= recent.expiresAt
  );
  if (recent && recentIsActive) {
    const existing = msg.zaloMessageId
      ? await prisma.message.findUnique({
          where: { zaloMessageId: msg.zaloMessageId },
          select: { id: true },
        })
      : await prisma.message.findUnique({
          where: { id: recent.dbMessageId },
          select: { id: true },
        });
    if (existing) {
      return { saved: false, reason: "dedup: duplicate", dbMessageId: existing.id };
    }
  }
  if (recent) recentDedupEntries.delete(key);

  // Try dedup by DB zaloMessageId if present
  if (msg.zaloMessageId) {
    const existing = await prisma.message.findUnique({
      where: { zaloMessageId: msg.zaloMessageId },
      select: { id: true },
    });
    if (existing) {
      return {
        saved: false,
        reason: "dedup: existing zaloMessageId in DB",
        dbMessageId: existing.id,
      };
    }
  }

  // Prune in-memory dedup set
  if (recentDedupEntries.size > DEDUP_MAX_SIZE) {
    for (const k of recentDedupEntries.keys()) {
      recentDedupEntries.delete(k);
      if (recentDedupEntries.size <= DEDUP_MAX_SIZE / 2) break;
    }
  }

  // Save message
  const messageIdForDb = msg.zaloMessageId || null;

  // ── KI-B4: redact secrets BEFORE persistence ──────────────────────
  // Users demonstrably paste API keys / passwords into DMs (legacy raw-inbound
  // captured sk-… keys in cleartext). Redact content + raw metadata so no
  // user-sent secret is ever written to the DB / trace / memory. Runtime
  // parsing still uses the in-memory `msg` (transient), so this does not affect
  // reminder/mention detection. Redaction is idempotent and pure.
  const safeContent =
    typeof msg.content === "string" ? (redact(msg.content) as string) : msg.content;
  const safeMetadata =
    typeof msg.rawMetadata === "string" ? (redact(msg.rawMetadata) as string) : msg.rawMetadata;

  const createData = {
    zaloMessageId: messageIdForDb,
    threadId: msg.threadId,
    threadType: msg.threadType,
    senderId: msg.senderId || null,
    senderName: msg.senderName || null,
    content: safeContent,
    isFromBot: false,
    messageType: msg.messageType,
    role: "user",
    metadata: safeMetadata,
    receivedAt: new Date(),
  };
  const savedMessage = messageIdForDb
    ? await prisma.message.upsert({
        where: { zaloMessageId: messageIdForDb },
        update: {},
        create: createData,
        select: { id: true },
      })
    : await prisma.message.create({
        data: createData,
        select: { id: true },
      });

  recentDedupEntries.set(key, {
    dbMessageId: savedMessage.id,
    expiresAt: messageIdForDb
      ? Number.POSITIVE_INFINITY
      : Date.now() + FALLBACK_DEDUP_WINDOW_MS,
  });

  // ── Phase 3.5A: index inbound media as an Attachment (pending extraction) ──
  // Non-blocking: media indexing failure must never affect message processing.
  try {
    const { deriveAttachmentKind, saveInboundAttachment } = await import("./attachment.service.js");
    const kind = deriveAttachmentKind(msg.messageType);
    if (kind) {
      const sourceUrl = kind === "image" ? (msg.imageUrl ?? null) : kind === "file" ? (msg.fileUrl ?? null) : null;
      await saveInboundAttachment({
        messageId: savedMessage.id,
        zaloMessageId: messageIdForDb,
        threadId: msg.threadId,
        threadType: msg.threadType,
        senderId: msg.senderId || null,
        kind,
        fileName: msg.fileName ?? null,
        sizeBytes: typeof msg.fileSize === "number" ? msg.fileSize : null,
        sourceUrl,
      });
    }
  } catch (err: unknown) {
    console.error(`[zalo-receive] attachment index failed: ${(err as Error).message}`);
  }

  // Upsert ThreadProfile from inbound message (Batch T1)
  // Non-blocking: failure here must not affect message processing.
  upsertThreadProfileFromMessage({
    threadId: msg.threadId,
    threadType: msg.threadType,
    senderName: msg.senderName,
    threadName: msg.threadName,
  }).catch(() => {});

  // Upsert thread
  await prisma.zaloThread.upsert({
    where: { id: msg.threadId },
    update: {
      name: msg.threadName || undefined,
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    },
    create: {
      id: msg.threadId,
      type: msg.threadType,
      name: msg.threadName || null,
      lastMessageAt: new Date(),
    },
  });

  return { saved: true, dbMessageId: savedMessage.id };
}

// ═══════════════════════════════════════════════════════════════════
// Query saved threads
// ═══════════════════════════════════════════════════════════════════

export async function listThreads(opts: { type?: string; page?: number; pageSize?: number }) {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 50;
  const where: Record<string, unknown> = {};
  if (opts.type) where.type = opts.type;

  const [data, total] = await Promise.all([
    prisma.zaloThread.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.zaloThread.count({ where }),
  ]);

  return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

// ═══════════════════════════════════════════════════════════════════
// Query saved messages
// ═══════════════════════════════════════════════════════════════════

export async function listMessages(opts: {
  threadId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 50;
  const where: Record<string, unknown> = {};
  if (opts.threadId) where.threadId = opts.threadId;
  if (opts.search) {
    where.content = { contains: opts.search };
  }

  const [data, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.message.count({ where }),
  ]);

  // Enrich with ThreadProfile display names (Batch T1)
  const threadIds = Array.from(new Set(data.map((m) => m.threadId).filter(Boolean)));
  const profiles = await getThreadProfiles(threadIds as string[]);

  // U1: Enrich with OutboundRecord status
  // Match by content hash (same algorithm as outbound-guardrails.service.ts)
  const outboundRecords = await prisma.outboundRecord.findMany({
    where: { threadId: { in: threadIds.length > 0 ? (threadIds as string[]) : undefined } },
    orderBy: { createdAt: "desc" },
    take: 200, // enough for current page + buffer
  });

  // Build hash → record map for O(1) lookup
  const outboundByHash = new Map<string, Array<(typeof outboundRecords)[number]>>();
  for (const rec of outboundRecords) {
    const matches = outboundByHash.get(rec.contentHash) ?? [];
    matches.push(rec);
    outboundByHash.set(rec.contentHash, matches);
  }

  // Fallback: match by threadId + closest timestamp (within 10s)
  function findOutboundFallback(threadId: string, messageTime: Date) {
    const candidates = outboundRecords.filter(
      (r) => r.threadId === threadId && Math.abs(r.createdAt.getTime() - messageTime.getTime()) < 10_000,
    );
    if (candidates.length === 0) return null;
    // Pick the closest only when there is a unique nearest record. A tie is
    // ambiguous evidence and must remain UNKNOWN rather than choosing one.
    candidates.sort(
      (a, b) =>
        Math.abs(a.createdAt.getTime() - messageTime.getTime()) -
        Math.abs(b.createdAt.getTime() - messageTime.getTime()),
    );
    const nearestDistance = Math.abs(candidates[0]!.createdAt.getTime() - messageTime.getTime());
    const nearest = candidates.filter(
      (candidate) => Math.abs(candidate.createdAt.getTime() - messageTime.getTime()) === nearestDistance,
    );
    return nearest.length === 1 ? nearest[0]! : null;
  }

  const enriched = data.map((m) => {
    const profile = profiles.get(m.threadId);

    // Only enrich assistant messages (bot replies)
    let outbound = null;
    if (m.role === "assistant" && m.content) {
      const hash = createHash("sha256")
        .update(`${m.threadId}:${m.content}`)
        .digest("hex");
      const hashMatches = outboundByHash.get(hash);
      const matched = hashMatches && hashMatches.length > 1
        ? null
        : hashMatches?.[0] ?? findOutboundFallback(m.threadId, m.receivedAt);
      if (matched) {
        outbound = {
          id: matched.id,
          decision: matched.decision,
          reason: matched.reason,
          dryRun: matched.dryRun,
          sentMessageId: matched.sentMessageId,
          errorCode: matched.errorCode,
          source: matched.source,
          createdAt: matched.createdAt.toISOString(),
        };
      }
    }

    return {
      ...m,
      thread: profile
        ? {
            id: m.threadId,
            displayName: profile.displayName,
            type: profile.threadType,
            avatarUrl: profile.avatarUrl,
          }
        : { id: m.threadId, displayName: null, type: m.threadType, avatarUrl: null },
      outbound,
    };
  });

  return { data: enriched, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

// ═══════════════════════════════════════════════════════════════════
// Simple hash for dedup fallback
// ═══════════════════════════════════════════════════════════════════

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    hash = (hash << 5) - hash + ch;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}
