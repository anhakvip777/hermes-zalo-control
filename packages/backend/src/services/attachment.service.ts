// =============================================================================
// Attachment service — Phase 3.5A media/attachment indexing
// =============================================================================
// Persists inbound media (image/file/voice/video) + its extracted (OCR/vision)
// text so it can be retrieved later by thread/date/keyword. All extracted text
// and any source URL are REDACTED before persistence (shared tool-gateway redact).
//
// Scope (3.5A): capture + index + search only. No original-file retention
// (storageKey stays null), no resend, no retrieval-answer automation, no backfill.
// =============================================================================

import { prisma } from "../db.js";
import { redact } from "./tool-gateway/redaction.js";

export type AttachmentKind = "image" | "file" | "voice" | "video";
export type ExtractionStatus = "pending" | "success" | "failed" | "unavailable";

function redactText(v: string | null | undefined): string | null {
  if (v == null) return null;
  const out = redact(String(v)) as string;
  return out;
}

/**
 * Merge a `vision` block into existing Message.metadata JSON WITHOUT clobbering
 * other keys (`_identity` from Phase 2, redaction markers, etc.). Pure + testable.
 */
export function mergeVisionMetadata(
  existingJson: string | null | undefined,
  vision: Record<string, unknown>,
): string {
  let merged: Record<string, unknown> = {};
  if (existingJson) {
    try { merged = JSON.parse(existingJson) as Record<string, unknown>; } catch { merged = {}; }
  }
  merged.vision = vision;
  return JSON.stringify(merged);
}

/** Map a NormalizedMessage.messageType to an attachment kind, or null if not media. */
export function deriveAttachmentKind(messageType: string | undefined | null): AttachmentKind | null {
  const t = String(messageType ?? "").toLowerCase();
  if (t === "image") return "image";
  if (t === "file" || t === "document") return "file";
  if (t === "voice" || t === "audio") return "voice";
  if (t === "video") return "video";
  return null;
}

export interface InboundAttachmentInput {
  messageId: string; // DB Message.id
  zaloMessageId: string | null;
  threadId: string;
  threadType: "user" | "group";
  senderId: string | null;
  kind: AttachmentKind;
  fileName?: string | null;
  sizeBytes?: number | null;
  /** Raw source URL — redacted before persist (may carry tokens). */
  sourceUrl?: string | null;
}

/**
 * Create an Attachment row for an inbound media message. Non-fatal on error.
 * Returns the attachment id, or null if it could not be created.
 * extractionStatus starts "pending"; the dispatcher updates it after OCR/vision.
 */
export async function saveInboundAttachment(input: InboundAttachmentInput): Promise<string | null> {
  try {
    const sourceUrlRedacted = input.sourceUrl ? redactText(input.sourceUrl) : null;
    const row = await prisma.attachment.create({
      data: {
        messageId: input.messageId,
        zaloMessageId: input.zaloMessageId,
        threadId: input.threadId,
        threadType: input.threadType,
        senderId: input.senderId,
        kind: input.kind,
        fileName: input.fileName ?? null,
        sizeBytes: input.sizeBytes ?? null,
        sourceUrlRedacted,
        extractionStatus: "pending",
        redactionApplied: sourceUrlRedacted != null,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err: unknown) {
    console.error(`[attachment] failed to save inbound attachment: ${(err as Error).message}`);
    return null;
  }
}

export interface ExtractionUpdate {
  extractedText?: string | null;
  description?: string | null;
  status: ExtractionStatus;
  provider?: string | null;
  model?: string | null;
  confidence?: number | null;
  sha256?: string | null;
  mimeType?: string | null;
}

/**
 * Update the extraction result for the image attachment of a given inbound
 * message. extractedText/description are REDACTED before persist. Non-fatal.
 * Matches the most recent attachment for the zaloMessageId + kind.
 */
export async function updateExtractionByZaloMessageId(
  zaloMessageId: string,
  kind: AttachmentKind,
  update: ExtractionUpdate,
): Promise<void> {
  try {
    const existing = await prisma.attachment.findFirst({
      where: { zaloMessageId, kind },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!existing) return;
    const extractedText = update.extractedText ? redactText(update.extractedText) : null;
    const description = update.description ? redactText(update.description) : null;
    await prisma.attachment.update({
      where: { id: existing.id },
      data: {
        extractedText,
        description,
        extractionStatus: update.status,
        redactionApplied: true,
        provider: update.provider ?? undefined,
        model: update.model ?? undefined,
        confidence: update.confidence ?? undefined,
        sha256: update.sha256 ?? undefined,
        mimeType: update.mimeType ?? undefined,
      },
    });
  } catch (err: unknown) {
    console.error(`[attachment] failed to update extraction: ${(err as Error).message}`);
  }
}

// ── Search (used by memory tools) ────────────────────────────────────

export interface AttachmentSearchQuery {
  threadId?: string; // undefined = global (admin only, enforced by caller scope)
  threadType?: "user" | "group";
  query?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit: number;
}

export interface AttachmentSearchResult {
  attachmentId: string;
  messageId: string;
  threadId: string;
  threadType: string;
  kind: string;
  extractionStatus: string;
  /** Redacted snippet (extractedText preferred, else description). */
  snippet: string;
  confidence: number | null;
  createdAt: string;
}

/**
 * Search indexed attachments by thread/type/date and keyword over the (already
 * redacted) extractedText + description. Returns evidence rows. The caller is
 * responsible for scope enforcement (threadId is passed pre-scoped).
 */
export async function searchAttachments(q: AttachmentSearchQuery): Promise<AttachmentSearchResult[]> {
  try {
    const where: Record<string, unknown> = {};
    if (q.threadId) where.threadId = q.threadId;
    if (q.threadType) where.threadType = q.threadType;
    if (q.dateFrom || q.dateTo) {
      where.createdAt = {
        ...(q.dateFrom ? { gte: q.dateFrom } : {}),
        ...(q.dateTo ? { lte: q.dateTo } : {}),
      };
    }
    if (q.query) {
      where.OR = [
        { extractedText: { contains: q.query } },
        { description: { contains: q.query } },
      ];
    }
    const rows = await prisma.attachment.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      take: q.limit,
      select: {
        id: true, messageId: true, threadId: true, threadType: true, kind: true,
        extractionStatus: true, extractedText: true, description: true,
        confidence: true, createdAt: true,
      },
    });
    return rows.map((r) => ({
      attachmentId: r.id,
      messageId: r.messageId,
      threadId: r.threadId,
      threadType: r.threadType,
      kind: r.kind,
      extractionStatus: r.extractionStatus,
      snippet: String(r.extractedText || r.description || "").slice(0, 500),
      confidence: r.confidence ?? null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ""),
    }));
  } catch (err: unknown) {
    console.error(`[attachment] search failed: ${(err as Error).message}`);
    return [];
  }
}
