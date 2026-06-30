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

        // Process through backend internal API (R3.2 — worker no longer calls handler directly)
        // Backend owns Zalo session; worker must route outbound via internal API.
        const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN;
        const INTERNAL_BASE = process.env.INTERNAL_API_BASE_URL || "http://127.0.0.1:3002";

        if (!INTERNAL_TOKEN) {
          console.error("[batch-worker] INTERNAL_API_TOKEN not set — cannot process batch.");
          await batchService.completeBatch(batch.id, {
            dispatched: false, reason: "internal_api_not_configured",
            error: "INTERNAL_API_TOKEN missing", messageCount: batch.messageCount, totalChars: batch.totalChars,
          });
          stats.failed++;
          continue;
        }

        const messageIds: string[] = JSON.parse(batch.messageIds);
        const payload = {
          threadId: batch.threadId,
          threadType: batch.threadType,
          messages: messageIds.map((id, i) => ({
            messageId: id,
            content: batch.combinedText?.split("\n")[i] ?? "",
          })),
          combinedContent: batch.combinedText ?? "",
          metadata: {
            source: "message_batch",
            batchId: batch.id,
            messageIds,
            messageCount: batch.messageCount,
          },
        };

        let response: Response;
        try {
          response = await fetch(`${INTERNAL_BASE}/api/internal/messages/handle-batch`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${INTERNAL_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(30_000),
          });
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[batch-worker] internal API unreachable: ${errorMsg}`);
          await batchService.completeBatch(batch.id, {
            dispatched: false, reason: "internal_api_unreachable",
            error: errorMsg.slice(0, 500), messageCount: batch.messageCount, totalChars: batch.totalChars,
          });
          stats.failed++;
          continue;
        }

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "unknown");
          console.error(`[batch-worker] internal API error ${response.status}: ${errorBody.slice(0, 200)}`);
          await batchService.completeBatch(batch.id, {
            dispatched: false, reason: `internal_api_${response.status}`,
            error: errorBody.slice(0, 500), messageCount: batch.messageCount, totalChars: batch.totalChars,
          });
          stats.failed++;
          continue;
        }

        const result = await response.json() as { ok?: boolean; dispatched?: boolean; reason?: string };
        const dispatched = result.dispatched ?? result.ok ?? false;
        const reason = result.reason ?? (dispatched ? "success" : "unknown");

        await batchService.completeBatch(batch.id, {
          dispatched,
          reason,
          messageCount: batch.messageCount,
          totalChars: batch.totalChars,
          source: "batch_worker",
        });

        stats.processed++;
        console.log(
          `[batch-worker] batch ${batch.id.slice(0, 8)} processed: ` +
          `dispatched=${dispatched} reason=${reason}`,
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
