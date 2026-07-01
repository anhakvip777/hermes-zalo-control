// =============================================================================
// Batch U1 — Message UI Status Clarity (outbound enrichment tests)
// =============================================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../db.js";
import { cleanDatabase } from "./shared-setup.js";
import { listMessages } from "../services/zalo-receive.js";

beforeAll(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
});

beforeEach(async () => {
  await cleanDatabase();
});

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

import { createHash } from "node:crypto";

/** Create a test message */
async function createMessage(overrides: Partial<{
  threadId: string;
  content: string;
  role: string;
  isFromBot: boolean;
  receivedAt: Date;
}> = {}) {
  const msg = await prisma.message.create({
    data: {
      threadId: overrides.threadId ?? "thread-u1-test",
      threadType: "user",
      content: overrides.content ?? "Test message",
      role: overrides.role ?? "user",
      isFromBot: overrides.isFromBot ?? false,
      receivedAt: overrides.receivedAt ?? new Date(),
    },
  });
  return msg;
}

/** Create a matching OutboundRecord for a message */
async function createOutboundForMessage(
  threadId: string,
  content: string,
  overrides: Partial<{
    dryRun: boolean;
    sentMessageId: string | null;
    errorCode: string | null;
    decision: string;
    reason: string;
    source: string;
    createdAt: Date;
  }> = {},
) {
  const contentHash = createHash("sha256")
    .update(`${threadId}:${content}`)
    .digest("hex");

  return prisma.outboundRecord.create({
    data: {
      threadId,
      threadType: "user",
      content,
      contentHash,
      dryRun: overrides.dryRun ?? true,
      sentMessageId: overrides.sentMessageId ?? null,
      errorCode: overrides.errorCode ?? null,
      decision: overrides.decision ?? "allow",
      reason: overrides.reason ?? "single_send",
      source: overrides.source ?? "auto_reply",
      createdAt: overrides.createdAt ?? new Date(),
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("U1 — listMessages outbound enrichment", () => {
  it("returns outbound:null for user messages (no outbound lookup)", async () => {
    await createMessage({ role: "user", content: "Hello bot" });

    const result = await listMessages({ pageSize: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].outbound).toBeNull();
  });

  it("returns outbound:null for assistant message with no matching OutboundRecord", async () => {
    await createMessage({ role: "assistant", content: "Reply without record", isFromBot: true });

    const result = await listMessages({ pageSize: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].outbound).toBeNull();
  });

  it("matches assistant message to OutboundRecord by content hash", async () => {
    const threadId = "thread-u1-hash";
    const content = "Hello from bot";

    await createMessage({ threadId, role: "assistant", content, isFromBot: true });
    await createOutboundForMessage(threadId, content, { dryRun: true, decision: "allow", reason: "single_send" });

    const result = await listMessages({ pageSize: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].outbound).not.toBeNull();
    expect(result.data[0].outbound!.dryRun).toBe(true);
    expect(result.data[0].outbound!.decision).toBe("allow");
  });

  it("maps dryRun correctly", async () => {
    const threadId = "thread-u1-dry";
    const content = "Dry run reply";

    await createMessage({ threadId, role: "assistant", content, isFromBot: true });
    await createOutboundForMessage(threadId, content, { dryRun: true });

    const result = await listMessages({ pageSize: 10 });
    expect(result.data[0].outbound!.dryRun).toBe(true);
    expect(result.data[0].outbound!.sentMessageId).toBeNull();
  });

  it("maps sent correctly (sentMessageId present)", async () => {
    const threadId = "thread-u1-sent";
    const content = "Real sent reply";

    await createMessage({ threadId, role: "assistant", content, isFromBot: true });
    await createOutboundForMessage(threadId, content, {
      dryRun: false,
      sentMessageId: "zalo-msg-abc123",
    });

    const result = await listMessages({ pageSize: 10 });
    expect(result.data[0].outbound!.dryRun).toBe(false);
    expect(result.data[0].outbound!.sentMessageId).toBe("zalo-msg-abc123");
  });

  it("maps failed correctly (errorCode present)", async () => {
    const threadId = "thread-u1-failed";
    const content = "Failed reply";

    await createMessage({ threadId, role: "assistant", content, isFromBot: true });
    await createOutboundForMessage(threadId, content, {
      dryRun: false,
      errorCode: "ZALO_API_ERROR",
    });

    const result = await listMessages({ pageSize: 10 });
    expect(result.data[0].outbound!.errorCode).toBe("ZALO_API_ERROR");
  });

  it("maps cooldown reason correctly", async () => {
    const threadId = "thread-u1-cooldown";
    const content = "Cooldown blocked";

    await createMessage({ threadId, role: "assistant", content, isFromBot: true });
    await createOutboundForMessage(threadId, content, {
      decision: "skip",
      reason: "cooldown",
    });

    const result = await listMessages({ pageSize: 10 });
    expect(result.data[0].outbound!.reason).toBe("cooldown");
    expect(result.data[0].outbound!.decision).toBe("skip");
  });

  it("maps permission_denied reason correctly", async () => {
    const threadId = "thread-u1-perm";
    const content = "Permission denied";

    await createMessage({ threadId, role: "assistant", content, isFromBot: true });
    await createOutboundForMessage(threadId, content, {
      decision: "skip",
      reason: "permission_denied",
    });

    const result = await listMessages({ pageSize: 10 });
    expect(result.data[0].outbound!.reason).toBe("permission_denied");
  });

  it("maps blocked decision correctly", async () => {
    const threadId = "thread-u1-blocked";
    const content = "Blocked message";

    await createMessage({ threadId, role: "assistant", content, isFromBot: true });
    await createOutboundForMessage(threadId, content, {
      decision: "block",
      reason: "DUPLICATE_OUTBOUND",
    });

    const result = await listMessages({ pageSize: 10 });
    expect(result.data[0].outbound!.decision).toBe("block");
    expect(result.data[0].outbound!.reason).toBe("DUPLICATE_OUTBOUND");
  });

  it("handles empty threadIds gracefully (no messages)", async () => {
    const result = await listMessages({ pageSize: 10 });
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("only enriches assistant messages (not user messages)", async () => {
    const threadId = "thread-u1-mixed";
    const userContent = "User says hi";
    const botContent = "Bot replies hi";

    await createMessage({ threadId, role: "user", content: userContent });
    await createMessage({ threadId, role: "assistant", content: botContent, isFromBot: true });
    await createOutboundForMessage(threadId, botContent, { dryRun: true });

    const result = await listMessages({ pageSize: 10 });
    expect(result.data).toHaveLength(2);

    const userMsg = result.data.find((m) => m.role === "user")!;
    const botMsg = result.data.find((m) => m.role === "assistant")!;

    expect(userMsg.outbound).toBeNull();
    expect(botMsg.outbound).not.toBeNull();
  });

  it("includes source field in outbound", async () => {
    const threadId = "thread-u1-source";
    const content = "Scheduled message";

    await createMessage({ threadId, role: "assistant", content, isFromBot: true });
    await createOutboundForMessage(threadId, content, { source: "schedule" });

    const result = await listMessages({ pageSize: 10 });
    expect(result.data[0].outbound!.source).toBe("schedule");
  });
});
