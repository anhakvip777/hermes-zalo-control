// =============================================================================
// Document Ingestion Worker — Batch 12.1 Process Isolation
// =============================================================================
// Runs as a SEPARATE process from the backend. Polls the DB for queued
// DocumentIngestionJobs and processes them. TXT/MD/CSV ingested directly.
// PDF/DOCX/PPTX/XLSX processed via Docling spawn with hard timeout.
//
// Start: npx tsx src/workers/document-worker.ts

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { heartbeatOk } from "../services/heartbeat.service.js";
import {
  processDirectText,
  runDoclingWithSpawn,
} from "../services/document-ingestion.service.js";
import type { Document, DocumentIngestionJob } from "@prisma/client";

const POLL_INTERVAL_MS = 5_000; // 5 seconds
const HEARTBEAT_INTERVAL_MS = 30_000;

// ── Stats ───────────────────────────────────────────────────────────

let stats = {
  queued: 0,
  running: 0,
  completed: 0,
  failed: 0,
  lastPollAt: new Date().toISOString(),
};

// ── Atomic claim ────────────────────────────────────────────────────

async function claimJob(jobId: string): Promise<boolean> {
  const result = await prisma.documentIngestionJob.updateMany({
    where: { id: jobId, status: "queued" },
    data: { status: "processing", startedAt: new Date() },
  });
  return result.count > 0;
}

// ── Process single job ──────────────────────────────────────────────

async function processJob(job: DocumentIngestionJob): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: job.documentId } });
  if (!doc) {
    console.error(`[doc-worker] Document ${job.documentId} not found for job ${job.id}`);
    await prisma.documentIngestionJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorCode: "DOCUMENT_NOT_FOUND",
        errorMessage: "Document record not found",
        finishedAt: new Date(),
      },
    });
    stats.failed++;
    return;
  }

  try {
    console.log(`[doc-worker] Processing job ${job.id} for ${doc.fileName} (${doc.extension})`);

    const resolvedPath = resolve(doc.originalPath);
    const fileBuffer = await readFile(resolvedPath);
    const extension = doc.extension.toLowerCase();

    // TXT/MD/CSV → direct text processing
    if (["txt", "md", "csv"].includes(extension)) {
      await processDirectText(doc.id, job.id, doc.fileName, doc.sizeBytes, fileBuffer);
    } else {
      // PDF/DOCX/etc → Docling spawn
      await runDoclingWithSpawn(doc.id, job.id, resolvedPath, doc.fileName, extension, doc.sizeBytes);
    }

    stats.completed++;
    console.log(`[doc-worker] Job ${job.id} completed: ${doc.fileName}`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[doc-worker] Job ${job.id} failed for ${doc.fileName}: ${errorMsg}`);

    // Preserve specific error code if already classified by failJob();
    // otherwise fall back to generic PROCESSING_FAILED.
    const classifiedErr = err instanceof Error && "code" in err
      ? (err as Error & { code?: string }).code
      : undefined;
    const errorCode = classifiedErr ?? "PROCESSING_FAILED";

    try {
      // Only update if not already failed by failJob() (avoid overwriting specific codes)
      const existingDoc = await prisma.document.findUnique({ where: { id: doc.id } });
      const existingJob = await prisma.documentIngestionJob.findUnique({ where: { id: job.id } });

      if (!existingDoc || existingDoc.status !== "failed") {
        await prisma.document.update({
          where: { id: doc.id },
          data: {
            status: "failed",
            errorCode,
            errorMessage: errorMsg.slice(0, 500),
          },
        });
      }
      if (!existingJob || existingJob.status !== "failed") {
        await prisma.documentIngestionJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            errorCode,
            errorMessage: errorMsg.slice(0, 500),
            finishedAt: new Date(),
          },
        });
      }
    } catch (dbErr: unknown) {
      console.error(`[doc-worker] Failed to update DB for ${doc.id}: ${(dbErr as Error).message}`);
    }

    stats.failed++;
  }
}

// ── Poll loop ────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  try {
    const queuedJobs = await prisma.documentIngestionJob.findMany({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      take: 5, // process at most 5 per poll
    });

    stats.queued = queuedJobs.length;

    for (const job of queuedJobs) {
      const claimed = await claimJob(job.id);
      if (!claimed) continue; // another worker took it

      stats.running++;
      await processJob(job);
      stats.running--;
    }

    stats.lastPollAt = new Date().toISOString();
  } catch (err: unknown) {
    console.error(`[doc-worker] Poll error: ${(err as Error).message}`);
  }
}

// ── Heartbeat ────────────────────────────────────────────────────────

async function sendHeartbeat(): Promise<void> {
  try {
    // Count jobs in last 24h
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [failed24h, completed24h, running, queued] = await Promise.all([
      prisma.documentIngestionJob.count({
        where: { status: "failed", finishedAt: { gte: since24h } },
      }),
      prisma.documentIngestionJob.count({
        where: { status: "completed", finishedAt: { gte: since24h } },
      }),
      prisma.documentIngestionJob.count({
        where: { status: "processing" },
      }),
      prisma.documentIngestionJob.count({
        where: { status: "queued" },
      }),
    ]);

    await heartbeatOk("documentWorker", {
      pid: process.pid,
      queuedDocumentJobs: queued,
      runningDocumentJobs: running,
      completedDocumentJobs24h: completed24h,
      failedDocumentJobs24h: failed24h,
      lastPollAt: stats.lastPollAt,
    });
  } catch { /* non-critical */ }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("[doc-worker] Document ingestion worker started");
  console.log(`[doc-worker] Poll interval: ${POLL_INTERVAL_MS / 1000}s, timeout: ${config.document.doclingTimeoutMs / 1000}s`);

  // Initial poll + heartbeat
  await poll();
  await sendHeartbeat();

  // Periodic poll
  const pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  const heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n[doc-worker] Shutting down...");
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    // Let current job finish (up to timeout + grace)
    await new Promise((r) => setTimeout(r, 2000));
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[doc-worker] Fatal error:", err);
  process.exit(1);
});
