// =============================================================================
// Phase 3.5A — media/attachment memory indexing (DB-backed)
// =============================================================================
// Proves the menu case: an inbound image in group A, OCR'd (redacted), can be
// found later by keyword + thread + date, with no cross-thread leak, and honest
// handling when extraction is unavailable. No live send.
// =============================================================================

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { cleanDatabase } from "./shared-setup.js";
import { prisma } from "../db.js";
import {
  saveInboundAttachment,
  updateExtractionByZaloMessageId,
  searchAttachments,
  mergeVisionMetadata,
  deriveAttachmentKind,
} from "../services/attachment.service.js";

beforeEach(async () => { await cleanDatabase(); });
afterAll(async () => { await cleanDatabase(); });

async function seedMessage(id: string, zaloMessageId: string, threadId: string, threadType: string) {
  await prisma.message.create({
    data: { id, zaloMessageId, threadId, threadType, content: "[Ảnh Zalo]", isFromBot: false, messageType: "image", receivedAt: new Date() },
  });
}

describe("Phase 3.5A — attachment index", () => {
  it("deriveAttachmentKind maps message types", () => {
    expect(deriveAttachmentKind("image")).toBe("image");
    expect(deriveAttachmentKind("file")).toBe("file");
    expect(deriveAttachmentKind("voice")).toBe("voice");
    expect(deriveAttachmentKind("text")).toBeNull();
  });

  it("inbound image creates an Attachment linked to the Message (redacted source URL)", async () => {
    await seedMessage("m-a1", "z-a1", "group-A", "group");
    const id = await saveInboundAttachment({
      messageId: "m-a1", zaloMessageId: "z-a1", threadId: "group-A", threadType: "group",
      senderId: "u1", kind: "image", fileName: "menu.jpg",
      sourceUrl: "https://cdn.zalo/photo?token=sk-secretsecretsecretsecret1234",
    });
    expect(id).not.toBeNull();
    const row = await prisma.attachment.findUnique({ where: { id: id! } });
    expect(row!.messageId).toBe("m-a1");
    expect(row!.kind).toBe("image");
    expect(row!.extractionStatus).toBe("pending");
    // source URL token redacted
    expect(row!.sourceUrlRedacted ?? "").not.toContain("sk-secretsecretsecretsecret1234");
    expect(row!.redactionApplied).toBe(true);
  });

  it("OCR text is REDACTED before persist (sk-proj / password / JWT)", async () => {
    await seedMessage("m-a2", "z-a2", "group-A", "group");
    await saveInboundAttachment({
      messageId: "m-a2", zaloMessageId: "z-a2", threadId: "group-A", threadType: "group",
      senderId: "u1", kind: "image",
    });
    const secretOcr = "Menu cửa hàng B. key sk-proj-Ab3dEf6GhiJkLmNoPqRs012345_-6789 password=hunter2secretpw jwt eyJhbGciOi.eyJzdWIiOj.SflKxwRJSMk";
    await updateExtractionByZaloMessageId("z-a2", "image", {
      extractedText: secretOcr, description: "ảnh menu", status: "success", provider: "chiasegpu", confidence: 0.85,
    });
    const row = await prisma.attachment.findFirst({ where: { zaloMessageId: "z-a2", kind: "image" } });
    expect(row!.extractionStatus).toBe("success");
    expect(row!.extractedText ?? "").not.toContain("sk-proj-Ab3dEf6GhiJkLmNoPqRs012345_-6789");
    expect(row!.extractedText ?? "").not.toContain("hunter2secretpw");
    expect(row!.extractedText ?? "").not.toContain("eyJhbGciOi.eyJzdWIiOj.SflKxwRJSMk");
    expect(row!.extractedText ?? "").toContain("[REDACTED]");
    // non-secret words preserved
    expect(row!.extractedText ?? "").toContain("Menu");
    expect(row!.redactionApplied).toBe(true);
  });

  it("MENU CASE: search 'cửa hàng B' finds the group-A attachment; group-B returns none (no leak)", async () => {
    await seedMessage("m-a3", "z-a3", "group-A", "group");
    await saveInboundAttachment({ messageId: "m-a3", zaloMessageId: "z-a3", threadId: "group-A", threadType: "group", senderId: "u1", kind: "image" });
    await updateExtractionByZaloMessageId("z-a3", "image", {
      extractedText: "Menu cửa hàng B: cơm gà 45k, bún bò 50k", status: "success",
    });

    const inA = await searchAttachments({ threadId: "group-A", threadType: "group", query: "cửa hàng B", limit: 20 });
    expect(inA.length).toBe(1);
    expect(inA[0].attachmentId).toBeTruthy();
    expect(inA[0].messageId).toBe("m-a3");
    expect(inA[0].snippet).toContain("cửa hàng B");

    const inB = await searchAttachments({ threadId: "group-B", threadType: "group", query: "cửa hàng B", limit: 20 });
    expect(inB.length).toBe(0); // no cross-thread leak
  });

  it("user vs group same id do not collide (threadType scoping)", async () => {
    await seedMessage("m-u", "z-u", "77", "user");
    await saveInboundAttachment({ messageId: "m-u", zaloMessageId: "z-u", threadId: "77", threadType: "user", senderId: "u1", kind: "image" });
    await updateExtractionByZaloMessageId("z-u", "image", { extractedText: "thực đơn quán", status: "success" });

    const asUser = await searchAttachments({ threadId: "77", threadType: "user", query: "thực đơn", limit: 20 });
    const asGroup = await searchAttachments({ threadId: "77", threadType: "group", query: "thực đơn", limit: 20 });
    expect(asUser.length).toBe(1);
    expect(asGroup.length).toBe(0);
  });

  it("date range includes / excludes correctly", async () => {
    await seedMessage("m-d", "z-d", "group-A", "group");
    const att = await saveInboundAttachment({ messageId: "m-d", zaloMessageId: "z-d", threadId: "group-A", threadType: "group", senderId: "u1", kind: "image" });
    await updateExtractionByZaloMessageId("z-d", "image", { extractedText: "menu ngày 10/5", status: "success" });
    // force a known createdAt
    await prisma.attachment.update({ where: { id: att! }, data: { createdAt: new Date("2026-05-10T09:00:00.000Z") } });

    const inRange = await searchAttachments({ threadId: "group-A", query: "menu", dateFrom: new Date("2026-05-09"), dateTo: new Date("2026-05-11"), limit: 20 });
    expect(inRange.length).toBe(1);
    const outRange = await searchAttachments({ threadId: "group-A", query: "menu", dateFrom: new Date("2026-05-11"), dateTo: new Date("2026-05-20"), limit: 20 });
    expect(outRange.length).toBe(0);
  });

  it("extraction unavailable -> honest status, no invented text", async () => {
    await seedMessage("m-un", "z-un", "group-A", "group");
    await saveInboundAttachment({ messageId: "m-un", zaloMessageId: "z-un", threadId: "group-A", threadType: "group", senderId: "u1", kind: "image" });
    await updateExtractionByZaloMessageId("z-un", "image", { extractedText: null, description: null, status: "unavailable", provider: "none" });
    const row = await prisma.attachment.findFirst({ where: { zaloMessageId: "z-un" } });
    expect(row!.extractionStatus).toBe("unavailable");
    expect(row!.extractedText).toBeNull();
    expect(row!.description).toBeNull();
  });
});

describe("Phase 3.5A — metadata merge preserves _identity", () => {
  it("mergeVisionMetadata keeps existing _identity and adds vision", () => {
    const existing = JSON.stringify({ _identity: { confidence: "derived", source: ["groupId"] }, _sanitized: true });
    const out = mergeVisionMetadata(existing, { ocrText: "x", analyzed: true });
    const parsed = JSON.parse(out) as Record<string, any>;
    expect(parsed._identity).toEqual({ confidence: "derived", source: ["groupId"] });
    expect(parsed._sanitized).toBe(true);
    expect(parsed.vision).toEqual({ ocrText: "x", analyzed: true });
  });

  it("mergeVisionMetadata tolerates null/invalid existing metadata", () => {
    expect(JSON.parse(mergeVisionMetadata(null, { a: 1 })).vision).toEqual({ a: 1 });
    expect(JSON.parse(mergeVisionMetadata("not json", { a: 1 })).vision).toEqual({ a: 1 });
  });
});
