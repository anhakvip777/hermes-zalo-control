// =============================================================================
// Tool Gateway — zod validation helpers (Phase 1)
// =============================================================================
// Validates args before execution and normalizes/validates results after.
// A failed validation becomes a ToolError("invalid_args") — never a raw throw
// across the gateway boundary.
// =============================================================================

import type { z } from "zod";
import { toolErrors } from "./errors.js";

/** Compact a ZodError into a small, redaction-friendly issue list. */
function summarizeZodIssues(err: unknown): Array<{ path: string; message: string }> {
  const zerr = err as { issues?: Array<{ path?: (string | number)[]; message?: string }> };
  if (!zerr?.issues) return [{ path: "", message: "invalid" }];
  return zerr.issues.slice(0, 10).map((i) => ({
    path: Array.isArray(i.path) ? i.path.join(".") : "",
    message: i.message ?? "invalid",
  }));
}

/**
 * Validate agent-supplied args. Throws ToolError("invalid_args") on failure so
 * the gateway records (blocked, not_applicable) and skips execution.
 */
export function validateArgs<T>(schema: z.ZodType<T>, args: unknown): T {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw toolErrors.invalidArgs("Tool arguments failed schema validation", summarizeZodIssues(parsed.error));
  }
  return parsed.data;
}

/**
 * Validate a tool's result. A malformed result is a provider_error (the tool
 * misbehaved), not an invalid_args (which is the agent's fault).
 */
export function validateResult<T>(schema: z.ZodType<T>, result: unknown): T {
  const parsed = schema.safeParse(result);
  if (!parsed.success) {
    throw toolErrors.providerError("Tool result failed schema validation", summarizeZodIssues(parsed.error));
  }
  return parsed.data;
}
