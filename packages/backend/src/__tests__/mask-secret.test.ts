import { describe, it, expect } from "vitest";
import { maskSecret, isPlaceholder, maskObjectSecrets, safeJsonStringify } from "../utils/mask-secret.js";

describe("maskSecret", () => {
  it("masks full key to prefix***suffix", () => {
    const result = maskSecret("sk-abcd1234verylongkey99");
    expect(result).toBe("sk-a***ey99");
    expect(result).not.toContain("abcd1234");
    expect(result).not.toContain("verylongkey");
  });

  it("returns 'missing' for empty/undefined", () => {
    expect(maskSecret("")).toBe("missing");
    expect(maskSecret(undefined)).toBe("missing");
  });

  it("returns '***' for short values", () => {
    expect(maskSecret("ab")).toBe("***");
    expect(maskSecret("12345678")).toBe("***");
  });

  it("handles API key pattern correctly", () => {
    const result = maskSecret("sk-or-v1-abcdefghijklmnopqrstuvwxyz123456");
    expect(result.startsWith("sk-o")).toBe(true);
    expect(result.endsWith("3456")).toBe(true);
    expect(result).toContain("***");
  });
});

describe("isPlaceholder", () => {
  it("detects changeme", () => {
    expect(isPlaceholder("changeme")).toBe(true);
    expect(isPlaceholder("CHANGEME")).toBe(true);
  });

  it("detects fake/example/dummy", () => {
    expect(isPlaceholder("fake-key")).toBe(true);
    expect(isPlaceholder("example-token")).toBe(true);
    expect(isPlaceholder("dummy-value")).toBe(true);
  });

  it("detects dev-admin-password", () => {
    expect(isPlaceholder("dev-admin-password")).toBe(true);
  });

  it("returns false for real-looking values", () => {
    expect(isPlaceholder("sk-realproductionkey1234567890")).toBe(false);
    expect(isPlaceholder("MyStr0ngP@ss!")).toBe(false);
  });

  it("empty/undefined is placeholder", () => {
    expect(isPlaceholder("")).toBe(true);
    expect(isPlaceholder(undefined)).toBe(true);
  });
});

describe("maskObjectSecrets", () => {
  it("masks sensitive keys in flat object", () => {
    const obj = {
      name: "test",
      apiKey: "sk-secret-key-12345",
      password: "mypassword",
      token: "bearer-token-abc",
      normal: "visible",
    };
    const result = maskObjectSecrets(obj) as Record<string, unknown>;
    expect(result.name).toBe("test");
    expect(result.normal).toBe("visible");
    expect(result.apiKey).not.toBe("sk-secret-key-12345");
    expect(result.apiKey).toContain("***");
    expect(result.password).toContain("***");
    expect(result.token).toContain("***");
  });

  it("masks nested sensitive keys", () => {
    const obj = {
      config: {
        api_key: "nested-secret-here-abcdef",
        timeout: 5000,
      },
      auth: {
        session: "session-data-abcdefghijklmno",
      },
    };
    const result = maskObjectSecrets(obj) as Record<string, unknown>;
    const cfg = result.config as Record<string, unknown>;
    expect(cfg.api_key).toContain("***");
    expect(cfg.timeout).toBe(5000);
    const auth = result.auth as Record<string, unknown>;
    expect(auth.session).toContain("***");
  });

  it("handles arrays", () => {
    const arr = [
      { apiKey: "secret1-abcdefghijklmnop", name: "a" },
      { apiKey: "secret2-abcdefghijklmnop", name: "b" },
    ];
    const result = maskObjectSecrets(arr) as Record<string, unknown>[];
    expect(result[0]!.apiKey).toContain("***");
    expect(result[1]!.apiKey).toContain("***");
    expect(result[0]!.name).toBe("a");
  });

  it("returns primitives as-is", () => {
    expect(maskObjectSecrets("hello")).toBe("hello");
    expect(maskObjectSecrets(42)).toBe(42);
    expect(maskObjectSecrets(null)).toBe(null);
    expect(maskObjectSecrets(undefined)).toBe(undefined);
  });
});

describe("safeJsonStringify", () => {
  it("stringifies with secrets masked", () => {
    const obj = { apiKey: "sk-sensitive-value-here-1234", name: "test" };
    const json = safeJsonStringify(obj);
    expect(json).not.toContain("sk-sensitive-value-here-1234");
    expect(json).toContain("***");
    expect(json).toContain("test");
  });
});
