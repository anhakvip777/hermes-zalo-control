import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const verificationBoundary = vi.hoisted(() => ({
  targetPath: null as string | null,
  renamed: false,
  failed: false,
  failQuarantineRename: false,
  postPublishChecks: 0,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync(from: import("node:fs").PathLike, to: import("node:fs").PathLike) {
      if (
        verificationBoundary.failQuarantineRename
        && String(from) === verificationBoundary.targetPath
        && String(to) !== verificationBoundary.targetPath
      ) {
        throw new Error("quarantine rename unavailable");
      }
      actual.renameSync(from, to);
      if (String(to) === verificationBoundary.targetPath) verificationBoundary.renamed = true;
    },
    statSync(path: import("node:fs").PathLike, options?: unknown) {
      const stats = actual.statSync(path, options as never);
      if (
        String(path) === verificationBoundary.targetPath
        && verificationBoundary.renamed
        && !verificationBoundary.failed
      ) {
        verificationBoundary.postPublishChecks += 1;
        verificationBoundary.failed = true;
        return { ...stats, size: 0 };
      }
      return stats;
    },
  };
});

import { ZaloGatewayService } from "../services/zalo-gateway.service.js";

let sessionDir: string | null = null;

afterEach(() => {
  verificationBoundary.targetPath = null;
  verificationBoundary.renamed = false;
  verificationBoundary.failed = false;
  verificationBoundary.failQuarantineRename = false;
  verificationBoundary.postPublishChecks = 0;
  vi.restoreAllMocks();
  if (sessionDir) rmSync(sessionDir, { recursive: true, force: true });
  sessionDir = null;
});

describe("Zalo staged session commit rollback", () => {
  it("does not report a fallible post-publish failure that leaves a reusable primary", () => {
    sessionDir = mkdtempSync(join(tmpdir(), "zalo-session-commit-rollback-"));
    const sessionPath = join(sessionDir, "zalo-session.json");
    const stagedPath = join(sessionDir, ".zalo-session-login-7.staged");
    writeFileSync(stagedPath, "verified-staged-session", "utf8");

    const gateway = new ZaloGatewayService();
    (gateway as any).sessionDir = sessionDir;
    const operation = { stagedSessionPath: stagedPath };
    verificationBoundary.targetPath = sessionPath;
    verificationBoundary.failQuarantineRename = true;

    expect(() => (gateway as any).commitStagedSessionOrThrow(operation)).not.toThrow();

    expect(operation.stagedSessionPath).toBeNull();
    expect(verificationBoundary.postPublishChecks).toBe(0);
    expect(existsSync(sessionPath)).toBe(true);
    expect(readFileSync(sessionPath, "utf8")).toBe("verified-staged-session");
  });
});
