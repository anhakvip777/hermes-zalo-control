// =============================================================================
// Prompt Safety Service — shared contamination detector
// =============================================================================
// Used by both:
//   1. outbound-dispatcher (echo guard — blocks sending)
//   2. conversation-context (history filter — excludes from AI context)
//
// Do NOT import any other services here to avoid circular deps.
// =============================================================================

export const PROMPT_ECHO_MARKERS = [
  "[LỊCH SỬ TRÒ CHUYỆN GẦN ĐÂY]",
  "[LỊCH SỬ TRÒ CHUYỆN]",
  "[/LỊCH SỬ]",
  "[TIN NHẮN HIỆN TẠI]",
  "[KẾT THÚC LỊCH SỬ",
  "BEGIN_CONTEXT",
  "END_CONTEXT",
  "System:",
  "Developer:",
  'Bạn vừa nói: "[LỊCH SỬ',
] as const;

/**
 * Check if a text string contains internal prompt/context markers.
 * Null-safe: falsy/empty/non-string content returns false.
 *
 * IMPORTANT: This does NOT weaken the guard — the same markers are
 * used for both blocking and filtering, and both paths use this function.
 */
export function containsPromptEchoMarker(content: unknown): boolean {
  if (typeof content !== "string") return false;
  const text = content.trim();
  if (!text) return false;
  const normalized = text.normalize();
  return PROMPT_ECHO_MARKERS.some((marker) => normalized.includes(marker));
}
