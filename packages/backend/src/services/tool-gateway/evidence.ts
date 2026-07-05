// =============================================================================
// Tool Gateway — evidence writer (Phase 1)
// =============================================================================
// Supports BOTH ToolCallRecord and ZaloActionRecord. Behind a ToolEvidenceSink
// interface with a Prisma impl (runtime) and an in-memory impl (tests, no DB).
// Reaction/poll runtime wiring is Phase 2 — but the writer + models exist now so
// Phase 2 does not redesign this.
// =============================================================================

import type {
  ToolCallEvidence,
  ToolEvidenceSink,
  ZaloActionEvidence,
} from "./types.js";

// ── Prisma-backed sink (runtime) ─────────────────────────────────────
// Uses dynamic import of ../db.js so tests that inject the in-memory sink don't
// require @prisma/client at all. Never throws — evidence write failures degrade
// gracefully (return a synthetic id) so a DB hiccup can't crash a tool call.
export class PrismaToolEvidenceSink implements ToolEvidenceSink {
  async writeToolCall(record: ToolCallEvidence): Promise<string> {
    try {
      const { prisma } = await import("../../db.js");
      const row = await (prisma as any).toolCallRecord.create({
        data: {
          agentName: record.agentName,
          toolName: record.toolName,
          kind: record.kind,
          threadId: record.threadId,
          threadType: record.threadType,
          principalId: record.principalId ?? null,
          role: record.role,
          executionStatus: record.executionStatus,
          deliveryStatus: record.deliveryStatus,
          idempotencyKey: record.idempotencyKey ?? null,
          idempotencyKeySource: record.idempotencyKeySource ?? null,
          argsRedacted: record.argsRedacted ?? null,
          resultRedacted: record.resultRedacted ?? null,
          errorCode: record.errorCode ?? null,
          errorMessage: record.errorMessage ?? null,
          evidence: record.evidence ?? null,
          outboundRecordId: record.outboundRecordId ?? null,
          zaloActionRecordId: record.zaloActionRecordId ?? null,
          agentTaskId: record.agentTaskId ?? null,
          scheduleId: record.scheduleId ?? null,
          relatedMessageId: record.relatedMessageId ?? null,
          durationMs: record.durationMs ?? null,
          startedAt: record.startedAt ?? null,
          completedAt: record.completedAt ?? null,
        },
        select: { id: true },
      });
      return row.id as string;
    } catch (err: unknown) {
      console.error(`[tool-gateway] writeToolCall failed (non-fatal): ${(err as Error).message}`);
      return `unpersisted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  async writeZaloAction(record: ZaloActionEvidence): Promise<string> {
    try {
      const { prisma } = await import("../../db.js");
      const row = await (prisma as any).zaloActionRecord.create({
        data: {
          actionType: record.actionType,
          threadId: record.threadId,
          threadType: record.threadType,
          principalId: record.principalId ?? null,
          trigger: record.trigger ?? "system",
          targetMsgId: record.targetMsgId ?? null,
          payloadRedacted: record.payloadRedacted ?? null,
          dryRun: record.dryRun ?? false,
          decision: record.decision ?? "allow",
          reason: record.reason,
          executionStatus: record.executionStatus,
          deliveryStatus: record.deliveryStatus,
          providerResultId: record.providerResultId ?? null,
          errorCode: record.errorCode ?? null,
          errorMessage: record.errorMessage ?? null,
          idempotencyKey: record.idempotencyKey ?? null,
          toolCallRecordId: record.toolCallRecordId ?? null,
          createdBy: record.createdBy ?? null,
        },
        select: { id: true },
      });
      return row.id as string;
    } catch (err: unknown) {
      console.error(`[tool-gateway] writeZaloAction failed (non-fatal): ${(err as Error).message}`);
      return `unpersisted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  async findByIdempotencyKey(key: string): Promise<{ id: string; resultRedacted: string | null } | null> {
    try {
      const { prisma } = await import("../../db.js");
      const row = await (prisma as any).toolCallRecord.findUnique({
        where: { idempotencyKey: key },
        select: { id: true, resultRedacted: true },
      });
      return row ? { id: row.id as string, resultRedacted: (row.resultRedacted as string | null) ?? null } : null;
    } catch {
      return null;
    }
  }
}

// ── In-memory sink (tests / no-DB) ───────────────────────────────────
export class InMemoryToolEvidenceSink implements ToolEvidenceSink {
  readonly toolCalls: Array<ToolCallEvidence & { id: string }> = [];
  readonly zaloActions: Array<ZaloActionEvidence & { id: string }> = [];
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  async writeToolCall(record: ToolCallEvidence): Promise<string> {
    const id = this.nextId("tcr");
    this.toolCalls.push({ ...record, id });
    return id;
  }

  async writeZaloAction(record: ZaloActionEvidence): Promise<string> {
    const id = this.nextId("zar");
    this.zaloActions.push({ ...record, id });
    return id;
  }

  async findByIdempotencyKey(key: string): Promise<{ id: string; resultRedacted: string | null } | null> {
    // Only consider terminal successful executions as replayable.
    const hit = [...this.toolCalls]
      .reverse()
      .find((r) => r.idempotencyKey === key && r.executionStatus === "success");
    return hit ? { id: hit.id, resultRedacted: hit.resultRedacted ?? null } : null;
  }

  reset(): void {
    this.toolCalls.length = 0;
    this.zaloActions.length = 0;
    this.seq = 0;
  }
}

// Default sink is Prisma-backed; tests inject the in-memory sink.
let defaultSink: ToolEvidenceSink | null = null;

export function getToolEvidenceSink(): ToolEvidenceSink {
  if (!defaultSink) defaultSink = new PrismaToolEvidenceSink();
  return defaultSink;
}

export function setToolEvidenceSinkForTest(sink: ToolEvidenceSink | null): void {
  defaultSink = sink;
}
