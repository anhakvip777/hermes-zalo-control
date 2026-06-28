// =============================================================================
// Document Routes — admin-only ingestion + query
// Fix Batch 12.1: ingest returns immediately (202), processing in background
// =============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as docService from "../services/document-ingestion.service.js";

export async function documentRoutes(app: FastifyInstance) {
  // ── POST /api/documents/ingest ────────────────────────────────
  // Returns 202 Accepted immediately with documentId + jobId.
  // Processing (Docling spawn or direct text) continues in background.
  app.post("/documents/ingest", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown>;
    const filePath = body.path as string;
    const source = body.source as string | undefined;
    const threadId = body.threadId as string | undefined;
    const messageId = body.messageId as string | undefined;

    if (!filePath) {
      return reply.status(400).send({ error: "MISSING_PATH", message: "path is required" });
    }

    try {
      const result = await docService.ingestDocument(filePath, { source, threadId, messageId });
      return reply.status(202).send({ data: result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: "INGEST_FAILED", message });
    }
  });

  // ── GET /api/documents — list all ─────────────────────────────
  app.get("/documents", async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const docs = await docService.listDocuments(limit);
    return reply.send({ data: docs, total: docs.length });
  });

  // ── GET /api/documents/:id — detail ───────────────────────────
  app.get("/documents/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const doc = await docService.getDocument(req.params.id);
    if (!doc) {
      return reply.status(404).send({ error: "NOT_FOUND", message: "Document not found" });
    }
    return reply.send({ data: doc });
  });

  // ── GET /api/documents/:id/jobs — ingestion job history ───────
  app.get("/documents/:id/jobs", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const doc = await docService.getDocument(req.params.id);
    if (!doc) {
      return reply.status(404).send({ error: "NOT_FOUND", message: "Document not found" });
    }
    const jobs = await docService.getDocumentJobs(req.params.id);
    return reply.send({ data: jobs, total: jobs.length });
  });

  // ── GET /api/documents/:id/markdown ───────────────────────────
  app.get("/documents/:id/markdown", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const md = await docService.getDocumentMarkdown(req.params.id);
    if (md === null) {
      return reply.status(404).send({ error: "NOT_FOUND", message: "Markdown not available" });
    }
    return reply.send({ data: md });
  });

  // ── GET /api/documents/:id/chunks ─────────────────────────────
  app.get("/documents/:id/chunks", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const chunks = await docService.getDocumentChunks(req.params.id);
    return reply.send({ data: chunks, total: chunks.length });
  });

  // ── POST /api/documents/:id/ask ───────────────────────────────
  app.post("/documents/:id/ask", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown>;
    const question = body.question as string;

    if (!question || question.trim().length === 0) {
      return reply.status(400).send({ error: "MISSING_QUESTION", message: "question is required" });
    }

    try {
      const result = await docService.askDocument(req.params.id, question.trim());
      return reply.send({ data: result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === "Document not found" ? 404 : 400;
      return reply.status(status).send({ error: "ASK_FAILED", message });
    }
  });

  // ── POST /api/documents/:id/reingest ───────────────────────────
  // Batch 13: Re-ingest a previously ingested document.
  // Creates a new job without deleting the old document.
  // Only works if no active job is running for this document.
  app.post("/documents/:id/reingest", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const doc = await docService.getDocument(req.params.id);
    if (!doc) {
      return reply.status(404).send({ error: "NOT_FOUND", message: "Document not found" });
    }

    try {
      // Check for active jobs
      const jobs = await docService.getDocumentJobs(req.params.id);
      const activeJob = jobs.find(j => j.status === "queued" || j.status === "processing");
      if (activeJob) {
        return reply.status(409).send({
          error: "ACTIVE_JOB_EXISTS",
          message: `Document has an active job (status: ${activeJob.status}). Wait for it to finish or fail.`,
        });
      }

      // Re-ingest the file
      const result = await docService.ingestDocument(doc.originalPath, {
        source: "reingest",
        threadId: doc.threadId ?? undefined,
        messageId: undefined,
      });
      return reply.status(202).send({ data: result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: "REINGEST_FAILED", message });
    }
  });

  // ── DELETE /api/documents/:id ──────────────────────────────────
  // Batch 13: Delete a document and all its chunks + jobs (cascading).
  app.delete("/documents/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const doc = await docService.getDocument(req.params.id);
    if (!doc) {
      return reply.status(404).send({ error: "NOT_FOUND", message: "Document not found" });
    }

    try {
      // Delete from DB (cascades to chunks and jobs via Prisma onDelete: Cascade)
      const { prisma } = await import("../db.js");
      await prisma.document.delete({ where: { id: req.params.id } });

      // Clean up files if they exist
      const { unlink } = await import("node:fs/promises");
      if (doc.markdownPath) {
        unlink(doc.markdownPath).catch(() => {});
      }
      if (doc.originalPath && doc.source === "reingest") {
        // Only clean up re-ingested files
        unlink(doc.originalPath).catch(() => {});
      }

      return reply.send({ data: { id: req.params.id, deleted: true } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: "DELETE_FAILED", message });
    }
  });
}
