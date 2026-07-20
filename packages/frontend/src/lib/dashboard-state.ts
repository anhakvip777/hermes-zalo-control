export type RemoteDataState<T> =
  | { status: "loading"; data: null; error: null; updatedAt: null }
  | { status: "ready"; data: T; error: null; updatedAt: string }
  | { status: "unknown"; data: null; error: string; updatedAt: null };

export function loadingState<T>(): RemoteDataState<T> {
  return { status: "loading", data: null, error: null, updatedAt: null };
}

export function readyState<T>(data: T): RemoteDataState<T> {
  return { status: "ready", data, error: null, updatedAt: new Date().toISOString() };
}

export function unknownState<T>(error: unknown, fallback: string): RemoteDataState<T> {
  return {
    status: "unknown",
    data: null,
    error: error instanceof Error ? error.message : fallback,
    updatedAt: null,
  };
}

export interface OutboundStatusInput {
  decision: string;
  reason: string;
  dryRun: boolean;
  sentMessageId: string | null;
  errorCode: string | null;
}

export type OutboundTruthStatus =
  | "DRY RUN"
  | "SENT"
  | "FAILED"
  | "PROMPT GUARD"
  | "PERM DENIED"
  | "COOLDOWN"
  | "BLOCKED"
  | "SKIPPED"
  | "UNKNOWN";

export function classifyOutboundStatus(outbound: OutboundStatusInput): OutboundTruthStatus {
  const sentMessageId = outbound.sentMessageId?.trim() || null;
  const syntheticDryRunId = sentMessageId?.startsWith("dry-run-") === true;
  const syntheticLocalId = syntheticDryRunId ||
    sentMessageId?.startsWith("sent-") === true ||
    sentMessageId?.startsWith("voice-") === true ||
    sentMessageId?.startsWith("mock-msg-") === true;
  const hasDeliveryEvidence = sentMessageId !== null && !syntheticLocalId;

  // Mutually exclusive evidence must never be rendered as a confident state.
  if ((outbound.decision === "block" || outbound.decision === "skip") && hasDeliveryEvidence) return "UNKNOWN";
  if (outbound.errorCode && hasDeliveryEvidence) return "UNKNOWN";
  if (outbound.dryRun === false && syntheticLocalId) return "UNKNOWN";
  if (outbound.dryRun === true && hasDeliveryEvidence && !syntheticDryRunId) return "UNKNOWN";

  if (outbound.reason === "prompt_guard" || outbound.reason.startsWith("prompt_echo_guard") || outbound.errorCode === "PROMPT_GUARD_BLOCK") {
    return "PROMPT GUARD";
  }
  if (outbound.reason === "permission_denied" || outbound.errorCode === "PERMISSION_DENIED") {
    return "PERM DENIED";
  }
  if (outbound.reason === "cooldown" || outbound.errorCode === "COOLDOWN") {
    return "COOLDOWN";
  }
  if (outbound.errorCode) return "FAILED";
  if (outbound.decision === "block") return "BLOCKED";
  if (outbound.decision === "skip") return "SKIPPED";
  if (outbound.dryRun === true) return "DRY RUN";
  if (outbound.dryRun === false && outbound.decision === "allow" && sentMessageId) return "SENT";
  return "UNKNOWN";
}
