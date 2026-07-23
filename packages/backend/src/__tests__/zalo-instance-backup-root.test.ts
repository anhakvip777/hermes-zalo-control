import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { config } from "../config.js";
import { ZaloGatewayService } from "../services/zalo-gateway.service.js";

let workspaceRoot: string | null = null;

function sessionFilesBelow(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...sessionFilesBelow(path));
    else if (entry.name === "zalo-session.json") files.push(path);
  }
  return files;
}

afterEach(() => {
  vi.restoreAllMocks();
  if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true });
  workspaceRoot = null;
});

describe("Zalo per-instance session backup root", () => {
  it("persists a successful QR session and backup only beside the instance sessionDir", async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "zalo-instance-backup-"));
    const sessionDir = join(workspaceRoot, "zalo-session");
    const primaryPath = join(sessionDir, "zalo-session.json");
    const localBackupRoot = join(workspaceRoot, "backups", "db");
    const globalBackupRoot = resolve(config.zalo.sessionDir, "..", "backups", "db");
    expect(resolve(localBackupRoot)).not.toBe(resolve(globalBackupRoot));

    const marker = `instance-only-${Date.now()}-${Math.random()}`;
    class Listener extends EventEmitter {
      start = vi.fn(async () => {});
      stop = vi.fn(async () => {});
    }
    const listener = new Listener();
    const gateway = new ZaloGatewayService();
    (gateway as any).sessionDir = sessionDir;
    (gateway as any).loginInProgress = true;
    (gateway as any).loginGeneration = 61;
    (gateway as any).activeLoginGeneration = 61;
    (gateway as any).activeLoginOperation = {
      generation: 61,
      status: { ...(gateway as any).status },
      api: null,
      zalo: null,
      savedCredentials: null,
      listenerActive: false,
      listenerBindings: null,
      lastListenerBeatAt: null,
      stagedSessionPath: null,
    };
    const api = {
      listener,
      getOwnId: () => "instance-user",
      getOwnName: () => "Instance User",
    };
    const zalo = { source: "qr" };
    const credentials = {
      cookie: [{ key: "instance", value: marker }],
      imei: "instance-imei",
    };
    vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });

    await (gateway as any).onLoginSuccess(61, { zalo, api, credentials });

    expect(gateway.getStatus()).toMatchObject({ connected: true, connectionStatus: "connected" });
    expect(existsSync(primaryPath)).toBe(true);
    const localBackups = sessionFilesBelow(localBackupRoot);
    expect(localBackups).toHaveLength(1);
    expect(readFileSync(localBackups[0], "utf8")).toBe(readFileSync(primaryPath, "utf8"));
    const leakedToGlobalRoot = sessionFilesBelow(globalBackupRoot)
      .some((path) => readFileSync(path, "utf8").includes(marker));
    expect(leakedToGlobalRoot).toBe(false);

    await (gateway as any).stopListener();
  });
});
