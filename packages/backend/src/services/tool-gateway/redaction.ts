// =============================================================================
// Tool Gateway — central redaction / masking layer (Phase 1)
// =============================================================================
// Masks secrets before results/args are persisted OR returned to the agent/UI.
// Deep-walks objects/arrays/strings. Shared with the Phase 7 trace UI so the
// masked forms are computed once.
//
// Masks:
//   - keys named like token/secret/cookie/session/password/authorization/apikey/imei
//   - JWT-like and long hex/base64 blobs in string values
//   - phone numbers (unless the caller says the role may see them)
// =============================================================================

const SECRET_KEY_PATTERN =
  /(pass(word)?|secret|token|cookie|session|authorization|auth|api[-_]?key|bearer|imei|credential|private[-_]?key|jwt|jwe)/i;

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;
const LONG_HEX_PATTERN = /\b[0-9a-fA-F]{32,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi;
// VN + generic phone: optional +, 8-15 digits, optional separators.
const PHONE_PATTERN = /(?<!\d)(\+?\d[\d\s.-]{7,13}\d)(?!\d)/g;

export const REDACTED = "[REDACTED]";

export interface RedactionOptions {
  /** When true, phone numbers are left intact (role permits). Default false. */
  allowPhone?: boolean;
  /** Max recursion depth guard. */
  maxDepth?: number;
}

function maskString(value: string, allowPhone: boolean): string {
  let out = value
    .replace(JWT_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, REDACTED)
    .replace(LONG_HEX_PATTERN, REDACTED);
  if (!allowPhone) {
    out = out.replace(PHONE_PATTERN, (m) => maskPhone(m));
  }
  return out;
}

function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return raw;
  const last = digits.slice(-2);
  return `${REDACTED}${last}`;
}

/**
 * Recursively redact a value. Returns a NEW value (does not mutate input).
 */
export function redact(value: unknown, opts: RedactionOptions = {}, depth = 0): unknown {
  const allowPhone = opts.allowPhone ?? false;
  const maxDepth = opts.maxDepth ?? 8;
  if (depth > maxDepth) return REDACTED;

  if (value == null) return value;
  if (typeof value === "string") return maskString(value, allowPhone);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, opts, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redact(v, opts, depth + 1);
      }
    }
    return out;
  }

  // functions, symbols, bigint → drop to a safe marker
  return REDACTED;
}

/**
 * Redact + JSON.stringify for DB storage. Returns null for null/undefined input.
 * Never throws — falls back to a marker on circular/serialization errors.
 */
export function redactToJson(value: unknown, opts: RedactionOptions = {}): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(redact(value, opts));
  } catch {
    return JSON.stringify({ _redaction: "unserializable" });
  }
}
