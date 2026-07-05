// =============================================================================
// Memory retrieval-answer tool — Phase 3.5B-B (read-only wrapper)
// =============================================================================
// A thin ToolGateway wrapper around answerRetrieval() (Phase 3.5B-A). It turns a
// scoped memory + attachment (OCR) search into an evidence-backed answer.
//
// HARD RULES:
//   - kind "read": no send, no provider AI, no bridge, no live. Pure retrieval.
//   - Scope guard lives in answerRetrieval (resolveThreadScope): a non-admin
//     cross-thread request returns status "permission_denied" and NO search runs.
//   - The wrapper NEVER throws for expected outcomes — it returns the service's
//     { status, answerText, evidence, confidence } object verbatim.
//   - Registering this tool does NOT invoke it (registry is not wired at startup).
// =============================================================================

import { z } from "zod";
import type { ToolDefinition } from "../../tool-gateway/types.js";
import { answerRetrieval, type RetrievalAnswerDeps } from "../../retrieval-answer.service.js";

const evidenceSchema = z.object({
  messageId: z.string(),
  attachmentId: z.string().optional(),
  createdAt: z.string(),
  threadId: z.string(),
  threadType: z.string(),
  source: z.enum(["message", "attachment"]),
  kind: z.string().optional(),
  extractionStatus: z.string().optional(),
  snippetRedacted: z.string().optional(),
  confidence: z.union([z.number(), z.string()]).optional(),
});

const retrievalResultSchema = z.object({
  status: z.enum(["found", "not_found", "permission_denied", "unavailable"]),
  answerText: z.string(),
  evidence: z.array(evidenceSchema),
  confidence: z.enum(["high", "medium", "low"]),
});

const argsSchema = z.object({
  query: z.string().min(1),
  targetThreadId: z.string().optional(),
  targetThreadType: z.enum(["user", "group"]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  includeAttachments: z.boolean().optional(),
});

/**
 * Build the `memory.retrievalAnswer` tool. Optional deps are for testing; the
 * default (no deps) uses the real Prisma-backed attachment/message search.
 */
export function createRetrievalAnswerTool(deps: RetrievalAnswerDeps = {}): ToolDefinition {
  return {
    name: "memory.retrievalAnswer",
    kind: "read",
    minRole: "basic_chat",
    dataScope: "own_thread",
    argsSchema,
    resultSchema: retrievalResultSchema,
    async execute({ args, ctx, role }) {
      const a = args as z.infer<typeof argsSchema>;
      const result = await answerRetrieval(
        {
          query: a.query,
          requesterThreadId: ctx.threadId,
          requesterThreadType: ctx.threadType,
          targetThreadId: a.targetThreadId,
          targetThreadType: a.targetThreadType,
          dateFrom: a.dateFrom,
          dateTo: a.dateTo,
          includeAttachments: a.includeAttachments,
          role,
        },
        deps,
      );
      return { result };
    },
  };
}
