// =============================================================================
// Inbound Identity Normalization — KI-H1 (Phase 2)
// =============================================================================
// Derives a robust (threadId, threadType, senderId) triad from a raw Zalo event,
// with an explicit confidence label and the list of fields it was derived from.
//
// Why this exists (legacy evidence):
//   - 128 outbound sends blocked on `unknown-thread-type`
//   - raw-inbound events with `threadId: null` (type inferred from to/groupId/isGroup)
//   - 571 chat-log records with a blank senderId (12.7%)
//
// Rules (safe-by-default):
//   - threadType is decided FIRST, from the strongest available signal.
//   - senderId is NEVER derived from a display name.
//   - When nothing resolves, confidence is "unknown" and the caller must treat
//     the sender as the lowest role (form_only), with no elevation / no tool write /
//     no cross-thread memory.
//
// Pure + DB-free + no side effects → unit-testable in isolation.
// =============================================================================

export type ResolvedThreadType = "user" | "group" | "unknown";
export type IdentityConfidence = "exact" | "derived" | "unknown";

export interface InboundIdentity {
  threadId: string | null;
  threadType: ResolvedThreadType;
  senderId: string | null;
  senderName: string | null;
  /** exact = explicit threadId + explicit type; derived = via fallback; unknown = unresolved. */
  identityConfidence: IdentityConfidence;
  /** Ordered list of raw fields the identity was derived from (for the trace). */
  identitySource: string[];
}

/** First non-empty trimmed string among the candidates, else null. */
function firstStr(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t) return t;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      // Zalo IDs are 18-digit strings; a numeric arrives only from loose JSON.
      // Stringify WITHOUT parseInt to avoid precision loss.
      const t = String(v).trim();
      if (t) return t;
    }
  }
  return null;
}

/** First explicit boolean among the candidates, else undefined. */
function firstBool(...vals: unknown[]): boolean | undefined {
  for (const v of vals) {
    if (typeof v === "boolean") return v;
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return undefined;
}

/**
 * Map an explicit zca-js thread type to user|group.
 * zca-js v2 uses numeric ThreadType (0 = user/DM, non-zero = group), or the
 * strings "User"/"Group".
 */
function resolveExplicitThreadType(rawType: unknown): "user" | "group" {
  if (typeof rawType === "number") return rawType === 0 ? "user" : "group";
  return String(rawType) === "User" || String(rawType) === "user" ? "user" : "group";
}

/**
 * Derive the inbound identity triad + confidence from a raw Zalo event.
 * Accepts the raw event; also inspects `raw.data` (zca-js nests message fields there).
 */
export function normalizeInboundIdentity(raw: Record<string, unknown> | null | undefined): InboundIdentity {
  const src: string[] = [];
  if (!raw || typeof raw !== "object") {
    return {
      threadId: null,
      threadType: "unknown",
      senderId: null,
      senderName: null,
      identityConfidence: "unknown",
      identitySource: src,
    };
  }

  const data = (raw.data ?? raw) as Record<string, unknown>;

  // ── senderId (never from displayName) ─────────────────────────────
  const senderId = firstStr(
    data.senderId, raw.senderId,
    data.fromId, raw.fromId,
    data.from, raw.from,
    data.uid, raw.uid,
    data.uidFrom, raw.uidFrom,
  );
  if (senderId) src.push("senderId");

  // ── threadType (decide FIRST, strongest signal) ──────────────────
  const rawType = raw.type ?? raw.threadType ?? data.threadType;
  const isGroupFlag = firstBool(raw.isGroup, data.isGroup);
  const groupId = firstStr(raw.groupId, data.groupId);

  let threadType: ResolvedThreadType;
  let typeExplicit = false;
  if (rawType !== undefined && rawType !== null) {
    threadType = resolveExplicitThreadType(rawType);
    typeExplicit = true;
    src.push("type");
  } else if (isGroupFlag === true || groupId) {
    threadType = "group";
    src.push(isGroupFlag === true ? "isGroup" : "groupId");
  } else if (isGroupFlag === false) {
    threadType = "user";
    src.push("isGroup");
  } else if (senderId) {
    // No group signal but we have a sender → treat as a DM (safer than the
    // legacy default of "group", which had the largest blast radius).
    threadType = "user";
    src.push("senderAsDM");
  } else {
    threadType = "unknown";
  }

  // ── threadId (explicit, else fallback per threadType) ─────────────
  const explicitThreadId = firstStr(raw.threadId, data.threadId);
  let threadId: string | null;
  if (explicitThreadId) {
    threadId = explicitThreadId;
    src.push("threadId");
  } else if (threadType === "group") {
    threadId = groupId ?? firstStr(raw.to, data.to);
    if (threadId) src.push(groupId ? "threadId:groupId" : "threadId:to");
  } else {
    // user or unknown → prefer the participant id
    threadId = senderId ?? firstStr(raw.from, data.from, raw.to, data.to);
    if (threadId) src.push("threadId:derived");
  }

  // ── overall confidence ───────────────────────────────────────────
  let identityConfidence: IdentityConfidence;
  if (!threadId || threadType === "unknown") {
    identityConfidence = "unknown";
  } else if (explicitThreadId && typeExplicit) {
    identityConfidence = "exact";
  } else {
    identityConfidence = "derived";
  }

  const senderName = firstStr(
    data.senderName, raw.senderName,
    data.fromName, raw.fromName,
  );

  return { threadId, threadType, senderId, senderName, identityConfidence, identitySource: src };
}
