// =============================================================================
// Outbound Guardrails — split-send, dedup, sanitizer, audit, sent-context
// =============================================================================

import { createHash } from "node:crypto";
import { config } from "../config.js";

// ═══════════════════════════════════════════════════════════════════
// 1. Split-send — safe long text splitting
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_MAX_CHARS = 1800;
const DEFAULT_MAX_PARTS = 5;

/**
 * Split long text into parts without breaking Unicode characters or emoji.
 * Respects surrogate pairs and Vietnamese diacritics.
 */
export function splitLongMessage(
  content: string,
  maxChars = DEFAULT_MAX_CHARS,
  maxParts = DEFAULT_MAX_PARTS,
): string[] {
  if (content.length <= maxChars) return [content];

  const parts: string[] = [];
  let remaining = content;
  const totalParts = Math.min(Math.ceil(content.length / maxChars), maxParts);

  for (let i = 0; i < maxParts && remaining.length > 0; i++) {
    if (i === maxParts - 1 || remaining.length <= maxChars) {
      // Last part — take all remaining + optional truncation suffix
      const truncated = remaining.length > maxChars
        ? remaining.slice(0, maxChars - 50) + "...\n(Đã cắt bớt do quá dài)"
        : remaining;
      parts.push(truncated);
      break;
    }

    // Find safe break point
    let cutAt = maxChars;
    if (totalParts > 1 && i < totalParts - 1) {
      // Try to break at a natural boundary (newline, sentence end, word end)
      const segment = remaining.slice(0, maxChars);
      const breaks = [
        segment.lastIndexOf("\n\n"),
        segment.lastIndexOf("\n"),
        segment.lastIndexOf(". "),
        segment.lastIndexOf("! "),
        segment.lastIndexOf("? "),
        segment.lastIndexOf(" "),
      ];
      const bestBreak = Math.max(...breaks.filter((b) => b > maxChars * 0.6));
      if (bestBreak > 0) cutAt = bestBreak + 1;
    }

    // Ensure we don't split a surrogate pair
    while (
      cutAt > 0 &&
      cutAt < remaining.length &&
      isLowSurrogate(remaining.charCodeAt(cutAt))
    ) {
      cutAt--;
    }

    const part = remaining.slice(0, cutAt).trimEnd();
    remaining = remaining.slice(cutAt).trimStart();

    // Add part counter prefix
    const prefix = totalParts > 1 ? `(${i + 1}/${totalParts}) ` : "";
    parts.push(prefix + part);
  }

  return parts.length === 0 ? [content.slice(0, maxChars)] : parts;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

// ═══════════════════════════════════════════════════════════════════
// 2. Unicode Sanitizer
// ═══════════════════════════════════════════════════════════════════

/**
 * Normalize and sanitize text before sending to Zalo.
 * - NFC normalization (preserves Vietnamese diacritics)
 * - Replace smart quotes with ASCII equivalents
 * - Replace em/en dashes with regular dashes
 * - Remove invisible/control characters (except newline/tab)
 * - Remove zero-width characters
 */
export function sanitizeText(content: string): string {
  // NFC normalization — keeps Vietnamese composed forms (à, ả, ạ, ố, ồ, etc.)
  let out = content.normalize("NFC");

  // Smart quotes → ASCII
  out = out.replace(/[\u201c\u201d\u201e\u201f\u2033\u2036]/g, '"');
  out = out.replace(/[\u2018\u2019\u201a\u201b\u2032\u2035]/g, "'");

  // Em dash, en dash → regular dash
  out = out.replace(/[\u2014\u2015]/g, "--");
  out = out.replace(/[\u2013]/g, "-");

  // Horizontal ellipsis → ...
  out = out.replace(/\u2026/g, "...");

  // Remove zero-width characters
  out = out.replace(/[\u200b\u200c\u200d\u200e\u200f\u2060\ufeff]/g, "");

  // Remove invisible/control characters except newline (\n) and tab (\t)
  out = out.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");

  // Remove soft-hyphen, other invisible spacers
  out = out.replace(/[\u00ad\u202f\ufeff]/g, "");
  out = out.replace(/\u00a0/g, " "); // non-breaking space → regular space

  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 3. Outbound Dedup
// ═══════════════════════════════════════════════════════════════════

interface DedupEntry {
  hash: string;
  at: number;
  sentMessageId?: string;
}

/** threadId → recent outbound hashes */
const outboundDedup = new Map<string, DedupEntry[]>();

/**
 * Check if a message to the given thread is a duplicate.
 * Dedup window:
 *   - 5s for adapter-level double-send (same hash + thread)
 *   - 60s for identical content to same thread
 */
export function checkOutboundDedup(
  threadId: string,
  content: string,
  source: string,
): { duplicate: true; reason: string } | { duplicate: false } {
  const now = Date.now();
  const hash = contentHash(threadId, content);
  const entries = outboundDedup.get(threadId) ?? [];

  // Prune expired entries
  const active = entries.filter((e) => {
    if (e.hash === hash) return now - e.at < 60_000; // 60s for same content
    return now - e.at < 5_000; // 5s for different content (adapter double-send)
  });
  outboundDedup.set(threadId, active);

  // Check if this exact hash is still within window
  const existing = active.find((e) => e.hash === hash);
  if (existing) {
    return { duplicate: true, reason: "DUPLICATE_OUTBOUND" };
  }

  return { duplicate: false };
}

/**
 * Record an outbound send for future dedup checks.
 * Called after successful send.
 */
export function recordOutboundDedup(
  threadId: string,
  content: string,
  sentMessageId?: string,
): void {
  const hash = contentHash(threadId, content);
  const entries = outboundDedup.get(threadId) ?? [];
  entries.push({ hash, at: Date.now(), sentMessageId });
  // Keep last 50 entries per thread
  if (entries.length > 50) entries.shift();
  outboundDedup.set(threadId, entries);
}

function contentHash(threadId: string, content: string): string {
  return createHash("sha256")
    .update(`${threadId}:${content}`)
    .digest("hex")
    .slice(0, 16);
}

// ═══════════════════════════════════════════════════════════════════
// 4. Sent-Context Memory (DB-backed)
// ═══════════════════════════════════════════════════════════════════

export interface OutboundRecord {
  threadId: string;
  threadType: "user" | "group";
  content: string;
  contentHash: string;
  sentMessageId: string;
  source: "auto_reply" | "agent_tool" | "schedule" | "media" | "manual" | "create_reminder";
  dryRun: boolean;
  errorCode?: string;
  decision: "allow" | "skip" | "block";
  reason: string;
  createdAt: Date;
}

/**
 * Save an outbound record to DB (sent-context).
 * Uses Prisma OutboundRecord model.
 */
export async function saveOutboundRecord(
  record: Omit<OutboundRecord, "contentHash" | "createdAt">,
): Promise<void> {
  try {
    const { prisma } = await import("../db.js");
    // Sanitize content: strip non-printable/control chars that break Prisma SQLite
    const safeContent = (record.content || "")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // strip C0 control chars (except \t \n \r)
      .slice(0, 4000);
    await prisma.outboundRecord.create({
      data: {
        threadId: record.threadId,
        threadType: record.threadType,
        content: safeContent,
        contentHash: createHash("sha256")
          .update(`${record.threadId}:${record.content}`)
          .digest("hex"),
        sentMessageId: record.sentMessageId,
        source: record.source,
        dryRun: record.dryRun,
        errorCode: record.errorCode ?? null,
        decision: record.decision,
        reason: record.reason,
      },
    });
  } catch (err: unknown) {
    // Non-fatal — DB may be unavailable, dedup continues in-memory
    console.error(`[outbound] Failed to save OutboundRecord to DB: ${(err as Error).message}`);
  }
}

/**
 * Get recent sent messages for a thread (for Hermes context).
 */
export async function getRecentSentContext(
  threadId: string,
  limit = 5,
): Promise<Array<{ content: string; sentMessageId: string; source: string; createdAt: Date }>> {
  try {
    const { prisma } = await import("../db.js");
    const records = await prisma.outboundRecord.findMany({
      where: { threadId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        content: true,
        sentMessageId: true,
        source: true,
        createdAt: true,
      },
    });
    return records.map((r) => ({
      content: r.content,
      sentMessageId: r.sentMessageId ?? "",
      source: r.source,
      createdAt: r.createdAt,
    }));
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// 5. Outbound Audit (standardized logging)
// ═══════════════════════════════════════════════════════════════════

export interface OutboundAudit {
  decision: "allow" | "skip" | "block";
  reason: string;
  threadId: string;
  threadType: "user" | "group";
  contentHash: string;
  contentPreview?: string;
  source: "auto_reply" | "agent_tool" | "schedule" | "media" | "manual" | "create_reminder";
  dryRun: boolean;
  sentMessageId?: string;
  errorCode?: string;
}

/**
 * Log a standardized outbound audit entry.
 * Outputs JSON to console for log aggregation.
 */
export function logOutboundAudit(audit: OutboundAudit): void {
  const entry = {
    ...audit,
    ts: new Date().toISOString(),
    contentPreview: audit.contentPreview?.slice(0, 80),
  };
  console.log(`[outbound] ${JSON.stringify(entry)}`);
}

// ═══════════════════════════════════════════════════════════════════
// 6. Combined outbound gate — chains all checks
// ═══════════════════════════════════════════════════════════════════

export interface OutboundGateResult {
  allowed: boolean;
  reason?: string;
  errorCode?: string;
  parts?: string[];
}

/**
 * Run all outbound guardrails on a text message before sending.
 * Returns either an error or the sanitized+split parts.
 */
export function applyOutboundGuardrails(
  threadId: string,
  threadType: "user" | "group",
  content: string,
  source: OutboundAudit["source"],
  dryRun: boolean,
): OutboundGateResult {
  // 1. Unicode sanitizer
  const sanitized = sanitizeText(content);

  // 2. Outbound dedup
  const dedup = checkOutboundDedup(threadId, sanitized, source);
  if (dedup.duplicate) {
    logOutboundAudit({
      decision: "block",
      reason: dedup.reason,
      threadId,
      threadType,
      contentHash: contentHash(threadId, sanitized),
      contentPreview: sanitized,
      source,
      dryRun,
    });
    return { allowed: false, reason: dedup.reason, errorCode: "DUPLICATE_OUTBOUND" };
  }

  // 3. Split long messages
  const parts = splitLongMessage(sanitized);

  logOutboundAudit({
    decision: "allow",
    reason: parts.length > 1 ? "split_send" : "single_send",
    threadId,
    threadType,
    contentHash: createHash("sha256")
      .update(`${threadId}:${sanitized}`)
      .digest("hex")
      .slice(0, 16),
    contentPreview: sanitized,
    source,
    dryRun,
  });

  return { allowed: true, parts };
}

/** Reset dedup state (for tests). */
export function resetOutboundDedup(): void {
  outboundDedup.clear();
}
