import { z } from "zod";

import type { AgentResponse } from "./types.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Protocol-level hard cap, independent of AgentBridge's configurable per-round limit. */
export const MAX_AGENT_TOOL_CALLS = 5;

/** Prevent provider-controlled safety diagnostics from inflating fallback reasons. */
export const MAX_AGENT_SAFETY_REASON_LENGTH = 256;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.every((item) => isJsonValue(item, ancestors));
    }
    if (!isPlainObject(value)) return false;
    return Object.values(value).every((item) => isJsonValue(item, ancestors));
  } finally {
    ancestors.delete(value);
  }
}

const plainJsonObjectSchema = z.custom<Record<string, JsonValue>>(
  (value) => isPlainObject(value) && isJsonValue(value),
  { message: "Expected a plain JSON object" },
);

const toolCallSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    arguments: plainJsonObjectSchema.optional(),
    idempotencyKey: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

const toolCallsSchema = z
  .array(toolCallSchema)
  .max(MAX_AGENT_TOOL_CALLS)
  .superRefine((calls, ctx) => {
    const seen = new Set<string>();
    calls.forEach((call, index) => {
      const key = call.idempotencyKey;
      if (!key) return;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "idempotencyKey"],
          message: "Duplicate tool-call idempotencyKey",
        });
      }
      seen.add(key);
    });
  });

const safetySchema = z
  .object({
    blocked: z.boolean().optional(),
    reason: z.string().trim().max(MAX_AGENT_SAFETY_REASON_LENGTH).optional(),
  })
  .strict();

const responseObjectSchema = z
  .object({
    text: z.string().trim().max(2_000).optional(),
    toolCalls: toolCallsSchema.optional(),
    confidence: z.number().finite().min(0).max(1).optional(),
    safety: safetySchema.optional(),
  })
  .strict();

export const agentResponseSchema = z
  .custom<Record<string, unknown>>(isPlainObject, { message: "Expected a plain object" })
  .pipe(responseObjectSchema);

/** Parse the untrusted adapter value before any bridge logic reads it. */
export function parseAgentResponse(value: unknown): AgentResponse {
  return agentResponseSchema.parse(value);
}
