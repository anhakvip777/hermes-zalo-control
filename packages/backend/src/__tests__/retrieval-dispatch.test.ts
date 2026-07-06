// =============================================================================
// Phase 3.5E-D — retrieval-answer dispatcher integration (dryRun-only)
// =============================================================================
// Drives handleIncomingMessage() with a flag-gated retrieval branch. Deterministic
// mocks control the flag, effective dryRun, allowlist, and live-test state; a
// passthrough+counter wraps answerRetrieval so we can both use the real service
// (found/not_found on test.db) and force permission_denied/unavailable. No live,
// no zca-js, no provider — proven by dryRun OutboundRecord + no agent task.
// =============================================================================

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const h = vi.hoisted(() => ({
  flagEnabled: false,
  effectiveDryRun: true,
  allowed: true,
  liveForThread: false,
  answer: null as null | Record<string, unknown>,
  answerCalls: 0,
  lastInput: null as null | Record<string, unknown>,
}));

vi.mock("../config.js", async (io) => {
  const a = await io<typeof import("../config.js")>();
  return {
    config: {
      ...a.config,
      autoReply: { ...a.config.autoReply, enabled: false }, // stays OFF
      retrieval: {
        get dispatcherDryRunEnabled() { return h.flagEnabled; },
      },
    },
  };
});

vi.mock("../services/runtime-config.service.js", async (io) => {
  const a = await io<typeof import("../services/runtime-config.service.js")>();
  return { ...a, getCurrentEffectiveDryRun: () => h.effectiveDryRun };
});

vi.mock("../services/allowlist.service.js", async (io) => {
  const a = await io<typeof import("../services/allowlist.service.js")>();
  return { ...a, isThreadAllowedCached: () => h.allowed };
});

vi.mock("../services/live-test.service.js", async (io) => {
  const a = await io<typeof import("../services/live-test.service.js")>();
  return { ...a, shouldSendLiveForThread: async () => ({ live: h.liveForThread }) };
});

vi.mock("../services/retrieval-answer.service.js", async (io) => {
  const a = await io<typeof import("../services/retrieval-answer.service.js")>();
  return {
    ...a,
    answerRetrieval: async (input: any) => {
      h.answerCalls++;
      h.lastInput = input;
      return h.answer ?? (a.answerRetrieval as any)(input);
    },
  };
});

import { handleIncomingMessage } from "../services/incoming-dispatcher.service.js";
import { prisma } from "../db.js";
import { cleanDatabase } from "./shared-setup.js";
import { clearAllCooldowns } from "../services/cooldown.service.js";
import type { NormalizedMessage } from "../services/zalo-receive.js";

const THREAD = "demo-user-shopB";
const OCR = "Menu cửa hàng B:\n- Cơm gà 45k\n- Bún bò 50k\n- Trà đào 25k\nsk-test-THIS_SHOULD_BE_REDACTED_1234567890";

function inbound(content: string, over: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    zaloMessageId: "in-1",
    threadId: THREAD,
    threadType: "user",
    senderId: "u1",
    senderName: "User One",
    content,
    messageType: "text",
    rawMetadata: "{}",
    mentions: undefined,
    identityConfidence: "exact",
    ...(over as any),
  } as NormalizedMessage;
}

async function seedMenu(threadId = THREAD) {
  const { saveInboundAttachment, updateExtractionByZaloMessageId } = await import(
    "../services/attachment.service.js"
  );
  await prisma.message.create({
    data: {
      id: "seed-msg-1", zaloMessageId: "seed-zz-1", threadId, threadType: "user",
      content: "[Ảnh Zalo]", isFromBot: false, messageType: "image", receivedAt: new Date(),
    },
  });
  await saveInboundAttachment({
    messageId: "seed-msg-1", zaloMessageId: "seed-zz-1", threadId, threadType: "user",
    senderId: "u1", kind: "image",
  });
  await updateExtractionByZaloMessageId("seed-zz-1", "image", { extractedText: OCR, status: "success" });
}

beforeEach(async () => {
  await cleanDatabase();
  await clearAllCooldowns();
  h.flagEnabled = false;
  h.effectiveDryRun = true;
  h.allowed = true;
  h.liveForThread = false;
  h.answer = null;
  h.answerCalls = 0;
  h.lastInput = null;
});
afterAll(async () => { await cleanDatabase(); });

describe("Phase 3.5E — retrieval dispatch (dryRun-only)", () => {
  it("flag OFF → retrieval branch does not run (falls through to auto_reply_disabled)", async () => {
    h.flagEnabled = false;
    const r = await handleIncomingMessage(inbound("gửi tôi thực đơn cửa hàng B"));
    expect(h.answerCalls).toBe(0);
    expect(r.reason).toBe("auto_reply_disabled");
    expect(await prisma.outboundRecord.count()).toBe(0);
  });

  it("non-intent ('hi') is ignored even with flag ON", async () => {
    h.flagEnabled = true;
    const r = await handleIncomingMessage(inbound("hi"));
    expect(h.answerCalls).toBe(0);
    expect(r.reason).toBe("auto_reply_disabled"); // fell through
  });

  it("intent detected → answerRetrieval called with a derived short search term", async () => {
    h.flagEnabled = true;
    await seedMenu();
    await handleIncomingMessage(inbound("gửi tôi thực đơn cửa hàng B"));
    expect(h.answerCalls).toBe(1);
    expect(String((h.lastInput as any)?.query)).toContain("cửa hàng");
    expect(String((h.lastInput as any)?.query)).not.toContain("gửi");
  });

  it("found → dryRun OutboundRecord with synthetic dry-run id, no live, no agent task", async () => {
    h.flagEnabled = true;
    await seedMenu();
    const r = await handleIncomingMessage(inbound("gửi tôi thực đơn cửa hàng B"));
    expect(r.dispatched).toBe(true);
    const recs = await prisma.outboundRecord.findMany();
    expect(recs.length).toBe(1);
    expect(recs[0].dryRun).toBe(true);
    expect(recs[0].sentMessageId ?? "").toMatch(/^dry-run-/);
    expect(recs[0].content).toContain("cửa hàng B");
    expect(recs[0].content).not.toContain("sk-test-THIS_SHOULD_BE_REDACTED_1234567890");
    // No live record.
    expect(await prisma.outboundRecord.count({ where: { dryRun: false } })).toBe(0);
    // Retrieval branch returns before the normal Hermes pipeline → no agent task.
    expect(await prisma.agentTask.count()).toBe(0);
  });

  it("not_found → dryRun a truthful message (no hallucination)", async () => {
    h.flagEnabled = true;
    await seedMenu();
    const r = await handleIncomingMessage(inbound("tìm giúp mình xyz-khong-ton-tai-99999"));
    expect(r.dispatched).toBe(true);
    const recs = await prisma.outboundRecord.findMany();
    expect(recs.length).toBe(1);
    expect(recs[0].dryRun).toBe(true);
    expect(recs[0].content).toBe("Mình chưa tìm thấy thông tin phù hợp trong phạm vi được phép.");
    expect(recs[0].content).not.toContain("Cơm gà");
  });

  it("permission_denied → NO outbound", async () => {
    h.flagEnabled = true;
    h.answer = { status: "permission_denied", answerText: "no", evidence: [], confidence: "low" };
    const r = await handleIncomingMessage(inbound("gửi tôi thực đơn cửa hàng B"));
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("retrieval_permission_denied");
    expect(await prisma.outboundRecord.count()).toBe(0);
  });

  it("unavailable → NO outbound", async () => {
    h.flagEnabled = true;
    h.answer = { status: "unavailable", answerText: "err", evidence: [], confidence: "low" };
    const r = await handleIncomingMessage(inbound("gửi tôi thực đơn cửa hàng B"));
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("retrieval_unavailable");
    expect(await prisma.outboundRecord.count()).toBe(0);
  });

  it("hard dryRun guard: effective dryRun false → abort, no send, answerRetrieval not called", async () => {
    h.flagEnabled = true;
    h.effectiveDryRun = false;
    const r = await handleIncomingMessage(inbound("gửi tôi thực đơn cửa hàng B"));
    expect(r.reason).toBe("retrieval_abort_not_dryrun");
    expect(h.answerCalls).toBe(0);
    expect(await prisma.outboundRecord.count()).toBe(0);
  });

  it("live-test session active → abort, no send", async () => {
    h.flagEnabled = true;
    h.liveForThread = true;
    const r = await handleIncomingMessage(inbound("gửi tôi thực đơn cửa hàng B"));
    expect(r.reason).toBe("retrieval_abort_live_test");
    expect(h.answerCalls).toBe(0);
    expect(await prisma.outboundRecord.count()).toBe(0);
  });

  it("allowlist respected: thread not allowed → no retrieval outbound", async () => {
    h.flagEnabled = true;
    h.allowed = false;
    const r = await handleIncomingMessage(inbound("gửi tôi thực đơn cửa hàng B"));
    expect(r.reason).toBe("thread_not_allowed");
    expect(h.answerCalls).toBe(0);
    expect(await prisma.outboundRecord.count()).toBe(0);
  });

  it("idempotency: same inbound processed twice → exactly one outbound", async () => {
    h.flagEnabled = true;
    await seedMenu();
    await handleIncomingMessage(inbound("gửi tôi thực đơn cửa hàng B"));
    await clearAllCooldowns(); // isolate idempotency from the cooldown gate
    await handleIncomingMessage(inbound("gửi tôi thực đơn cửa hàng B")); // same zaloMessageId "in-1"
    // One reserved+updated record; the retry is skipped as duplicate_idempotency.
    expect(await prisma.outboundRecord.count()).toBe(1);
  });
});
