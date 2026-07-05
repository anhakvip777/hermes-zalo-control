// =============================================================================
// Tool Gateway — central redaction / masking layer (Phase 1)
// =============================================================================
// Masks secrets before results/args are persisted OR returned to the agent/UI.
// Deep-walks objects/arrays/strings. Shared with the Phase 7 trace UI so the
// masked forms are computed once.
//
// Masks:
//   - keys named like token/secret/cookie/session/password/authorization/apikey/imei
//   - `sk-...` API keys (OpenAI-style, incl. sk-proj-/sk-ant-), alphanumeric bodies
//   - `label: value` / `label=value` secret assignments (api key / token / secret / password)
//   - JWT-like, `Bearer …`, long hex, and long high-entropy alphanumeric blobs in string values
//   - phone numbers (unless the caller says the role may see them)
// =============================================================================

const SECRET_KEY_PATTERN =
  /(pass(word)?|secret|token|cookie|session|authorization|auth|api[-_]?key|bearer|imei|credential|private[-_]?key|jwt|jwe)/i;

// `sk-` API keys (OpenAI/Anthropic style). Body is alphanumeric + _-, ≥16 chars,
// so it catches keys that are NOT pure hex (which LONG_HEX_PATTERN would miss).
// Covers sk-, sk-proj-, sk-ant-, sk-live-, sk-test- because `-` is in the class.
const SK_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{16,}\b/g;

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;
const LONG_HEX_PATTERN = /\b[0-9a-fA-F]{32,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi;
// Inline secret assignment in free text: a secret-ish label followed by : or =
// then the value. Keeps the label, masks the value. e.g. "api_key: abc123" →
// "api_key: [REDACTED]". The `is`/`=`/`:` separators are common in pasted creds.
const ASSIGNMENT_SECRET_PATTERN =
  /\b(api[-_ ]?key|apikey|access[-_ ]?token|refresh[-_ ]?token|token|secret|password|passwd|pwd|credential)\b(\s*[:=]\s*)("?)([^\s"']{4,})\3/gi;
// Long high-entropy alphanumeric/url-safe blob (base64/base64url/token-like) that
// isn't caught by the more specific patterns. Threshold 40 avoids masking normal
// words, short IDs, and typical Vietnamese text (which is spaced and short-token).
const HIGH_ENTROPY_PATTERN = /\b[A-Za-z0-9_-]{40,}\b/g;
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
  // Order: specific → generic. Specific patterns collapse to the short [REDACTED]
  // marker, which is neither long-hex nor 40+ chars, so later passes and re-runs
  // (idempotency) leave it untouched.
  let out = value
    .replace(SK_KEY_PATTERN, REDACTED)
    .replace(JWT_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, REDACTED)
    .replace(ASSIGNMENT_SECRET_PATTERN, (_m, label, sep) => `${label}${sep}${REDACTED}`)
    .replace(LONG_HEX_PATTERN, REDACTED)
    .replace(HIGH_ENTROPY_PATTERN, REDACTED);
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
