/**
 * Secret Masking Utility — safe masking cho logs, API responses, error messages.
 *
 * Không bao giờ log raw API key, password, token, cookie, session.
 */

/** Mask a single value: "sk-abcd1234verylong" → "sk-a***long" */
export function maskSecret(value: string | undefined): string {
  if (!value) return "missing";
  if (value.length <= 8) return "***";
  return value.slice(0, 4) + "***" + value.slice(-4);
}

/** Check if a value looks like a placeholder (safe to expose). */
export function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const lower = value.toLowerCase();
  return (
    lower.includes("changeme") ||
    lower.includes("change-me") ||
    lower === "xxx" ||
    lower === "test" ||
    lower === "placeholder" ||
    lower.includes("fake") ||
    lower.includes("example") ||
    lower.includes("dummy") ||
    lower.includes("not-secure") ||
    lower.includes("your-key") ||
    lower === "dev-admin-password"
  );
}

const SENSITIVE_KEY_PATTERNS = [
  /key/i,
  /secret/i,
  /password/i,
  /token/i,
  /cookie/i,
  /session/i,
  /authorization/i,
  /credential/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(key));
}

/**
 * Recursively mask all sensitive values in an object.
 * Keys matching "key", "secret", "password", "token", "cookie", "session", "authorization", "credential"
 * will have their values replaced with masked versions.
 */
export function maskObjectSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj; // primitive strings not masked — only object keys
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => maskObjectSecrets(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      if (typeof value === "string") {
        result[key] = isPlaceholder(value) ? value : maskSecret(value);
      } else if (value && typeof value === "object") {
        result[key] = maskObjectSecrets(value);
      } else {
        result[key] = value;
      }
    } else if (value && typeof value === "object") {
      result[key] = maskObjectSecrets(value);
    } else if (typeof value === "string" && isSensitiveKey(key)) {
      result[key] = maskSecret(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Safe stringify — masks secrets in the object before serializing.
 */
export function safeJsonStringify(obj: unknown, space?: number): string {
  return JSON.stringify(maskObjectSecrets(obj), null, space);
}
