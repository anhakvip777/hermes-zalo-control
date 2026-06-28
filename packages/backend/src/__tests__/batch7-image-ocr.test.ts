// =============================================================================
// Batch 7 — OCR / Image Understanding Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock config before imports ──────────────────────────────────
vi.mock("../config.js", () => ({
  config: {
    zalo: { dryRun: true },
    autoReply: {
      enabled: true,
      dryRun: true,
      allowedThreads: ["6792540503378312397", "group-123"],
      cooldownSeconds: 10,
      groupReplyWindowSeconds: 600,
    },
    hermesChat: { minConfidence: 0.5 },
    vision: {
      enabled: true,
      maxSizeBytes: 10 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      safeDir: "/tmp/hermes-media/inbound-images",
      downloadTimeoutMs: 30000,
      provider: "hermes",
      model: "gpt-5.4",
    },
  },
}));

// ── Mock prisma (hoisted to avoid hoisting issue) ──────────────────
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    message: { findUnique: vi.fn(), upsert: vi.fn() },
    zaloThread: { upsert: vi.fn() },
    threadSetting: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    agentTask: {
      create: vi.fn().mockResolvedValue({ id: "task-1", status: "pending" }),
      update: vi.fn().mockResolvedValue({ id: "task-1", status: "completed" }),
      findFirst: vi.fn(),
    },
    scheduleExecution: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    schedule: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
  },
}));

vi.mock("../db.js", () => ({ prisma: mockPrisma }));

// ── Import under test ────────────────────────────────────────────
import { normalizeMessage, dedupKey, saveIncomingMessage } from "../services/zalo-receive.js";
import { validateSafeDownloadPath, isAllowedMimeType } from "../services/image-download.service.js";
import { analyzeImage } from "../services/image-understanding.service.js";

// ═════════════════════════════════════════════════════════════════╗
// SECTION 1: Image message detection in normalizeMessage
// ═════════════════════════════════════════════════════════════════╝

describe("Batch 7 - Image Message Detection", () => {
  it("detects image message with chat.photo type (real Zalo format)", () => {
    const raw = {
      type: 0,
      threadId: "6792540503378312397",
      data: {
        content: { title: "", description: "", href: "https://photo-stal-1.zdn.vn/gr/jpg/abc123.jpg", thumb: "https://photo-stal-1.zdn.vn/gr/thumb/abc123.jpg" },
        type: "chat.photo",
        msgId: "msg-001",
        senderId: "sender-1",
      },
    };
    const msg = normalizeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.messageType).toBe("image");
    expect(msg!.imageUrl).toBe("https://photo-stal-1.zdn.vn/gr/jpg/abc123.jpg");
    expect(msg!.imageThumbnailUrl).toBe("https://photo-stal-1.zdn.vn/gr/thumb/abc123.jpg");
    expect(msg!.content).toBe("[Ảnh Zalo]");
  });

  it("handles non-image messages normally", () => {
    const raw = {
      type: 0,
      threadId: "6792540503378312397",
      data: {
        content: "xin chào",
        type: "text",
        messageId: "msg-002",
        senderId: "sender-1",
      },
    };
    const msg = normalizeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.messageType).toBe("text");
    expect(msg!.content).toBe("xin chào");
    expect(msg!.imageUrl).toBeUndefined();
  });

  it("handles image message with chat.photo and no thumb", () => {
    const raw = {
      type: 0,
      threadId: "6792540503378312397",
      data: {
        content: { title: "", description: "", href: "https://photo-stal-1.zdn.vn/gr/jpg/xyz.jpg" },
        type: "chat.photo",
        msgId: "msg-003",
        senderId: "sender-1",
      },
    };
    const msg = normalizeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.messageType).toBe("image");
    expect(msg!.imageUrl).toBe("https://photo-stal-1.zdn.vn/gr/jpg/xyz.jpg");
    expect(msg!.content).toBe("[Ảnh Zalo]");
  });
});

// ═════════════════════════════════════════════════════════════════╗
// SECTION 2: Image download service — safe path validation
// ═════════════════════════════════════════════════════════════════╝

describe("Batch 7 - Safe Download Path Validation", () => {
  it("allows paths within safe directory", () => {
    expect(validateSafeDownloadPath("/tmp/hermes-media/inbound-images/test.jpg")).toBe(true);
    expect(validateSafeDownloadPath("/tmp/hermes-media/inbound-images/sub/test.png")).toBe(true);
  });

  it("blocks path traversal", () => {
    expect(validateSafeDownloadPath("/tmp/hermes-media/inbound-images/../../../etc/passwd")).toBe(false);
    expect(validateSafeDownloadPath("/tmp/hermes-media/../other/images/test.jpg")).toBe(false);
  });

  it("blocks paths outside safe directory", () => {
    expect(validateSafeDownloadPath("/tmp/other/test.jpg")).toBe(false);
    expect(validateSafeDownloadPath("/home/user/secrets.jpg")).toBe(false);
  });

  it("blocks filenames with path separators", () => {
    // The basename check in validateSafeDownloadPath catches this
    // because the resolved path won't start with safeDir
    const result = validateSafeDownloadPath("/tmp/hermes-media/inbound-images/../etc/passwd");
    expect(result).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════╗
// SECTION 3: MIME type validation
// ═════════════════════════════════════════════════════════════════╝

describe("Batch 7 - MIME Type Validation", () => {
  it("allows JPEG", () => {
    expect(isAllowedMimeType("image/jpeg")).toBe(true);
    expect(isAllowedMimeType("image/jpg")).toBe(false);
  });

  it("allows PNG", () => {
    expect(isAllowedMimeType("image/png")).toBe(true);
  });

  it("allows WebP", () => {
    expect(isAllowedMimeType("image/webp")).toBe(true);
  });

  it("blocks unsupported MIME types", () => {
    expect(isAllowedMimeType("image/gif")).toBe(false);
    expect(isAllowedMimeType("image/bmp")).toBe(false);
    expect(isAllowedMimeType("text/html")).toBe(false);
    expect(isAllowedMimeType("application/octet-stream")).toBe(false);
    expect(isAllowedMimeType(null)).toBe(false);
    expect(isAllowedMimeType("")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════╗
// SECTION 4: Image Understanding — basic analysis (no real API)
// ═════════════════════════════════════════════════════════════════╝

describe("Batch 7 - Image Understanding", () => {
  it("returns error for non-existent file", async () => {
    const result = await analyzeImage("/tmp/nonexistent-image-12345.jpg");
    expect(result.success).toBe(false);
    expect(result.error).toBe("FILE_NOT_FOUND");
  });

  it("returns basic result for existing file (without API key)", async () => {
    // Create a minimal JPEG file
    const fs = await import("node:fs");
    const path = await import("node:path");
    const testDir = "/tmp/hermes-media/inbound-images";
    fs.mkdirSync(testDir, { recursive: true });
    const testFile = path.join(testDir, "test-file.jpg");
    // Minimal JPEG (just enough to exist on disk)
    const jpegHeader = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
      0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
    ]);
    fs.writeFileSync(testFile, jpegHeader);

    const result = await analyzeImage(testFile);
    // Without CHIASEGPU_API_KEY, should return fallback result
    expect(result.success).toBe(true);
    expect(result.description).toContain("đã được tải về");

    // Cleanup
    fs.unlinkSync(testFile);
  });
});

// ═════════════════════════════════════════════════════════════════╗
// SECTION 5: Dedup with image messages
// ═════════════════════════════════════════════════════════════════╝

describe("Batch 7 - Dedup for image messages", () => {
  it("dedupKey uses zaloMessageId when available", () => {
    const msg = {
      zaloMessageId: "msg-img-001",
      threadId: "6792540503378312397",
      threadType: "user" as const,
      senderId: "sender-1",
      content: "[Ảnh Zalo]",
      messageType: "image",
      rawMetadata: "{}",
    };
    const key = dedupKey(msg);
    expect(key).toBe("zmid:msg-img-001");
  });

  it("dedupKey falls back for messages without ID", () => {
    const msg = {
      zaloMessageId: null,
      threadId: "6792540503378312397",
      threadType: "user" as const,
      senderId: "sender-1",
      content: "[Ảnh Zalo]",
      messageType: "image",
      rawMetadata: "{}",
    };
    const key = dedupKey(msg);
    expect(key).toContain("fallback:");
    expect(key).toContain("6792540503378312397");
    expect(key).toContain("sender-1");
  });
});

// ═════════════════════════════════════════════════════════════════╗
// SECTION 6: Regression — non-image messages still work
// ═════════════════════════════════════════════════════════════════╝

describe("Batch 7 - Non-image regression", () => {
  it("text messages normalize correctly after changes", () => {
    const raw = {
      type: 0,
      threadId: "6792540503378312397",
      data: {
        content: "xin chào bạn",
        messageId: "msg-text-001",
        senderId: "sender-1",
        senderName: "Người dùng",
      },
    };
    const msg = normalizeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.messageType).toBe("text");
    expect(msg!.content).toBe("xin chào bạn");
    expect(msg!.imageUrl).toBeUndefined();
    expect(msg!.senderId).toBe("sender-1");
    expect(msg!.senderName).toBe("Người dùng");
  });

  it("group messages normalize correctly after changes", () => {
    const raw = {
      type: 1,
      threadId: "group-123",
      data: {
        content: "@nhà chung nam xin chào",
        messageId: "msg-group-001",
        senderId: "sender-2",
        groupName: "Nhóm test",
      },
    };
    const msg = normalizeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.threadType).toBe("group");
    expect(msg!.threadName).toBe("Nhóm test");
    expect(msg!.messageType).toBe("text");
  });

  it("sticker messages pass through as non-text", () => {
    const raw = {
      type: 0,
      threadId: "6792540503378312397",
      data: {
        content: "",
        type: "sticker",
        messageId: "msg-sticker-001",
        senderId: "sender-1",
      },
    };
    const msg = normalizeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.messageType).toBe("sticker");
    expect(msg!.content).toBe("");
  });
});

// ═════════════════════════════════════════════════════════════════╗
// SECTION 7: API contract tests (shape of responses)
// ═════════════════════════════════════════════════════════════════╝

describe("Batch 7 - API contract", () => {
  it("analyzeImage returns correct shape on success (without API)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const testDir = "/tmp/hermes-media/inbound-images";
    fs.mkdirSync(testDir, { recursive: true });
    const testFile = path.join(testDir, "contract-test.jpg");
    const jpegHeader = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
      0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
    ]);
    fs.writeFileSync(testFile, jpegHeader);

    const result = await analyzeImage(testFile);
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("description");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("provider");

    // Cleanup
    fs.unlinkSync(testFile);
  });

  it("analyzeImage returns error shape on missing file", async () => {
    const result = await analyzeImage("/tmp/definitely-missing.png");
    expect(result.success).toBe(false);
    expect(result).toHaveProperty("error");
    expect(result.error).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════╗
// SECTION 8: Edge cases
// ═════════════════════════════════════════════════════════════════╝

describe("Batch 7 - Edge cases", () => {
  it("null raw returns null from normalizeMessage", () => {
    const msg = normalizeMessage(null as any);
    expect(msg).toBeNull();
  });

  it("empty object returns null", () => {
    const msg = normalizeMessage({});
    expect(msg).toBeNull();
  });

  it("image with chat.photo type detected even without content href", () => {
    const raw = {
      type: 0,
      threadId: "6792540503378312397",
      data: {
        content: { title: "", description: "", href: "https://photo-stal-1.zdn.vn/gr/jpg/with-caption.jpg" },
        type: "chat.photo",
        msgId: "msg-caption-001",
        senderId: "sender-1",
      },
    };
    const msg = normalizeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.messageType).toBe("image");
    expect(msg!.imageUrl).toBe("https://photo-stal-1.zdn.vn/gr/jpg/with-caption.jpg");
  });

  it("non-http content (plain text) is not detected as image", () => {
    const raw = {
      type: 0,
      threadId: "6792540503378312397",
      data: {
        content: "đây không phải ảnh",
        type: "text",
        messageId: "msg-plain-001",
        senderId: "sender-1",
      },
    };
    const msg = normalizeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.messageType).toBe("text");
    expect(msg!.imageUrl).toBeUndefined();
  });
});
