// =============================================================================
// Inbound secret redaction — KI-B4 (DB-backed save-path test)
// =============================================================================
// Proves that saveIncomingMessage() redacts user-pasted secrets BEFORE they are
// persisted to the Message table (content + metadata). This is the exact leak
// demonstrated by the legacy raw-inbound capture (users pasted sk-… keys).
//
// Runs against the isolated test DB (NODE_ENV=test, DATABASE_URL=file:./test.db)
// via scripts/run-tests.mjs. Fabricated secret values only — never a real key.
// =============================================================================

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { cleanDatabase } from "./shared-setup.js";
import { prisma } from "../db.js";
import { saveIncomingMessage, type NormalizedMessage } from "../services/zalo-receive.js";

beforeEach(async () => {
  await cleanDatabase();
});
afterAll(async () => {
  await cleanDatabase();
});

function inbound(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    zaloMessageId: "zm-redact-1",
    threadId: "user:redact-thread",
    threadType: "user",
    senderId: "user:redact-sender",
    senderName: "Test User",
    content: "hello",
    messageType: "text",
    rawMetadata: JSON.stringify({ type: "text", content: "hello", _sanitized: true }),
    ...overrides,
  };
}

describe("KI-B4 — inbound save path stores redacted content", () => {
  it("does NOT persist a raw sk-proj API key in Message.content", async () => {
    // Fabricated alphanumeric key (not hex) — the realistic leak shape.
    const key = "sk-proj-Ab3dEf6GhiJkLmNoPqRsTuVwXyZ012345_-6789Abcd";
    const raw = `đây là key của em: ${key} nhớ giữ nhé`;

    const res = await saveIncomingMessage(inbound({ content: raw }), null);
    expect(res.saved).toBe(true);

    const row = await prisma.message.findUnique({ where: { zaloMessageId: "zm-redact-1" } });
    expect(row).not.toBeNull();
    // The raw key must be gone; the marker must be present; normal words kept.
    expect(row!.content).not.toContain(key);
    expect(row!.content).toContain("[REDACTED]");
    expect(row!.content).toContain("đây là key của em");
  });

  it("does NOT persist a secret embedded in raw metadata JSON", async () => {
    const key = "sk-" + "a".repeat(64); // hex-body variant
    const meta = JSON.stringify({ type: "text", data: { content: `token ${key}` }, _sanitized: true });

    const res = await saveIncomingMessage(
      inbound({ zaloMessageId: "zm-redact-2", content: "ok", rawMetadata: meta }),
      null,
    );
    expect(res.saved).toBe(true);

    const row = await prisma.message.findUnique({ where: { zaloMessageId: "zm-redact-2" } });
    expect(row).not.toBeNull();
    expect(row!.metadata ?? "").not.toContain(key);
    expect(row!.metadata ?? "").toContain("[REDACTED]");
  });

  it("preserves normal Vietnamese content unchanged", async () => {
    const text = "Tỷ ơi nhắc em 9h họp ở phòng A nhé";
    const res = await saveIncomingMessage(
      inbound({ zaloMessageId: "zm-redact-3", content: text }),
      null,
    );
    expect(res.saved).toBe(true);

    const row = await prisma.message.findUnique({ where: { zaloMessageId: "zm-redact-3" } });
    expect(row!.content).toBe(text);
  });
});
