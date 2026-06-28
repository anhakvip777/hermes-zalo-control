// =============================================================================
// Message Batch Worker — Batch 14
// =============================================================================
// Polls the DB for collecting batches past their dueAt timestamp.
// When found, claims the batch and processes it through the dispatcher pipeline.
// This runs inside the existing scheduler worker's poll loop (no separate process).
// =============================================================================

import { prisma } from "../db.js";
import { config } from "../config.js";
import * as batchService from "../services/message-batch.service.js";

const POLL_INTERVAL_MS = 5_000; // 5 seconds — same as document worker

let stats = {
  polled: 0,
  processed: 0,
  failed: 0,
  lastPollAt: new Date().toISOString(),
};

/**
 * Poll for overdue batches (collecting past dueAt) and ready batches.
 * Called from the scheduler worker's main loop.
 */
export async function pollBatches(): Promise<void> {
  if (!config.messageBatching.enabled) return;

  try {
    const readyBatches = await batchService.findReadyBatches(5);
    stats.polled = readyBatches.length;
    stats.lastPollAt = new Date().toISOString();

    for (const batch of readyBatches) {
      const claimed = await batchService.claimBatch(batch.id);
      if (!claimed) continue;

      try {
        console.log(
          `[batch-worker] processing overdue batch ${batch.id.slice(0, 8)}: ` +
          `${batch.messageCount} msgs, ${batch.totalChars} chars, thread=${batch.threadId}`,
        );

        // Process through dispatcher
        // Dynamic import to avoid circular dependency at module load time
        const { handleIncomingMessage } = await import("../services/incoming-dispatcher.service.js");

        const messageIds: string[] = JSON.parse(batch.messageIds);
        const syntheticMsg = {
          zaloMessageId: messageIds[messageIds.length - 1] ?? null,
          threadId: batch.threadId,
          threadType: batch.threadType as "user" | "group",
          senderId: "",
          content: batch.combinedText ?? "",
          messageType: "text",
          rawMetadata: JSON.stringify({
            source: "message_batch",
            batchId: batch.id,
            messageIds,
          }),
          mentions: undefined,
        };

        const result = await handleIncomingMessage(syntheticMsg);

        await batchService.completeBatch(batch.id, {
          dispatched: result.dispatched,
          reason: result.reason,
          messageCount: batch.messageCount,
          totalChars: batch.totalChars,
          source: "batch_worker",
        });

        stats.processed++;
        console.log(
          `[batch-worker] batch ${batch.id.slice(0, 8)} processed: ` +
          `dispatched=${result.dispatched} reason=${result.reason ?? "none"}`,
        );
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[batch-worker] batch ${batch.id.slice(0, 8)} error: ${errorMsg}`);

        await batchService.completeBatch(batch.id, {
          dispatched: false,
          reason: "batch_worker_error",
          error: errorMsg.slice(0, 500),
          messageCount: batch.messageCount,
          totalChars: batch.totalChars,
        });

        stats.failed++;
      }
    }
  } catch (err: unknown) {
    console.error(`[batch-worker] poll error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Get batch worker stats for health reporting.
 */
export function getBatchStats() {
  return {
    ...stats,
    enabled: config.messageBatching.enabled,
    windowMs: config.messageBatching.windowMs,
    maxMessages: config.messageBatching.maxMessages,
    maxChars: config.messageBatching.maxChars,
  };
}
