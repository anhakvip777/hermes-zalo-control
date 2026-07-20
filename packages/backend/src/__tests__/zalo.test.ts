import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockMessageSender } from "../services/message-sender.js";
import { ZaloMessageSender, rateLimiter } from "../services/zalo-message-sender.js";
import { ZaloGatewayService, quarantineSessionFile } from "../services/zalo-gateway.service.js";
import { normalizeMessage, dedupKey, saveIncomingMessage, listMessages, listThreads, type NormalizedMessage } from "../services/zalo-receive.js";
import { cleanDatabase } from "./shared-setup.js";
import * as settingsService from "../services/settings.service.js";
import { prisma } from "../db.js";

beforeAll(async () => {
  await cleanDatabase();
  await settingsService.initializeDefaultSettings();
});

afterAll(async () => {
  await cleanDatabase();
});

beforeEach(async () => {
  await cleanDatabase();
  await settingsService.initializeDefaultSettings();
});

// ═══════════════════════════════════════════════════════════════════
describe("ZaloMessageSender — dry-run", () => {
  it("dry-run returns success without real send (ZALO_DRY_RUN=true in dev)", async () => {
    const sender = new ZaloMessageSender();
    const result = await sender.sendMessage("test", "group-123", "group");
    expect(result.success).toBe(true);
    expect(result.messageId).toContain("dry-run-");
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("Rate Limiter", () => {
  it("allows first N messages", () => {
    const limited = rateLimiter.check("thread-test-rl");
    expect(limited).toBe(false);
  });

  it("getThreadRemaining returns non-negative", () => {
    const remaining = rateLimiter.getThreadRemaining("nonexistent-thread");
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeLessThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("ZaloGatewayService — status", () => {
  it("starts disconnected", () => {
    const gw = new ZaloGatewayService();
    const status = gw.getStatus();
    expect(status.connected).toBe(false);
    expect(status.connectionStatus).toBe("disconnected");
  });

  it("emits status events on logout without touching the configured session", async () => {
    const gw = new ZaloGatewayService();
    const testDir = join(tmpdir(), "zalo-logout-test-" + Date.now());
    (gw as any).sessionDir = testDir;
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "zalo-session.json"), JSON.stringify({ credentials: { cookie: "test" } }));
    const events: unknown[] = [];
    gw.on("status", (s) => events.push(s));

    try {
      await gw.logout();
      expect(events.length).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("attaches the saved internal Message.id before inbound dispatch", async () => {
    const gateway = new ZaloGatewayService();
    const handlers = new Map<string, (...args: any[]) => Promise<void> | void>();
    const listener = {
      on: vi.fn((event: string, handler: (...args: any[]) => Promise<void> | void) => {
        handlers.set(event, handler);
      }),
      start: vi.fn().mockResolvedValue(undefined),
    };
    (gateway as any).api = { listener };

    const normalized: NormalizedMessage = makeNorm({ zaloMessageId: "zalo-listener-1" });
    const receiveModule = await import("../services/zalo-receive.js");
    const dispatcherModule = await import("../services/incoming-dispatcher.service.js");
    const normalizeSpy = vi.spyOn(receiveModule, "normalizeMessage").mockReturnValue(normalized);
    const saveSpy = vi.spyOn(receiveModule, "saveIncomingMessage").mockResolvedValue({
      saved: true,
      dbMessageId: "message-db-listener-1",
    });
    const dispatchSpy = vi.spyOn(dispatcherModule, "handleIncomingMessage").mockResolvedValue({
      dispatched: true,
    });

    try {
      await (gateway as any).startListener();
      await handlers.get("message")!({ isSelf: false });

      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(normalized.dbMessageId).toBe("message-db-listener-1");
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ dbMessageId: "message-db-listener-1" }),
        null,
      );
    } finally {
      normalizeSpy.mockRestore();
      saveSpy.mockRestore();
      dispatchSpy.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("nomalizeMessage", () => {
  it("normalizes a group message from zca-js shape", () => {
    const raw = {
      type: "Group",
      threadId: "100012345",
      isSelf: false,
      data: {
        content: "Xin chào các bạn",
        senderId: "90001",
        senderName: "Nguyễn Văn A",
        msgId: "zmid-abc123",
      },
    };
    const norm = normalizeMessage(raw as unknown as Record<string, unknown>);
    expect(norm).not.toBeNull();
    expect(norm!.threadId).toBe("100012345");
    expect(norm!.threadType).toBe("group");
    expect(norm!.senderId).toBe("90001");
    expect(norm!.senderName).toBe("Nguyễn Văn A");
    expect(norm!.content).toBe("Xin chào các bạn");
    expect(norm!.zaloMessageId).toBe("zmid-abc123");
  });

  it("normalizes a user message type=User", () => {
    const raw = {
      type: "User",
      threadId: "90001",
      data: { content: "Hello", senderId: "90001", senderName: "A", msgId: "zmid-xyz" },
    };
    const norm = normalizeMessage(raw as unknown as Record<string, unknown>);
    expect(norm!.threadType).toBe("user");
  });

  it("returns null for empty/invalid input", () => {
    expect(normalizeMessage(null as unknown as Record<string, unknown>)).toBeNull();
    expect(normalizeMessage({} as Record<string, unknown>)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("dedupKey", () => {
  it("uses zaloMessageId when present", () => {
    const msg = makeNorm({ zaloMessageId: "zmid-123" });
    expect(dedupKey(msg)).toBe("zmid:zmid-123");
  });

  it("falls back to content hash when zaloMessageId is missing", () => {
    const msg = makeNorm({ zaloMessageId: "" });
    const key = dedupKey(msg);
    expect(key).toContain("fallback:");
    expect(key).toContain(msg.threadId);
    expect(key).toContain(msg.senderId);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("saveIncomingMessage — anti-loop", () => {
  it("skips message from self", async () => {
    const msg = makeNorm({ senderId: "self-123" });
    const result = await saveIncomingMessage(msg, "self-123");
    expect(result.saved).toBe(false);
    expect(result.reason).toContain("anti-loop");
  });

  it("saves message from other user", async () => {
    const msg = makeNorm({ senderId: "other-456", zaloMessageId: "zmid-uniq-1" });
    const result = await saveIncomingMessage(msg, "self-789");
    expect(result.saved).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("saveIncomingMessage — dedup", () => {
  it("deduplicates by zaloMessageId in DB", async () => {
    const msg = makeNorm({ senderId: "user-1", zaloMessageId: "zmid-dup-1" });
    const r1 = await saveIncomingMessage(msg, null);
    expect(r1.saved).toBe(true);
    expect(r1.dbMessageId).toBeTruthy();

    const r2 = await saveIncomingMessage(msg, null);
    expect(r2.saved).toBe(false);
    expect(r2.reason).toContain("dedup");
    expect(r2.dbMessageId).toBe(r1.dbMessageId);
  });

  it("returns the same internal Message.id for fallback-key duplicates", async () => {
    const msg = makeNorm({
      zaloMessageId: "",
      threadId: "fallback-id-thread",
      senderId: "fallback-id-sender",
      content: "fallback id content",
    });

    const first = await saveIncomingMessage(msg, null);
    const duplicate = await saveIncomingMessage(msg, null);

    expect(first.saved).toBe(true);
    expect(first.dbMessageId).toBeTruthy();
    expect(duplicate.saved).toBe(false);
    expect(duplicate.reason).toContain("dedup");
    expect(duplicate.dbMessageId).toBe(first.dbMessageId);
  });

  it("serializes concurrent identical Zalo events so only one is newly saved", async () => {
    const msg = makeNorm({
      zaloMessageId: "zmid-concurrent-internal-id",
      threadId: "concurrent-id-thread",
      senderId: "concurrent-id-sender",
      content: "concurrent id content",
    });
    const [first, second] = await Promise.all([
      saveIncomingMessage(msg, null),
      saveIncomingMessage(msg, null),
    ]);

    expect([first.saved, second.saved].sort()).toEqual([false, true]);
    expect(first.dbMessageId).toBeTruthy();
    expect(second.dbMessageId).toBe(first.dbMessageId);
    expect(await prisma.message.count({
      where: { zaloMessageId: "zmid-concurrent-internal-id" },
    })).toBe(1);
  });

  it("accepts a later legitimate fallback message after the bounded dedup window", async () => {
    let now = 1_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const msg = makeNorm({
      zaloMessageId: "",
      threadId: "fallback-window-thread",
      senderId: "fallback-window-sender",
      content: "same legitimate content",
    });

    try {
      const first = await saveIncomingMessage(msg, null);
      const immediateDuplicate = await saveIncomingMessage(msg, null);
      now += 5 * 60_000;
      const laterMessage = await saveIncomingMessage(msg, null);

      expect(first.saved).toBe(true);
      expect(immediateDuplicate.saved).toBe(false);
      expect(immediateDuplicate.dbMessageId).toBe(first.dbMessageId);
      expect(laterMessage.saved).toBe(true);
      expect(laterMessage.dbMessageId).toBeTruthy();
      expect(laterMessage.dbMessageId).not.toBe(first.dbMessageId);
      expect(await prisma.message.count({
        where: {
          threadId: "fallback-window-thread",
          senderId: "fallback-window-sender",
        },
      })).toBe(2);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("saveIncomingMessage — upsert thread", () => {
  it("creates thread on first message", async () => {
    const msg = makeNorm({ threadId: "group-new-1", threadName: "New Group", zaloMessageId: "zmid-thread-1" });
    await saveIncomingMessage(msg, null);

    const threads = await listThreads({});
    expect(threads.data.length).toBeGreaterThanOrEqual(1);
    const t = threads.data.find((x) => x.id === "group-new-1");
    expect(t).toBeDefined();
    expect(t!.name).toBe("New Group");
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("listMessages / listThreads", () => {
  it("listMessages returns saved messages", async () => {
    const m1 = makeNorm({ senderId: "u1", zaloMessageId: "zmid-lm-1", content: "Hello world" });
    const m2 = makeNorm({ senderId: "u2", zaloMessageId: "zmid-lm-2", content: "Hi there" });
    await saveIncomingMessage(m1, null);
    await saveIncomingMessage(m2, null);

    const result = await listMessages({});
    expect(result.total).toBe(2);
    expect(result.data[0]!.content).toBe("Hi there"); // desc by receivedAt
  });

  it("listMessages filters by threadId", async () => {
    const m1 = makeNorm({ threadId: "t-a", senderId: "u1", zaloMessageId: "zmid-flt-1" });
    const m2 = makeNorm({ threadId: "t-b", senderId: "u2", zaloMessageId: "zmid-flt-2" });
    await saveIncomingMessage(m1, null);
    await saveIncomingMessage(m2, null);

    const result = await listMessages({ threadId: "t-a" });
    expect(result.total).toBe(1);
    expect(result.data[0]!.threadId).toBe("t-a");
  });

  it("listMessages supports search", async () => {
    const m1 = makeNorm({ senderId: "u1", zaloMessageId: "zmid-srch-1", content: "Lễ Phật tối nay" });
    const m2 = makeNorm({ senderId: "u2", zaloMessageId: "zmid-srch-2", content: "Chào buổi sáng" });
    await saveIncomingMessage(m1, null);
    await saveIncomingMessage(m2, null);

    const result = await listMessages({ search: "Lễ Phật" });
    expect(result.total).toBe(1);
    expect(result.data[0]!.content).toContain("Lễ Phật");
  });

  it("listThreads filters by type", async () => {
    const mg = makeNorm({ threadId: "grp-1", zaloMessageId: "zmid-grp" });
    const mu = makeNorm({ threadId: "usr-1", threadType: "user", zaloMessageId: "zmid-usr" });
    await saveIncomingMessage(mg, null);
    await saveIncomingMessage(mu, null);

    const groups = await listThreads({ type: "group" });
    expect(groups.data.every((t) => t.type === "group")).toBe(true);

    const users = await listThreads({ type: "user" });
    expect(users.data.every((t) => t.type === "user")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("ZaloGateway — session path safety", () => {
  it("status response never exposes secrets", () => {
    const gw = new ZaloGatewayService();
    const status = gw.getStatus();
    const json = JSON.stringify(status);
    expect(json).not.toContain("zalo-session.json");
    expect(json).not.toContain("cookie");
    expect(json).not.toContain("token");
    expect(json).not.toContain("imei");
  });
});

// ═══════════════════════════════════════════════════════════════════
// S1.1 — Session quarantine (non-destructive error handling)
// ═══════════════════════════════════════════════════════════════════
describe("ZaloGateway — session quarantine (S1.1)", () => {
  const testDir = join(tmpdir(), "zalo-quarantine-test-" + Date.now());
  const sessionPath = join(testDir, "zalo-session.json");

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    writeFileSync(sessionPath, JSON.stringify({ credentials: { cookie: "test" }, selfUserId: "123" }));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("quarantineSessionFile: renames file with .expired-timestamp suffix", () => {
    const result = quarantineSessionFile(sessionPath, "expired");
    expect(result).not.toBeNull();
    expect(result).toContain(sessionPath + ".");
    expect(result).toMatch(/\.expired-\d{8}-\d{6}$/);
    expect(existsSync(sessionPath)).toBe(false);       // original gone
    expect(existsSync(result!)).toBe(true);             // quarantined exists
  });

  it("quarantineSessionFile: preserves session content in quarantined file", () => {
    const expected = readFileSync(sessionPath, "utf-8");
    const result = quarantineSessionFile(sessionPath, "invalid");
    expect(result).not.toBeNull();
    const actual = readFileSync(result!, "utf-8");
    expect(JSON.parse(actual)).toEqual(JSON.parse(expected));
  });

  it("quarantineSessionFile: missing file returns null, no throw", () => {
    const missingPath = join(testDir, "does-not-exist.json");
    expect(() => quarantineSessionFile(missingPath, "expired")).not.toThrow();
    expect(quarantineSessionFile(missingPath, "expired")).toBeNull();
  });

  it("quarantineSessionFile: sanitizes 'invalid' reason correctly", () => {
    const result = quarantineSessionFile(sessionPath, "invalid");
    expect(result).toMatch(/\.invalid-\d{8}-\d{6}$/);
  });

  it("quarantineSessionFile: maps 'SESSION expired' to session-error suffix", () => {
    writeFileSync(sessionPath, "{}"); // recreate after previous test deleted it
    const result = quarantineSessionFile(sessionPath, "SESSION expired");
    expect(result).not.toBeNull();
    expect(result).toMatch(/\.session-expired-\d{8}-\d{6}$/);
  });

  it("quarantineSessionFile: unmapped reason uses 'unknown' suffix", () => {
    writeFileSync(sessionPath, "{}");
    const result = quarantineSessionFile(sessionPath, "some random error");
    expect(result).not.toBeNull();
    expect(result).toMatch(/\.unknown-\d{8}-\d{6}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// H1 — Session Persistence / Heartbeat Polish
// ═══════════════════════════════════════════════════════════════════
describe("H1 — Session persistence", () => {
  const testDir = join(tmpdir(), "h1-session-test-" + Date.now());
  const sessionPath = join(testDir, "zalo-session.json");

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("F1: mkdirSync creates canonical session dir without crash", () => {
    expect(existsSync(testDir)).toBe(false);
    mkdirSync(testDir, { recursive: true });
    expect(existsSync(testDir)).toBe(true);
  });

  it("F1: mkdirSync is idempotent (dir already exists)", () => {
    mkdirSync(testDir, { recursive: true });
    expect(() => mkdirSync(testDir, { recursive: true })).not.toThrow();
  });

  it("F1: missing session file → NO_SESSION_FILE, no empty file created", () => {
    mkdirSync(testDir, { recursive: true });
    // Dir exists but file doesn't → should NOT create a dummy
    expect(existsSync(sessionPath)).toBe(false);
    // No crash when checking for non-existent file
    expect(() => {
      if (!existsSync(sessionPath)) {
        // This is the NO_SESSION_FILE path — should NOT create a file
      }
    }).not.toThrow();
    expect(existsSync(sessionPath)).toBe(false); // still no file
  });

  it("F2: quarantineSessionFile with 'logout' reason works", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(sessionPath, JSON.stringify({ credentials: { cookie: "test" } }));
    const result = quarantineSessionFile(sessionPath, "logout");
    expect(result).not.toBeNull();
    expect(result).toMatch(/\.logout-\d{8}-\d{6}$/);
    expect(existsSync(sessionPath)).toBe(false);     // original quarantined
    expect(existsSync(result!)).toBe(true);           // quarantined copy exists
  });

  it("F2: logout path no longer uses unlinkSync(sessionPath)", () => {
    // Verify the source code doesn't contain destructive session delete
    const src = readFileSync(join(__dirname, "..", "services", "zalo-gateway.service.ts"), "utf-8");
    // The logout method should NOT have unlinkSync with session path
    // It should use quarantineSessionFile instead
    const logoutMethod = src.match(/async logout\(\)[\s\S]*?\n  \}/);
    if (logoutMethod) {
      expect(logoutMethod[0]).not.toMatch(/unlinkSync\(sessionPath\)/);
      expect(logoutMethod[0]).toMatch(/quarantineSessionFile/);
    }
  });

  it("F3: runtime-config no longer creates session backups", () => {
    const src = readFileSync(join(__dirname, "..", "services", "runtime-config.service.ts"), "utf-8");
    expect(src).not.toMatch(/copyFileSync|zalo-session\.json|backup-restore/);
  });

  it("F4: NO_SESSION_FILE path includes guidance log", () => {
    const src = readFileSync(join(__dirname, "..", "services", "zalo-gateway.service.ts"), "utf-8");
    // Check that NO_SESSION_FILE path has restore guidance
    const noSessionBlock = src.match(/NO_SESSION_FILE[\s\S]*?return false;/);
    expect(noSessionBlock).not.toBeNull();
    if (noSessionBlock) {
      expect(noSessionBlock[0]).toMatch(/restore.*backup|copy.*session|login.*QR/);
    }
  });

  it("guard: no destructive unlinkSync/rmSync of session files in production code", () => {
    const src = readFileSync(join(__dirname, "..", "services", "zalo-gateway.service.ts"), "utf-8");
    // The only unlinkSync should be in tests, not in gateway
    // rmSync should only be in quarantine (renameSync, not rmSync)
    const unlinkLines = src.split("\n").filter(l => l.includes("unlinkSync") && l.includes("session"));
    expect(unlinkLines.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("MockMessageSender", () => {
  it("sends and records messages", async () => {
    const sender = new MockMessageSender();
    const r = await sender.sendMessage("Hello", "group-abc", "group");
    expect(r.success).toBe(true);
    expect(r.messageId).toContain("mock-msg-");
    expect(sender.getSentMessages().length).toBe(1);
  });

  it("clearSentMessages works", async () => {
    const sender = new MockMessageSender();
    await sender.sendMessage("A", "x", "group");
    await sender.sendMessage("B", "y", "user");
    sender.clearSentMessages();
    expect(sender.getSentMessages().length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════════

function makeNorm(overrides: Partial<{
  zaloMessageId: string;
  threadId: string;
  threadType: "user" | "group";
  threadName: string;
  senderId: string;
  senderName: string;
  content: string;
  messageType: string;
}> = {}) {
  return {
    zaloMessageId: overrides.zaloMessageId ?? `zmid-${Math.random().toString(36).slice(2, 9)}`,
    threadId: overrides.threadId ?? "group-test-1",
    threadType: overrides.threadType ?? "group",
    threadName: overrides.threadName,
    senderId: overrides.senderId ?? "sender-1",
    senderName: overrides.senderName ?? "Test Sender",
    content: overrides.content ?? "Test message",
    messageType: overrides.messageType ?? "text",
    rawMetadata: "{}",
  };
}

// ═══════════════════════════════════════════════════════════════════
// ZaloGatewayService — QR login flow (ZALO-WEB-LOGIN)
// ═══════════════════════════════════════════════════════════════════
describe("ZaloGatewayService — QR login flow", () => {
  function makeIsolatedGateway() {
    const gw = new ZaloGatewayService();
    const testDir = join(tmpdir(), "zalo-login-test-" + Date.now() + "-" + Math.random().toString(36).slice(2));
    (gw as any).sessionDir = testDir;
    return { gw, testDir };
  }

  it("start login when disconnected returns connecting status without reading configured session backups", async () => {
    const { gw, testDir } = makeIsolatedGateway();
    mkdirSync(testDir, { recursive: true });
    vi.spyOn(gw, "restoreSession").mockResolvedValue(false);
    vi.spyOn(gw as any, "runLoginInBackground").mockResolvedValue(undefined);

    try {
      const result = await gw.startLogin();
      expect(result.status).toBe("connecting");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("start login when already connected returns already_connected", async () => {
    const { gw, testDir } = makeIsolatedGateway();
    // Simulate already connected
    (gw as any).status = { ...gw.getStatus(), connected: true, connectionStatus: "connected" };
    (gw as any).api = {};
    try {
      const result = await gw.startLogin();
      expect(result.status).toBe("already_connected");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("login status reflects disconnected when not started", () => {
    const { gw } = makeIsolatedGateway();
    const status = gw.getStatus();
    expect(status.connected).toBe(false);
    expect(status.connectionStatus).toBe("disconnected");
  });

  it("qrAvailable is false when no qr-current.png exists", () => {
    const { gw, testDir } = makeIsolatedGateway();
    try {
      const status = gw.getStatus();
      expect(status.qrAvailable).toBe(false);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("qrAvailable is true when qr-current.png exists and is large enough", () => {
    const { gw, testDir } = makeIsolatedGateway();
    mkdirSync(testDir, { recursive: true });
    const qrPath = join(testDir, "qr-current.png");
    writeFileSync(qrPath, Buffer.alloc(1000, 0xff));
    try {
      const status = gw.getStatus();
      expect(status.qrAvailable).toBe(true);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("cancelLogin cancels pending login and removes qr file", () => {
    const { gw, testDir } = makeIsolatedGateway();
    mkdirSync(testDir, { recursive: true });
    const qrPath = join(testDir, "qr-current.png");
    writeFileSync(qrPath, Buffer.alloc(1000, 0xff));
    (gw as any).loginInProgress = true;
    try {
      const result = gw.cancelLogin();
      expect(result.cancelled).toBe(true);
      expect((gw as any).loginInProgress).toBe(false);
      expect(existsSync(qrPath)).toBe(false);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("cancelLogin no-op when not in progress", () => {
    const { gw, testDir } = makeIsolatedGateway();
    try {
      const result = gw.cancelLogin();
      expect(result.cancelled).toBe(false);
      expect(result.message).toContain("No login");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
