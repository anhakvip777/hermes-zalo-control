// =============================================================================
// ConversationContextService — load recent messages, build agent context
// =============================================================================

import { prisma } from "../db.js";
import { config } from "../config.js";

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  senderName?: string;
  messageType?: string;
  createdAt: Date;
}

export interface ConversationContext {
  threadId: string;
  threadType: string;
  recentMessages: ConversationMessage[];
  messageCount: number;
  hasMore: boolean;
}

const MAX_CONTEXT_MESSAGES = 200;
const DEFAULT_CONTEXT_MESSAGES = 100;

/**
 * Load recent conversation messages for a thread.
 * Returns messages sorted by time ascending (oldest first).
 */
export async function buildConversationContext(
  threadId: string,
  opts?: { maxMessages?: number },
): Promise<ConversationContext> {
  const limit = Math.min(
    opts?.maxMessages ?? DEFAULT_CONTEXT_MESSAGES,
    MAX_CONTEXT_MESSAGES,
  );

  // Get thread type from DB
  const thread = await prisma.zaloThread.findUnique({
    where: { id: threadId },
    select: { type: true },
  });

  // Load recent messages
  const messages = await prisma.message.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    take: limit + 1, // +1 to detect hasMore
    select: {
      content: true,
      role: true,
      senderName: true,
      messageType: true,
      createdAt: true,
    },
  });

  const hasMore = messages.length > limit;
  const recent = messages.slice(0, limit);

  // Convert to conversation format
  const conversationMessages: ConversationMessage[] = recent.map((m) => ({
    role: (m.role as "user" | "assistant" | "system") || "user",
    content: m.content,
    senderName: m.senderName ?? undefined,
    messageType: m.messageType ?? undefined,
    createdAt: m.createdAt,
  }));

  return {
    threadId,
    threadType: thread?.type ?? "user",
    recentMessages: conversationMessages,
    messageCount: conversationMessages.length,
    hasMore,
  };
}

/**
 * Build a prompt-ready context string for Hermes CLI.
 * Formats recent messages as a conversation transcript.
 */
export function buildContextString(ctx: ConversationContext): string {
  if (ctx.recentMessages.length === 0) return "";

  const lines: string[] = ["[LỊCH SỬ TRÒ CHUYỆN GẦN ĐÂY]"];

  for (const msg of ctx.recentMessages) {
    const roleLabel = msg.role === "assistant" ? "Bot" : (msg.senderName || "User");
    const prefix = msg.role === "assistant" ? "🤖" : "👤";
    // Skip image placeholder messages in context (they contain no useful text)
    const displayContent = msg.content === "[Ảnh Zalo]" ? "[đã gửi ảnh]" : msg.content;
    lines.push(`${prefix} ${roleLabel}: ${displayContent}`);
  }

  lines.push("[KẾT THÚC LỊCH SỬ — tin nhắn hiện tại bên dưới]");
  lines.push("");

  return lines.join("\n");
}

/**
 * Search for older messages by keyword.
 * Used when agent needs information beyond the recent context window.
 */
export async function searchConversationHistory(
  threadId: string,
  query: string,
  opts?: { limit?: number; beforeId?: string },
): Promise<ConversationMessage[]> {
  const limit = opts?.limit ?? 20;

  const messages = await prisma.message.findMany({
    where: {
      threadId,
      content: { contains: query },
      ...(opts?.beforeId ? { id: { lt: opts.beforeId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      content: true,
      role: true,
      senderName: true,
      messageType: true,
      createdAt: true,
    },
  });

  return messages.map((m) => ({
    role: (m.role as "user" | "assistant" | "system") || "user",
    content: m.content,
    senderName: m.senderName ?? undefined,
    messageType: m.messageType ?? undefined,
    createdAt: m.createdAt,
  }));
}

/**
 * Save an outbound (assistant) message to the conversation history.
 */
export async function saveOutboundMessage(opts: {
  threadId: string;
  threadType: string;
  content: string;
  relatedMessageId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.message.create({
      data: {
        threadId: opts.threadId,
        threadType: opts.threadType,
        content: opts.content,
        role: "assistant",
        isFromBot: true,
        messageType: "text",
        relatedMessageId: opts.relatedMessageId ?? null,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
        receivedAt: new Date(),
      },
    });
  } catch (err) {
    console.error(`[conversation] Failed to save outbound message: ${err instanceof Error ? err.message : String(err)}`);
    // Non-fatal
  }
}
