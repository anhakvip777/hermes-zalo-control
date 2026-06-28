// =============================================================================
// Zalo Receive — normalize, dedup, anti-loop, save incoming messages
// =============================================================================

import { prisma } from "../db.js";

export interface NormalizedMessage {
  zaloMessageId: string | null;
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
  rawMetadata: string; // JSON stringified raw message for debugging
  /** Image attachment info (set when messageType=image). */
  imageUrl?: string;
  imageThumbnailUrl?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Normalize incoming Zalo message
// ═══════════════════════════════════════════════════════════════════

export function normalizeMessage(raw: Record<string, unknown>): NormalizedMessage | null {
  // zca-js v2 message shape:
  // { type: ThreadType, threadId: string, data: { content, ... }, isSelf: boolean }
  if (!raw || typeof raw !== "object") return null;

  const data = (raw.data ?? raw) as Record<string, unknown>;
  const threadId = String(raw.threadId ?? data.threadId ?? "");
  const rawContent = data.content ?? data.msg ?? "";
  const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);

  if (!threadId) return null;

  // Extract image attachment info for image messages
  // Zalo sends photo messages with:
  //   data.type = "chat.photo" (or msgType = "chat.photo")
  //   data.content = { title, description, href: "https://...", thumb: "https://..." }
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

  // Detect image messages by content URL pattern or attachment  
  const detectedType = isPhoto && imageUrl ? "image" : msgType.includes("photo") || msgType.includes("image") ? "image" : String(data.type ?? raw.messageType ?? "text");
  // For image messages, use a placeholder instead of the URL as content
  const displayContent = detectedType === "image" ? "[Ảnh Zalo]" : content;

  return {
    zaloMessageId: String(data.messageId ?? data.msgId ?? raw.msgId ?? raw.messageId ?? ""),
    threadId,
    threadType: resolveThreadType(raw.type ?? raw.threadType),
    threadName: (data.threadName ?? data.groupName ?? raw.threadName ?? raw.groupName) as string | undefined,
    senderId: String(data.senderId ?? raw.senderId ?? data.fromId ?? raw.fromId ?? ""),
    senderName: (data.senderName ?? raw.senderName ?? data.fromName ?? raw.fromName) as string | undefined,
    content: displayContent,
    messageType: detectedType,
    isSelf: raw.isSelf === true || raw.isSelf === "true" || data.isSelf === true || data.isSelf === "true",
    isFromBot: raw.isFromBot === true || raw.isFromBot === "true" || data.isFromBot === true || data.isFromBot === "true",
    mentions: extractMentions(raw, data),
    rawMetadata: sanitizeMetadata(raw),
    imageUrl,
    imageThumbnailUrl,
  };
}

// M10: Handle numeric ThreadType enum values from zca-js v2
// ThreadType: { '0': 'User', '1': 'Group', User: 0, Group: 1 }
function resolveThreadType(rawType: unknown): "user" | "group" {
  if (rawType === undefined || rawType === null) return "group";
  if (typeof rawType === "number") return rawType === 0 ? "user" : "group";
  return String(rawType) === "User" ? "user" : "group";
}

/**
 * Extract mentioned user IDs from raw Zalo event.
 * zca-js v2 provides mentions as an array of { userId, displayName, ... } objects.
 * Returns an array of userId strings, or undefined if no mentions found.
 */
function extractMentions(
  raw: Record<string, unknown>,
  data: Record<string, unknown>,
): string[] | undefined {
  // Check multiple possible locations for mentions data
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

// H9: Sanitize raw Zalo metadata — strip potentially sensitive fields
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
// Generate dedup key (fallback when zaloMessageId is missing)
// ═══════════════════════════════════════════════════════════════════

export function dedupKey(msg: NormalizedMessage): string {
  if (msg.zaloMessageId) return `zmid:${msg.zaloMessageId}`;
  // Fallback: content hash + sender + thread + timestamp approximate
  const hash = simpleHash(`${msg.threadId}|${msg.senderId}|${msg.content}`);
  return `fallback:${msg.threadId}:${msg.senderId}:${hash}`;
}

// ═══════════════════════════════════════════════════════════════════
// Dedup and save incoming message
// ═══════════════════════════════════════════════════════════════════

const recentDedupKeys = new Set<string>();
const DEDUP_MAX_SIZE = 10000;

export async function saveIncomingMessage(
  msg: NormalizedMessage,
  selfUserId: string | null,
): Promise<{ saved: boolean; reason?: string }> {
  // Anti-loop: skip if from self
  if (selfUserId && msg.senderId === selfUserId) {
    return { saved: false, reason: "anti-loop: isSelf" };
  }

  // Dedup check
  const key = dedupKey(msg);
  if (recentDedupKeys.has(key)) {
    return { saved: false, reason: "dedup: duplicate" };
  }

  // Try dedup by DB zaloMessageId if present
  if (msg.zaloMessageId) {
    const existing = await prisma.message.findUnique({
      where: { zaloMessageId: msg.zaloMessageId },
      select: { id: true },
    });
    if (existing) {
      recentDedupKeys.add(key);
      return { saved: false, reason: "dedup: existing zaloMessageId in DB" };
    }
  }

  // Prune in-memory dedup set
  if (recentDedupKeys.size > DEDUP_MAX_SIZE) {
    for (const k of recentDedupKeys) {
      recentDedupKeys.delete(k);
      if (recentDedupKeys.size <= DEDUP_MAX_SIZE / 2) break;
    }
  }
  recentDedupKeys.add(key);

  // Save message
  const messageIdForDb = msg.zaloMessageId || null;

  await prisma.message.upsert({
    where: messageIdForDb ? { zaloMessageId: messageIdForDb } : { id: `dedup-${key}` },
    update: {},
    create: {
      zaloMessageId: messageIdForDb,
      threadId: msg.threadId,
      threadType: msg.threadType,
      senderId: msg.senderId || null,
      senderName: msg.senderName || null,
      content: msg.content,
      isFromBot: false,
      messageType: msg.messageType,
      role: "user",
      metadata: msg.rawMetadata,
      receivedAt: new Date(),
    },
  });

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

  return { saved: true };
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

  return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
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
