import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const zcaBoundary = vi.hoisted(() => {
  const api = {
    getOwnId: () => "late-error-user",
    getOwnName: () => "Late Error User",
  };

  class FakeZalo {
    loginQR(_options: unknown, callback: (event: unknown) => void) {
      callback({
        type: 2,
        data: {
          cookie: [{ key: "late-error", value: "credential" }],
          imei: "late-error-imei",
          userAgent: "late-error-agent",
        },
      });
      return Promise.resolve(api);
    }
  }

  const projectRequire = vi.fn((moduleId: string) => {
    if (moduleId !== "zca-js") throw new Error(`Unexpected module: ${moduleId}`);
    return { Zalo: FakeZalo };
  });

  return {
    api,
    projectRequire,
    createRequire: vi.fn(() => projectRequire),
  };
});

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return { ...actual, createRequire: zcaBoundary.createRequire };
});

import { ZaloGatewayService } from "../services/zalo-gateway.service.js";

let sessionDir: string | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  zcaBoundary.projectRequire.mockClear();
  if (sessionDir) rmSync(sessionDir, { recursive: true, force: true });
  sessionDir = null;
});

describe("Zalo QR late error rollback", () => {
  it("restores the operation snapshot when background login fails after API and credentials assignment", async () => {
    sessionDir = mkdtempSync(join(tmpdir(), "zalo-login-error-rollback-"));
    const gateway = new ZaloGatewayService();
    (gateway as any).sessionDir = sessionDir;
    const originalStatus = { ...(gateway as any).status };
    (gateway as any).loginInProgress = true;
    (gateway as any).loginGeneration = 21;
    (gateway as any).activeLoginGeneration = 21;
    (gateway as any).activeLoginOperation = {
      generation: 21,
      status: originalStatus,
      api: null,
      zalo: null,
      savedCredentials: null,
      listenerActive: false,
      listenerBindings: null,
      lastListenerBeatAt: null,
      stagedSessionPath: null,
    };
    vi.spyOn(gateway, "getLoginSafetyDecision").mockReturnValue({ allowed: true, reason: null });
    vi.spyOn(gateway as any, "onLoginSuccess").mockRejectedValue(new Error("late login failure"));
    vi.spyOn(gateway as any, "scheduleReconnect").mockImplementation(() => {});

    await (gateway as any).runLoginInBackground(21);

    expect(zcaBoundary.projectRequire).toHaveBeenCalledWith("zca-js");
    expect(gateway.getApi()).toBeNull();
    expect((gateway as any).zalo).toBeNull();
    expect((gateway as any).savedCredentials).toBeNull();
    expect((gateway as any).activeLoginGeneration).toBeNull();
    expect((gateway as any).activeLoginOperation).toBeNull();
    expect(gateway.getStatus()).toMatchObject({
      connected: false,
      connectionStatus: "error",
      lastError: "late login failure",
    });
  });
});
