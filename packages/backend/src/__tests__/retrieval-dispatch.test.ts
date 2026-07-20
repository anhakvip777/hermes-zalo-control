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
  bridgeEnabled: false,
  autoReplyEnabled: false,
  effectiveDryRun: true,
  allowed: true,
  liveForThread: false,
  principalFailure: false,
  answer: null as null | Record<string, unknown>,
  answerCalls: 0,
  lastInput: null as null | Record<string, unknown>,
}));

vi.mock("../config.js", async (io) => {
  const a = await io<typeof import("../config.js")>();
  return {
    config: {
      ...a.config,
      autoReply: {
        ...a.config.autoReply,
        get enabled() { return h.autoReplyEnabled; },
      },
      retrieval: {
        get dispatcherDryRunEnabled() { return h.flagEnabled; },
      },
      hermesAgentBridge: {
        ...a.config.hermesAgentBridge,
        get enabled() { return h.bridgeEnabled; },
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

vi.mock("../services/principal.service.js", async (io) => {
  const a = await io<typeof import("../services/principal.service.js")>();
  return {
    ...a,
    resolvePrincipal: async (...args: Parameters<typeof a.resolvePrincipal>) => {
      if (h.principalFailure) throw new Error("raw principal DB failure");
      return a.resolvePrincipal(...args);
    },
  };
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

// Unique inbound id PER TEST. The outbound idempotency key is
// `reply:${zaloMessageId}:${threadId}:${threadType}`; a shared "in-1" across
// every test makes all tests collide on one key, so a leaked fire-and-forget
// write from a prior test can make the next test skip as duplicate_idempotency.
// A fresh id each test keeps keys unique across tests while staying identical
// within a test (so the idempotency-retry case still shares one key).
let inboundSeq = 0;
let currentInboundId = "in-1";

function inbound(content: string, over: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    zaloMessageId: currentInboundId,
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
  currentInboundId = `in-${++inboundSeq}`;
  h.flagEnabled = false;
  h.bridgeEnabled = false;
  h.autoReplyEnabled = false;
  h.effectiveDryRun = true;
  h.allowed = true;
  h.liveForThread = false;
  h.principalFailure = false;
  h.answer = null;
  h.answerCalls = 0;
  h.lastInput = null;
});
afterAll(async () => { await cleanDatabase(); });

describe("Phase 3.5E — retrieval dispatch (dryRun-only)", () => {
  it("structured mode owns retrieval intents and fails closed before retrieval without an internal message id", async () => {
    h.flagEnabled = true;
    h.bridgeEnabled = true;
    h.autoReplyEnabled = true;
    const { config: importedConfig } = await import("../config.js");
    expect(importedConfig.hermesAgentBridge.enabled).toBe(true);
    expect(importedConfig.autoReply.enabled).toBe(true);

    const r = await handleIncomingMessage(
      inbound("gửi tôi thực đơn cửa hàng B", { dbMessageId: undefined }),
    );

    expect(r).toEqual({
      dispatched: false,
      reason: "agent_bridge_internal_message_id_missing",
    });
    expect(h.answerCalls).toBe(0);
    expect(await prisma.outboundRecord.count()).toBe(0);
  });

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

  // Regression for the Hướng C anomaly: on the real listener path the inbound
  // request is persisted to Message BEFORE dispatch. A not-found query must not
  // match the user's OWN just-persisted request text (which contains generic
  // command words like "gửi tôi") and wrongly return found.
  it("not_found even when the user's own request is already persisted (no self-match)", async () => {
    h.flagEnabled = true;
    await seedMenu();
    // Simulate the real path: the inbound request row exists before dispatch,
    // sharing the SAME zaloMessageId as the inbound the dispatcher will exclude.
    await prisma.message.create({
      data: {
        id: "self-req-1", zaloMessageId: currentInboundId, threadId: THREAD, threadType: "user",
        senderId: "u1", content: "gửi tôi xyz-khong-ton-tai-999", isFromBot: false,
        messageType: "text", role: "user", receivedAt: new Date(),
      },
    });
    const r = await handleIncomingMessage(inbound("gửi tôi xyz-khong-ton-tai-999"));
    expect(r.dispatched).toBe(true);
    const recs = await prisma.outboundRecord.findMany();
    expect(recs.length).toBe(1);
    expect(recs[0].content).toBe("Mình chưa tìm thấy thông tin phù hợp trong phạm vi được phép.");
    expect(r.reason).toBe("retrieval_not_found");
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

  it("principal resolution failure → fail closed with no retrieval or outbound", async () => {
    h.flagEnabled = true;
    h.principalFailure = true;

    const r = await handleIncomingMessage(inbound("gửi tôi thực đơn của cửa hàng B"));

    expect(r).toEqual({ dispatched: false, reason: "principal_resolution_failed" });
    expect(h.answerCalls).toBe(0);
    expect(await prisma.outboundRecord.count()).toBe(0);
    expect(await prisma.agentTask.count()).toBe(0);
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
    await handleIncomingMessage(inbound("gửi tôi thực đơn cửa hàng B")); // same currentInboundId → same idempotency key
    // One reserved+updated record; the retry is skipped as duplicate_idempotency.
    expect(await prisma.outboundRecord.count()).toBe(1);
  });
});
