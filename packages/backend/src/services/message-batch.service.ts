// =============================================================================
// Message Batch Service — Batch 14: Message batching/debounce
// =============================================================================
// When enabled, consecutive messages from the same DM thread within a short
// window are collected into a batch. After the window expires (or max limits
// reached), the combined content is dispatched once through the pipeline.
// =============================================================================

import { prisma } from "../db.js";
import { config } from "../config.js";
import type { NormalizedMessage } from "./zalo-receive.js";

export interface BatchResult {
  batchId: string;
  threadId: string;
  status: string;
  messageCount: number;
  combinedText: string;
  totalChars: number;
  /** True if a new batch was created (first message in window). */
  isNew: boolean;
  /** True if the batch is now ready for processing (window expired or limits hit). */
  isReady: boolean;
  /** If isReady, the batch should be processed immediately. */
}

export interface BatchMessageIdentity {
  zaloMessageId: string;
  dbMessageId: string;
}

/** Resolve the last external batch ID to the exact persisted internal Message.id. */
export async function resolveLastBatchMessageIdentity(
  messageIds: readonly string[],
  threadId: string,
  expectedMessageCount: number,
): Promise<BatchMessageIdentity | null> {
  if (
    !Number.isInteger(expectedMessageCount) ||
    expectedMessageCount < 1 ||
    messageIds.length !== expectedMessageCount
  ) {
    return null;
  }
  const zaloMessageId = messageIds[messageIds.length - 1]?.trim();
  if (!zaloMessageId || !threadId) return null;

  const row = await prisma.message.findUnique({
    where: { zaloMessageId },
    select: { id: true, threadId: true },
  });
  if (!row || row.threadId !== threadId) return null;
  return { zaloMessageId, dbMessageId: row.id };
}

/**
 * Try to add a message to an existing batch, or create a new one.
 * Returns the batch status — if isReady=true, the caller should process immediately.
 */
export async function addToBatch(msg: NormalizedMessage): Promise<BatchResult | null> {
  const cfg = config.messageBatching;

  if (!cfg.enabled) return null;
  if (!cfg.threadTypes.includes(msg.threadType)) return null;
  if (msg.messageType !== "text") return null; // only text messages for batching

  const now = new Date();
  const content = msg.content;

  // Find existing collecting batch for this thread
  const existing = await prisma.messageBatch.findFirst({
    where: { threadId: msg.threadId, status: "collecting" },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    // Append to existing batch
    const messageIds: string[] = JSON.parse(existing.messageIds);
    if (msg.zaloMessageId) messageIds.push(msg.zaloMessageId);

    const newCount = existing.messageCount + 1;
    const newText = existing.combinedText
      ? existing.combinedText + "\n" + content
      : content;
    const newChars = newText.length;

    // Check if limits exceeded → mark ready
    const limitHit = newCount >= cfg.maxMessages || newChars > cfg.maxChars;
    const status = limitHit ? "ready" : "collecting";
    const dueAt = limitHit ? now : new Date(now.getTime() + cfg.windowMs);

    await prisma.messageBatch.update({
      where: { id: existing.id },
      data: {
        messageIds: JSON.stringify(messageIds),
        messageCount: newCount,
        combinedText: newText,
        totalChars: newChars,
        status,
        dueAt,
      },
    });

    return {
      batchId: existing.id,
      threadId: msg.threadId,
      status,
      messageCount: newCount,
      combinedText: newText,
      totalChars: newChars,
      isNew: false,
      isReady: limitHit,
    };
  }

  // Create new batch
  const messageIds: string[] = msg.zaloMessageId ? [msg.zaloMessageId] : [];
  const dueAt = new Date(now.getTime() + cfg.windowMs);

  // Get next batch index for this thread
  const lastBatch = await prisma.messageBatch.findFirst({
    where: { threadId: msg.threadId },
    orderBy: { batchIndex: "desc" },
    select: { batchIndex: true },
  });
  const nextIndex = (lastBatch?.batchIndex ?? 0) + 1;

  const batch = await prisma.messageBatch.create({
    data: {
      threadId: msg.threadId,
      threadType: msg.threadType,
      status: "collecting",
      messageIds: JSON.stringify(messageIds),
      messageCount: 1,
      combinedText: content,
      totalChars: content.length,
      batchIndex: nextIndex,
      dueAt,
    },
  });

  console.log(`[batch] new batch ${batch.id.slice(0, 8)} thread=${msg.threadId} index=${nextIndex}`);

  return {
    batchId: batch.id,
    threadId: msg.threadId,
    status: "collecting",
    messageCount: 1,
    combinedText: content,
    totalChars: content.length,
    isNew: true,
    isReady: false,
  };
}

/**
 * Find all batches that are ready for processing.
 * Ready = status is "ready" OR status is "collecting" and dueAt has passed.
 */
export async function findReadyBatches(limit = 10) {
  const now = new Date();

  // Get batches explicitly marked ready
  const explicitReady = await prisma.messageBatch.findMany({
    where: { status: "ready" },
    orderBy: { dueAt: "asc" },
    take: limit,
  });

  // Get collecting batches past their due date
  const overdueCollecting = await prisma.messageBatch.findMany({
    where: {
      status: "collecting",
      dueAt: { lte: now },
    },
    orderBy: { dueAt: "asc" },
    take: limit,
  });

  return [...explicitReady, ...overdueCollecting].slice(0, limit);
}

/**
 * Mark a batch as processing (atomic claim).
 */
export async function claimBatch(batchId: string): Promise<boolean> {
  const result = await prisma.messageBatch.updateMany({
    where: {
      id: batchId,
      status: { in: ["collecting", "ready"] },
    },
    data: { status: "processing" },
  });
  return result.count > 0;
}

/**
 * Mark a batch as completed with result.
 */
export async function completeBatch(batchId: string, result: Record<string, unknown>) {
  await prisma.messageBatch.update({
    where: { id: batchId },
    data: {
      status: "completed",
      processedAt: new Date(),
      result: JSON.stringify(result),
    },
  });
  console.log(`[batch] completed ${batchId.slice(0, 8)}`);
}

/**
 * Mark a batch as cancelled (no messages received within window).
 */
export async function cancelBatch(batchId: string) {
  await prisma.messageBatch.update({
    where: { id: batchId },
    data: { status: "cancelled", processedAt: new Date() },
  });
}

/**
 * Get a batch by ID.
 */
export async function getBatch(batchId: string) {
  return prisma.messageBatch.findUnique({ where: { id: batchId } });
}

/**
 * Clean up old completed/cancelled batches (older than 7 days).
 */
export async function cleanupOldBatches() {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000);
  const result = await prisma.messageBatch.deleteMany({
    where: {
      status: { in: ["completed", "cancelled"] },
      updatedAt: { lt: cutoff },
    },
  });
  if (result.count > 0) {
    console.log(`[batch] cleanup: removed ${result.count} old batches`);
  }
}
