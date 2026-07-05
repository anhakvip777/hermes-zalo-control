// =============================================================================
// Tool Gateway — idempotency key derivation (Phase 1, pure helpers)
// =============================================================================
// Pure, deterministic key derivation. No runtime wiring, no provider. Phase 2
// reaction/poll paths reuse deriveZaloActionIdempotencyKey so a duplicate
// listener/auto-react/action collapses to one ZaloActionRecord.
// =============================================================================

import { createHash } from "node:crypto";

export interface ZaloActionKeyInput {
  actionType: string; // reaction | poll | ...
  threadId: string;
  targetMsgId?: string | null;
  /** Already-redacted payload JSON string (never raw secrets). */
  payloadRedacted?: string | null;
}

/**
 * Derive a ZaloActionRecord idempotency key from:
 *   actionType + threadId + targetMsgId + payloadRedacted
 * Deterministic sha256 hex. Same inputs → same key (dedupes duplicate actions);
 * any field change → different key.
 */
export function deriveZaloActionIdempotencyKey(input: ZaloActionKeyInput): string {
  return createHash("sha256")
    .update(
      [
        input.actionType,
        input.threadId,
        input.targetMsgId ?? "",
        input.payloadRedacted ?? "",
      ].join("|"),
    )
    .digest("hex");
}
