import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cleanupBoundary = vi.hoisted(() => ({
  stagedPath: null as string | null,
  failUnlink: false,
  failRename: false,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    unlinkSync(path: import("node:fs").PathLike) {
      if (cleanupBoundary.failUnlink && String(path) === cleanupBoundary.stagedPath) {
        throw new Error("staged unlink unavailable");
      }
      return actual.unlinkSync(path);
    },
    renameSync(from: import("node:fs").PathLike, to: import("node:fs").PathLike) {
      if (cleanupBoundary.failRename && String(from) === cleanupBoundary.stagedPath) {
        throw new Error("staged quarantine unavailable");
      }
      return actual.renameSync(from, to);
    },
  };
});

import { ZaloGatewayService } from "../services/zalo-gateway.service.js";

let sessionDir: string | null = null;

afterEach(() => {
  cleanupBoundary.stagedPath = null;
  cleanupBoundary.failUnlink = false;
  cleanupBoundary.failRename = false;
  vi.restoreAllMocks();
  if (sessionDir) rmSync(sessionDir, { recursive: true, force: true });
  sessionDir = null;
});

describe("Zalo staged session cleanup", () => {
  it("quarantines a staged credential file before clearing ownership when unlink fails", () => {
    sessionDir = mkdtempSync(join(tmpdir(), "zalo-staged-cleanup-"));
    const stagedPath = join(sessionDir, ".zalo-session-login-5.staged");
    writeFileSync(stagedPath, "sensitive-staged-credentials", "utf8");
    cleanupBoundary.stagedPath = stagedPath;
    cleanupBoundary.failUnlink = true;
    const gateway = new ZaloGatewayService();
    const operation = { stagedSessionPath: stagedPath };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    (gateway as any).removeStagedSession(operation);

    expect(operation.stagedSessionPath).toBeNull();
    expect(existsSync(stagedPath)).toBe(false);
    expect(readdirSync(sessionDir).some((name) => name.includes("cleanup-failed"))).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("staged session cleanup quarantined"));
  });

  it("retains tracked ownership when both staged cleanup and quarantine fail", () => {
    sessionDir = mkdtempSync(join(tmpdir(), "zalo-staged-cleanup-"));
    const stagedPath = join(sessionDir, ".zalo-session-login-6.staged");
    writeFileSync(stagedPath, "sensitive-staged-credentials", "utf8");
    cleanupBoundary.stagedPath = stagedPath;
    cleanupBoundary.failUnlink = true;
    cleanupBoundary.failRename = true;
    const gateway = new ZaloGatewayService();
    const operation = { generation: 6, stagedSessionPath: stagedPath };
    (gateway as any).loginInProgress = true;
    (gateway as any).loginGeneration = 6;
    (gateway as any).activeLoginGeneration = 6;
    (gateway as any).activeLoginOperation = operation;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    (gateway as any).invalidateActiveLogin();

    expect((gateway as any).loginInProgress).toBe(false);
    expect((gateway as any).activeLoginGeneration).toBeNull();
    expect((gateway as any).activeLoginOperation).toBe(operation);
    expect(operation.stagedSessionPath).toBe(stagedPath);
    expect(existsSync(stagedPath)).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("staged session cleanup failed"));
  });
});
