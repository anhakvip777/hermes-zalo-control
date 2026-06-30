import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockMessageSender } from "../services/message-sender.js";
import { ZaloMessageSender, rateLimiter } from "../services/zalo-message-sender.js";
import { ZaloGatewayService, quarantineSessionFile } from "../services/zalo-gateway.service.js";
import { normalizeMessage, dedupKey, saveIncomingMessage, listMessages, listThreads } from "../services/zalo-receive.js";
import { cleanDatabase } from "./shared-setup.js";
import * as settingsService from "../services/settings.service.js";

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

  it("emits status events on logout", async () => {
    const gw = new ZaloGatewayService();
    const events: unknown[] = [];
    gw.on("status", (s) => events.push(s));
    await gw.logout();
    expect(events.length).toBeGreaterThanOrEqual(1);
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

    const r2 = await saveIncomingMessage(msg, null);
    expect(r2.saved).toBe(false);
    expect(r2.reason).toContain("dedup");
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
