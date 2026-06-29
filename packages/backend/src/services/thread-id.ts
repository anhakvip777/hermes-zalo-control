// =============================================================================
// Thread ID Normalization — defensive helpers for threadId handling
// =============================================================================
//
// All thread IDs MUST remain strings. Zalo uses 18-digit numeric strings
// (e.g. "6792540503378312397") for both inbound events and outbound sends.
//
// DO NOT:
//   - parseInt(threadId) or Number(threadId) — precision loss for 18-digit IDs
//   - .slice() / .substring() — truncation corrupts the ID
//   - Assume short IDs are aliases for long IDs without evidence
//
// These helpers are defensive: they protect against accidental type coercion,
// whitespace, and empty inputs at system boundaries.
// =============================================================================

/**
 * Normalize a threadId value to a safe string.
 *
 * - Converts to string (defense against number input from JSON)
 * - Trims whitespace
 * - Does NOT truncate, parse, or mutate the ID
 *
 * Returns empty string if input is null/undefined/empty.
 * Use `assertValidThreadId()` when empty is not acceptable.
 */
export function normalizeThreadId(input: unknown): string {
  return String(input ?? "").trim();
}

/**
 * Assert that a threadId is valid (non-empty after normalization).
 *
 * Returns the normalized threadId string.
 * Throws if the threadId is empty, null, or undefined.
 *
 * Use this at API boundaries where a missing threadId indicates a bad request.
 */
export function assertValidThreadId(input: unknown): string {
  const threadId = normalizeThreadId(input);
  if (!threadId) {
    throw new Error("threadId is required");
  }
  return threadId;
}
