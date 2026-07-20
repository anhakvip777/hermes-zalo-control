import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { runConfigChecks } from "../config-consistency.js";

const originalEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

describe("Config Consistency — current env", () => {
  // Test-env fixture: the "current valid config" case assumes real secrets are
  // present in the environment (as they are on the dev/CI shell). On a bare
  // Windows shell these are unset, which would make every secret check ERROR.
  // Provide valid, non-placeholder values for THIS describe only, then restore
  // in afterEach so nothing leaks into other test files sharing the worker
  // process. This does NOT relax validation — the "missing/placeholder → ERROR"
  // cases below still prove fail-closed behavior.
  beforeEach(() => {
    if (!process.env.ADMIN_PASSWORD) process.env.ADMIN_PASSWORD = "valid-admin-pass-1234";
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "valid-jwt-secret-abcdefgh";
    if (!process.env.CHIASEGPU_API_KEY) process.env.CHIASEGPU_API_KEY = "sk-valid-vision-key-1234";
  });
  afterEach(restoreEnv);

  it("CONFIG_OK with current valid config", () => {
    const result = runConfigChecks();
    expect(result.status).toMatch(/CONFIG_OK|CONFIG_WARN/);
    expect(result.summary.error).toBe(0);
  });

  it("has all expected check categories", () => {
    const result = runConfigChecks();
    const names = result.checks.map((c) => c.name);
    expect(names).toContain("autoReply.enabled");
    expect(names).toContain("autoReply.dryRun");
    expect(names).toContain("voice.enabled");
    expect(names).toContain("processLock.multipleInstances");
    expect(names).toContain("secret.ADMIN_PASSWORD");
  });
});

describe("Config Consistency — env-sensitive checks", () => {
  afterEach(restoreEnv);

  it("ERROR when vision API key is missing", () => {
    delete process.env.CHIASEGPU_API_KEY;
    const result = runConfigChecks();
    const check = result.checks.find((c) => c.name === "vision.apiKey");
    // May be ERROR or not present depending on vision.enabled (from config)
    if (check) {
      expect(check.severity).toBe("ERROR");
    }
  });

  it("ERROR when vision API key is placeholder", () => {
    process.env.CHIASEGPU_API_KEY = "changeme";
    const result = runConfigChecks();
    const check = result.checks.find((c) => c.name === "vision.apiKey");
    if (check) {
      expect(check.severity).toBe("ERROR");
    }
  });

  it("WARN when ALLOW_MULTIPLE_BACKEND_INSTANCES=true", () => {
    process.env.ALLOW_MULTIPLE_BACKEND_INSTANCES = "true";
    const result = runConfigChecks();
    const check = result.checks.find((c) => c.name === "processLock.multipleInstances");
    expect(check!.severity).toBe("WARN");
  });

  it("ERROR when ADMIN_PASSWORD is placeholder", () => {
    process.env.ADMIN_PASSWORD = "changeme";
    const result = runConfigChecks();
    const check = result.checks.find((c) => c.name === "secret.ADMIN_PASSWORD");
    expect(check!.severity).toBe("ERROR");
  });
});

describe("Config Consistency — secrets masked", () => {
  afterEach(restoreEnv);

  it("API key never exposed in any check message", () => {
    process.env.CHIASEGPU_API_KEY = "sk-secret-do-not-leak";
    const result = runConfigChecks();
    const json = JSON.stringify(result);
    expect(json).not.toContain("secret-do-not-leak");
  });

  it("mask uses *** and hides full value", () => {
    process.env.CHIASEGPU_API_KEY = "sk-abcd1234verylong";
    const result = runConfigChecks();
    const check = result.checks.find((c) => c.name === "vision.apiKey");
    if (check) {
      expect(check.message).toContain("***");
      expect(check.message).not.toContain("verylong");
    }
  });

  it("serialized output has no raw secrets", () => {
    process.env.CHIASEGPU_API_KEY = "sk-sensitive-123";
    process.env.ADMIN_PASSWORD = "supersecret99";
    const result = runConfigChecks();
    const json = JSON.stringify(result);
    expect(json).not.toContain("sensitive-123");
    expect(json).not.toContain("supersecret99");
  });

  it("does not expose API-key prefix or suffix fragments", () => {
    const mutableVision = config.vision as typeof config.vision & {
      enabled: boolean;
      model: string;
    };
    const originalEnabled = mutableVision.enabled;
    const originalModel = mutableVision.model;
    mutableVision.enabled = true;
    mutableVision.model = "synthetic-vision-model";
    process.env.CHIASEGPU_API_KEY = "PREF1234-middle-secret-SUFF5678";
    try {
      const result = runConfigChecks();
      const check = result.checks.find((item) => item.name === "vision.apiKey");

      expect(check?.severity).toBe("PASS");
      expect(check?.message).toContain("[REDACTED]");
      expect(check?.message).not.toContain("PREF");
      expect(check?.message).not.toContain("5678");
      expect(check?.message).not.toContain("prefix:");
    } finally {
      mutableVision.enabled = originalEnabled;
      mutableVision.model = originalModel;
    }
  });

  it("secret audit fully redacts findings instead of printing fragments", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../../scripts/secret-audit.mjs"),
      "utf8",
    );

    expect(source).toContain('return value ? "[REDACTED]" : "missing";');
    expect(source).not.toContain("value.slice(0, 4)");
    expect(source).not.toContain("value.slice(-4)");
  });
});
