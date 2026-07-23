import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const tsxCli = resolve(dirname(require.resolve("tsx/package.json")), "dist/cli.mjs");
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");

function runBlockedScript(scriptPath: string) {
  const cwd = mkdtempSync(join(tmpdir(), "hermes-zalo-login-script-"));
  const result = spawnSync(process.execPath, [tsxCli, scriptPath], {
    cwd,
    encoding: "utf8",
    timeout: 5_000,
    env: {
      ...process.env,
      NODE_ENV: "test",
      ZALO_DRY_RUN: "true",
      ZALO_AUTO_REPLY_DRY_RUN: "true",
      ZALO_SESSION_DIR: resolve(cwd, "packages", "backend", "zalo-session"),
    },
  });
  return { cwd, result };
}

describe("manual Zalo login script safety", () => {
  it.each([
    ["backend script", resolve(repoRoot, "packages/backend/scripts/zalo-login.ts"), false],
    ["root script", resolve(repoRoot, "login-run.ts"), true],
  ])("keeps zca-js and session ownership inside the gateway for the %s", (_label, scriptPath, mayDelegateToBackend) => {
    const source = readFileSync(scriptPath, "utf8");

    expect(source).not.toMatch(/(?:from\s+|import\s*\(|require\s*\()\s*["']zca-js["']/);
    expect(source).not.toMatch(/\bnew\s+Zalo\s*\(/);
    expect(source).not.toMatch(/\b(?:mkdir|mkdirSync|writeFile|writeFileSync|copyFile|copyFileSync)\b/);
    expect(source).not.toMatch(/zalo-session\.json|JSON\.stringify\s*\(/);

    const delegatesToGateway = /const\s+gateway\s*=\s*getZaloGateway\s*\(\s*\)[\s\S]*?await\s+gateway\.startLogin\s*\(\s*\)/.test(source);
    const delegatesToBackend = /import\s+["']\.\/packages\/backend\/scripts\/zalo-login(?:\.js|\.ts)?["']/.test(source);
    expect(delegatesToGateway || (mayDelegateToBackend && delegatesToBackend)).toBe(true);
  });

  it("cancels gateway-owned login work after start failure and polling timeout", () => {
    const source = readFileSync(resolve(repoRoot, "packages/backend/scripts/zalo-login.ts"), "utf8");

    expect(source).toMatch(/catch\s*\(error: unknown\)[\s\S]*?await\s+gateway\.cancelLogin\s*\(\s*\)/);
    expect(source).toMatch(/if\s*\(!TERMINAL_STATUSES\.has\(status\.connectionStatus\)\)[\s\S]*?await\s+gateway\.cancelLogin\s*\(\s*\)/);
    expect([...source.matchAll(/await\s+gateway\.cancelLogin\s*\(\s*\)/g)]).toHaveLength(2);
  });

  it.each([
    ["backend script", resolve(repoRoot, "packages/backend/scripts/zalo-login.ts")],
    ["root script", resolve(repoRoot, "login-run.ts")],
  ])("blocks the %s before creating any standard session directory", (_label, scriptPath) => {
    const { cwd, result } = runBlockedScript(scriptPath);
    try {
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain("LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED");
      expect(existsSync(resolve(cwd, "zalo-session"))).toBe(false);
      expect(existsSync(resolve(cwd, "packages", "backend", "zalo-session"))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
