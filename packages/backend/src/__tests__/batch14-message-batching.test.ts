// =============================================================================
// Batch 14 Tests — Message Batching / Debounce
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock config for batching
const mockBatchingConfig = vi.hoisted(() => ({
  mockConfig: {
    messageBatching: {
      enabled: true,
      windowMs: 4000,
      maxMessages: 5,
      maxChars: 3000,
      threadTypes: ["user"],
    },
  },
}));

vi.mock("../config.js", () => ({
  config: mockBatchingConfig.mockConfig,
}));

vi.mock("../db.js", async () => {
  const actual = await vi.importActual("../db.js");
  return actual;
});

// We'll test the service functions directly
import * as batchService from "../services/message-batch.service.js";

describe("Message Batching — Service", () => {
  it("addToBatch creates new batch for first message", async () => {
    const msg = {
      zaloMessageId: "msg-1",
      threadId: "thread-test-1",
      threadType: "user" as const,
      senderId: "user-1",
      content: "hello world",
      messageType: "text",
      rawMetadata: "{}",
    };

    const result = await batchService.addToBatch(msg);
    expect(result).not.toBeNull();
    expect(result!.isNew).toBe(true);
    expect(result!.messageCount).toBe(1);
    expect(result!.combinedText).toBe("hello world");
    expect(result!.status).toBe("collecting");
    expect(result!.isReady).toBe(false);
  });

  it("addToBatch appends to existing collecting batch", async () => {
    const msg1 = {
      zaloMessageId: "msg-a1",
      threadId: "thread-test-2",
      threadType: "user" as const,
      senderId: "user-1",
      content: "first message",
      messageType: "text",
      rawMetadata: "{}",
    };
    const msg2 = {
      zaloMessageId: "msg-a2",
      threadId: "thread-test-2",
      threadType: "user" as const,
      senderId: "user-1",
      content: "second message",
      messageType: "text",
      rawMetadata: "{}",
    };

    const r1 = await batchService.addToBatch(msg1);
    expect(r1!.isNew).toBe(true);
    expect(r1!.messageCount).toBe(1);

    const r2 = await batchService.addToBatch(msg2);
    expect(r2!.isNew).toBe(false);
    expect(r2!.messageCount).toBe(2);
    expect(r2!.combinedText).toBe("first message\nsecond message");
  });

  it("addToBatch marks ready when max messages reached", async () => {
    // Override max to 2 for this test
    mockBatchingConfig.mockConfig.messageBatching.maxMessages = 2;

    const msg1 = {
      zaloMessageId: "msg-l1",
      threadId: "thread-limit-1",
      threadType: "user" as const,
      senderId: "user-1",
      content: "msg one",
      messageType: "text",
      rawMetadata: "{}",
    };
    const msg2 = {
      zaloMessageId: "msg-l2",
      threadId: "thread-limit-1",
      threadType: "user" as const,
      senderId: "user-1",
      content: "msg two",
      messageType: "text",
      rawMetadata: "{}",
    };

    await batchService.addToBatch(msg1);
    const r2 = await batchService.addToBatch(msg2);
    expect(r2!.isReady).toBe(true);
    expect(r2!.status).toBe("ready");

    // Reset
    mockBatchingConfig.mockConfig.messageBatching.maxMessages = 5;
  });

  it("addToBatch marks ready when max chars exceeded", async () => {
    mockBatchingConfig.mockConfig.messageBatching.maxChars = 20;

    const msg1 = {
      zaloMessageId: "msg-c1",
      threadId: "thread-chars-1",
      threadType: "user" as const,
      senderId: "user-1",
      content: "short msg here...",  // 17 chars
      messageType: "text",
      rawMetadata: "{}",
    };
    const msg2 = {
      zaloMessageId: "msg-c2",
      threadId: "thread-chars-1",
      threadType: "user" as const,
      senderId: "user-1",
      content: "another one!",  // + 12 chars = 29 > 20
      messageType: "text",
      rawMetadata: "{}",
    };

    await batchService.addToBatch(msg1);
    const r2 = await batchService.addToBatch(msg2);
    expect(r2!.isReady).toBe(true);

    mockBatchingConfig.mockConfig.messageBatching.maxChars = 3000;
  });

  it("addToBatch returns null when batching disabled", async () => {
    mockBatchingConfig.mockConfig.messageBatching.enabled = false;

    const msg = {
      zaloMessageId: "msg-nobatch",
      threadId: "thread-no-1",
      threadType: "user" as const,
      senderId: "user-1",
      content: "test",
      messageType: "text",
      rawMetadata: "{}",
    };

    const result = await batchService.addToBatch(msg);
    expect(result).toBeNull();

    mockBatchingConfig.mockConfig.messageBatching.enabled = true;
  });

  it("addToBatch ignores non-text messages", async () => {
    const msg = {
      zaloMessageId: "msg-img",
      threadId: "thread-img-1",
      threadType: "user" as const,
      senderId: "user-1",
      content: "image",
      messageType: "image",
      rawMetadata: "{}",
      imageUrl: "https://example.com/img.jpg",
    };

    const result = await batchService.addToBatch(msg);
    expect(result).toBeNull();
  });

  it("addToBatch ignores group messages when only user is configured", async () => {
    const msg = {
      zaloMessageId: "msg-group",
      threadId: "thread-group-1",
      threadType: "group" as const,
      senderId: "user-1",
      content: "group message",
      messageType: "text",
      rawMetadata: "{}",
    };

    const result = await batchService.addToBatch(msg);
    expect(result).toBeNull();
  });

  it("findReadyBatches finds overdue collecting batches", async () => {
    // Create a batch with past dueAt
    const msg = {
      zaloMessageId: "msg-overdue",
      threadId: "thread-overdue-1",
      threadType: "user" as const,
      senderId: "user-1",
      content: "overdue test",
      messageType: "text",
      rawMetadata: "{}",
    };

    const result = await batchService.addToBatch(msg);
    expect(result).not.toBeNull();

    // Manually set dueAt to the past
    const { prisma } = await import("../db.js");
    await prisma.messageBatch.update({
      where: { id: result!.batchId },
      data: { dueAt: new Date(Date.now() - 1000) }, // 1 second ago
    });

    const ready = await batchService.findReadyBatches(10);
    expect(ready.length).toBeGreaterThanOrEqual(1);
    expect(ready.some(b => b.id === result!.batchId)).toBe(true);
  });

  it("claimBatch atomically claims a batch", async () => {
    const msg = {
      zaloMessageId: "msg-claim",
      threadId: "thread-claim-1",
      threadType: "user" as const,
      senderId: "user-1",
      content: "claim test",
      messageType: "text",
      rawMetadata: "{}",
    };

    const result = await batchService.addToBatch(msg);
    const { prisma } = await import("../db.js");

    // Mark as ready
    await prisma.messageBatch.update({
      where: { id: result!.batchId },
      data: { status: "ready" },
    });

    const claimed = await batchService.claimBatch(result!.batchId);
    expect(claimed).toBe(true);

    // Second claim should fail
    const claimed2 = await batchService.claimBatch(result!.batchId);
    expect(claimed2).toBe(false);
  });

  it("completeBatch updates status and result", async () => {
    const msg = {
      zaloMessageId: "msg-complete",
      threadId: "thread-complete-1",
      threadType: "user" as const,
      senderId: "user-1",
      content: "complete test",
      messageType: "text",
      rawMetadata: "{}",
    };

    const result = await batchService.addToBatch(msg);
    const { prisma } = await import("../db.js");

    // Mark as processing
    await prisma.messageBatch.update({
      where: { id: result!.batchId },
      data: { status: "processing" },
    });

    await batchService.completeBatch(result!.batchId, { dispatched: true });

    const updated = await batchService.getBatch(result!.batchId);
    expect(updated!.status).toBe("completed");
    expect(updated!.processedAt).not.toBeNull();
    const parsedResult = JSON.parse(updated!.result!);
    expect(parsedResult.dispatched).toBe(true);
  });
});

// =============================================================================
// Batch 14.1 — Reminder Parser with Batched Multi-line Content
// =============================================================================

import {
  detectCreateReminderIntent,
  parseReminderFromMessage,
} from "../services/incoming-dispatcher.service.js";

describe("Batch 14.1 — Reminder Parser (Multi-line Batch)", () => {
  it("detectCreateReminderIntent: single-line 'nhắc mình đi lễ Phật lúc 19h'", () => {
    const result = detectCreateReminderIntent("Nhắc mình đi lễ Phật lúc 19h");
    expect(result).toBe(true);
  });

  it("detectCreateReminderIntent: multi-line normalized", () => {
    const content = "Nhắc mình\nĐi Lễ Phật\nLúc 19h";
    const result = detectCreateReminderIntent(content);
    expect(result).toBe(true);
  });

  it("detectCreateReminderIntent: no target pronoun", () => {
    const result = detectCreateReminderIntent("nhắc đi lễ Phật lúc 7h sáng");
    expect(result).toBe(true);
  });

  it("parseReminderFromMessage: single-line extracts content + time", () => {
    const parsed = parseReminderFromMessage("Nhắc mình đi lễ Phật lúc 19h");
    expect(parsed).not.toBeNull();
    expect(parsed!.content.toLowerCase()).toBe("đi lễ phật");
    expect(parsed!.scheduledAt.getHours()).toBe(19);
  });

  it("parseReminderFromMessage: multi-line normalized extracts content + time", () => {
    const content = "Nhắc mình\nĐi Lễ Phật\nLúc 19h";
    const parsed = parseReminderFromMessage(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.content.toLowerCase()).toBe("đi lễ phật");
    expect(parsed!.scheduledAt.getHours()).toBe(19);
  });

  it("parseReminderFromMessage: no target, with period", () => {
    const parsed = parseReminderFromMessage("nhắc đi chợ lúc 7h sáng");
    expect(parsed).not.toBeNull();
    expect(parsed!.content.toLowerCase()).toBe("đi chợ");
    expect(parsed!.scheduledAt.getHours()).toBe(7);
    expect(parsed!.timeDescription).toContain("7:00");
    expect(parsed!.timeDescription).toContain("sáng");
  });

  it("parseReminderFromMessage: 'Nhắc mình Đi Lễ Phật Lúc 19h' (batched+normalized)", () => {
    const parsed = parseReminderFromMessage("Nhắc mình Đi Lễ Phật Lúc 19h");
    expect(parsed).not.toBeNull();
    expect(parsed!.content).toBe("Đi Lễ Phật");
    expect(parsed!.scheduledAt.getHours()).toBe(19);
  });

  // Regression: existing "X phút nữa" patterns still work
  it("parseReminderFromMessage: existing 'X phút nữa' pattern still works", () => {
    const parsed = parseReminderFromMessage("nhắc mình 30 phút nữa đi họp");
    expect(parsed).not.toBeNull();
    expect(parsed!.content).toContain("đi họp");
  });

  // Guard still blocks unsupported claim without DB evidence
  it("detectCreateReminderIntent: does NOT match query/read intents", () => {
    expect(detectCreateReminderIntent("có lịch gì hôm nay")).toBe(false);
    expect(detectCreateReminderIntent("xem lịch nhắc")).toBe(false);
    expect(detectCreateReminderIntent("hello")).toBe(false);
  });
});
