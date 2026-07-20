import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(TEST_DIR, "..", "..");
const REPO_ROOT = resolve(BACKEND_DIR, "..", "..");
const SCRIPT = join(BACKEND_DIR, "scripts", "config-check-strict.mjs");

const safeEnv = (overrides: Record<string, string> = {}) => ({
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: "file:C:/tmp/hermes-config-check-nonexistent.db",
  SYSTEM_BACKUP_ROOT: "C:/tmp/hermes-config-check-system",
  DB_BACKUP_DIR: "C:/tmp/hermes-config-check-db",
  ZALO_SESSION_DIR: "C:/tmp/hermes-config-check-session",
  ZALO_AUTO_REPLY_ENABLED: "false",
  ZALO_AUTO_REPLY_DRY_RUN: "true",
  ZALO_VISION_ENABLED: "false",
  ZALO_VOICE_ENABLED: "false",
  ADMIN_PASSWORD: "config-check-test-password",
  JWT_SECRET: "config-check-test-jwt-secret",
  COOKIE_SECRET: "config-check-test-cookie-secret",
  CHIASEGPU_API_KEY: "config-check-test-vision-key",
  STRICT_CONFIG_CHECK: "true",
  ...overrides,
});

function runChecker(env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: BACKEND_DIR,
    env: safeEnv(env),
    encoding: "utf8",
    timeout: 30_000,
  });
}

describe("config:check:strict portable CLI", () => {
  it("executes the strict checker and forwards a successful exit code", () => {
    expect(existsSync(SCRIPT)).toBe(true);

    const result = runChecker();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[config-check] Status:");
  });

  it("returns 1 and reports the strict block for placeholder secrets", () => {
    const result = runChecker({
      ADMIN_PASSWORD: "change-me",
      JWT_SECRET: "placeholder",
      CHIASEGPU_API_KEY: "xxx",
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("[config-check] Status: CONFIG_ERROR");
    expect(output).toContain("STRICT_CONFIG_CHECK=true and config has ERROR-level issues");
  });

  it("runs through npm without POSIX shell syntax on Windows or POSIX", () => {
    const isWindows = process.platform === "win32";
    const npm = isWindows ? process.env.ComSpec || "cmd.exe" : "npm";
    const npmArgs = isWindows
      ? ["/d", "/s", "/c", "npm.cmd run config:check:strict -w packages/backend"]
      : ["run", "config:check:strict", "-w", "packages/backend"];
    const result = spawnSync(npm, npmArgs, {
      cwd: REPO_ROOT,
      env: safeEnv(),
      encoding: "utf8",
      timeout: 30_000,
      shell: false,
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toContain("[config-check] Status:");
    expect(output.toLowerCase()).not.toContain("not recognized");
  });
});
