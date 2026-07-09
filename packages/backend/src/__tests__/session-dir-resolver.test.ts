import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { resolveSessionDir } from "../config.js";

// The resolver is intentionally pure: it derives the session dir from pkgRoot
// (packages/backend, from import.meta.url) + the optional ZALO_SESSION_DIR env,
// and NEVER reads process.cwd(). These tests pin that determinism — the bug we
// fixed was the old default resolving against cwd, which doubled the path to
// packages/backend/packages/backend/zalo-session under `npm run -w`.

const PKG_ROOT = resolve("/repo", "packages", "backend");

describe("resolveSessionDir — deterministic session path", () => {
  it("default → <pkgRoot>/zalo-session (no env override)", () => {
    expect(resolveSessionDir(PKG_ROOT)).toBe(resolve(PKG_ROOT, "zalo-session"));
  });

  it("default is identical regardless of process.cwd() (pure, cwd-independent)", () => {
    const before = resolveSessionDir(PKG_ROOT);
    const savedCwd = process.cwd;
    try {
      // Simulate running from repo root vs from packages/backend — the result
      // must not change, because the resolver does not consult cwd at all.
      (process as { cwd: () => string }).cwd = () => "/repo";
      const fromRoot = resolveSessionDir(PKG_ROOT);
      (process as { cwd: () => string }).cwd = () => "/repo/packages/backend";
      const fromPkg = resolveSessionDir(PKG_ROOT);
      expect(fromRoot).toBe(before);
      expect(fromPkg).toBe(before);
    } finally {
      process.cwd = savedCwd;
    }
  });

  it("absolute ZALO_SESSION_DIR wins (used as-is)", () => {
    const abs = resolve("/custom", "zalo-sess");
    expect(resolveSessionDir(PKG_ROOT, abs)).toBe(abs);
  });

  it("relative ZALO_SESSION_DIR resolves against pkgRoot (NOT cwd)", () => {
    expect(resolveSessionDir(PKG_ROOT, "./zalo-session")).toBe(resolve(PKG_ROOT, "zalo-session"));
    expect(resolveSessionDir(PKG_ROOT, "custom-sess")).toBe(resolve(PKG_ROOT, "custom-sess"));
  });

  it("empty / whitespace env value falls back to default", () => {
    expect(resolveSessionDir(PKG_ROOT, "")).toBe(resolve(PKG_ROOT, "zalo-session"));
    expect(resolveSessionDir(PKG_ROOT, "   ")).toBe(resolve(PKG_ROOT, "zalo-session"));
  });
});
