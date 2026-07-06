// =============================================================================
// Retrieval intent detection + search-term derivation — Phase 3.5E-B
// =============================================================================
// Decides whether an inbound text is a retrieval request and derives a SHORT
// search term (not the full sentence) for answerRetrieval(). Deterministic; no
// NLP, no I/O. Reuses parseRetrievalQuery() for the intent cue check.
//
// Example: "gửi tôi thực đơn cửa hàng B" → { isRetrieval: true, searchQuery: "cửa hàng b" }
// Non-intent: "hi" / "ok" / "cảm ơn" / "mai họp nhé" → { isRetrieval: false }
// =============================================================================

import { parseRetrievalQuery } from "./retrieval-answer.service.js";

// Multi-word command/filler phrases stripped before deriving the subject term.
// Order matters: longer phrases first so they are removed before their sub-words.
const FILLER_PHRASES = [
  "gửi giúp mình", "gửi giúp tôi", "gửi cho tôi", "gửi cho mình",
  "cho tôi xem", "cho mình xem", "cho tôi", "cho mình",
  "gửi tôi", "gửi mình", "tìm lại", "tìm giúp", "tìm kiếm",
  "tra cứu", "lục lại", "thực đơn", "xem lại",
  "menu", "tìm", "lục", "xem", "giúp",
  "ảnh", "tấm hình", "hình ảnh", "hình", "tệp", "file",
];

// Single-token stopwords removed from the derived search term.
const FILLER_TOKENS = new Set([
  "tôi", "mình", "cho", "gửi", "của", "trong", "là", "và", "cái", "the", "a",
  "lại", "hãy", "giúp", "với", "ở", "tại", "về", "đi", "nhé", "ạ", "ơi", "em", "anh", "chị",
]);

export interface RetrievalIntentResult {
  isRetrieval: boolean;
  /** Short search term derived from the query (present only when isRetrieval). */
  searchQuery?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Detect a retrieval intent and derive a short search term. Returns
 * { isRetrieval: false } for chit-chat or when no meaningful subject remains.
 */
export function detectRetrievalIntent(text: string): RetrievalIntentResult {
  const parsed = parseRetrievalQuery(text);
  if (!parsed.isRetrieval) return { isRetrieval: false };

  let s = String(text ?? "").toLowerCase().normalize("NFC");
  s = s.replace(/[.,!?;:()"']/g, " ");
  for (const phrase of FILLER_PHRASES) {
    s = s.split(phrase).join(" ");
  }
  const tokens = s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !FILLER_TOKENS.has(t));

  let searchQuery = tokens.join(" ").trim();
  // Fallback to parser keywords if stripping left nothing meaningful.
  if (!searchQuery && parsed.keywords.length > 0) {
    searchQuery = parsed.keywords.join(" ");
  }
  if (!searchQuery) return { isRetrieval: false };

  return {
    isRetrieval: true,
    searchQuery,
    dateFrom: parsed.dateFrom,
    dateTo: parsed.dateTo,
  };
}
