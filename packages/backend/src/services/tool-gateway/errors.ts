// =============================================================================
// Tool Gateway — standard error shape + factories (Phase 1)
// =============================================================================
// Errors are NEVER thrown across the gateway boundary. The gateway maps a
// ToolError to an AgentToolResult with the correct executionStatus.
// =============================================================================

import type { ExecutionStatus, ToolErrorCode, ToolErrorShape } from "./types.js";

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly detail?: unknown;
  readonly retryable: boolean;

  constructor(code: ToolErrorCode, message: string, opts?: { detail?: unknown; retryable?: boolean }) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.detail = opts?.detail;
    this.retryable = opts?.retryable ?? (code === "provider_error" || code === "timeout");
  }

  toShape(): ToolErrorShape {
    return { code: this.code, message: this.message, detail: this.detail, retryable: this.retryable };
  }
}

// ── Factories ─────────────────────────────────────────────────────────
export const toolErrors = {
  blocked: (message: string, detail?: unknown) => new ToolError("blocked", message, { detail, retryable: false }),
  unavailable: (message: string, detail?: unknown) => new ToolError("unavailable", message, { detail, retryable: false }),
  invalidArgs: (message: string, detail?: unknown) => new ToolError("invalid_args", message, { detail, retryable: false }),
  providerError: (message: string, detail?: unknown) => new ToolError("provider_error", message, { detail, retryable: true }),
  timeout: (message: string, detail?: unknown) => new ToolError("timeout", message, { detail, retryable: true }),
  dryRun: (message: string, detail?: unknown) => new ToolError("dry_run", message, { detail, retryable: false }),
};

/**
 * Map an error code to the terminal executionStatus.
 * - unavailable → unavailable
 * - blocked / invalid_args → blocked
 * - provider_error / timeout → failed
 * - dry_run → success (it's a correctly-gated outcome, not a failure)
 */
export function executionStatusForError(code: ToolErrorCode): ExecutionStatus {
  switch (code) {
    case "unavailable":
      return "unavailable";
    case "blocked":
    case "invalid_args":
      return "blocked";
    case "provider_error":
    case "timeout":
      return "failed";
    case "dry_run":
      return "success";
    default:
      return "failed";
  }
}
