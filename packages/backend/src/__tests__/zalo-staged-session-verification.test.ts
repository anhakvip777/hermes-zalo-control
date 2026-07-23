import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const writeBoundary = vi.hoisted(() => ({
  stagedPath: null as string | null,
  corruptWrite: false,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync(path: import("node:fs").PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: unknown) {
      const output = writeBoundary.corruptWrite && String(path) === writeBoundary.stagedPath
        ? "non-empty-but-corrupted-session"
        : data;
      return actual.writeFileSync(path, output, options as never);
    },
  };
});

import { ZaloGatewayService } from "../services/zalo-gateway.service.js";

let sessionDir: string | null = null;

afterEach(() => {
  writeBoundary.stagedPath = null;
  writeBoundary.corruptWrite = false;
  vi.restoreAllMocks();
  if (sessionDir) rmSync(sessionDir, { recursive: true, force: true });
  sessionDir = null;
});

describe("Zalo staged session verification", () => {
  it("rejects a non-empty staged file whose bytes differ from the serialized session", async () => {
    sessionDir = mkdtempSync(join(tmpdir(), "zalo-staged-verification-"));
    const stagedPath = join(sessionDir, ".zalo-session-login-22.staged");
    writeBoundary.stagedPath = stagedPath;
    writeBoundary.corruptWrite = true;
    const gateway = new ZaloGatewayService();
    (gateway as any).sessionDir = sessionDir;
    (gateway as any).savedCredentials = { cookie: [{ key: "verified", value: "credential" }] };
    const operation = { generation: 22, stagedSessionPath: null };

    await expect((gateway as any).stageSessionOrThrow("login", operation, {
      selfUserId: "verified-user",
      selfDisplayName: "Verified User",
    })).rejects.toThrow("PERSIST_FAILED:Write verification failed");

    expect(operation.stagedSessionPath).toBeNull();
    expect(existsSync(stagedPath)).toBe(false);
  });
});
