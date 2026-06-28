// =============================================================================
// Document Routes — admin-only ingestion + query
// =============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as docService from "../services/document-ingestion.service.js";

export async function documentRoutes(app: FastifyInstance) {
  // ── POST /api/documents/ingest ────────────────────────────────
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
      const doc = await docService.ingestDocument(filePath, { source, threadId, messageId });
      return reply.status(201).send({ data: doc });
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
}
