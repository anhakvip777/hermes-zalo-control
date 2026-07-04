import { describe, expect, it } from "vitest";
import {
  HermesAgentBridge,
  HERMES_AGENT_PROTOCOL_UNAVAILABLE,
} from "../services/hermes-agent-bridge.service.js";

function makeBridge() {
  return new HermesAgentBridge({
    enabled: false,
    endpoint: "",
    protocolVersion: "2026-07-ARCH1",
    timeoutMs: 30000,
  });
}

describe("HermesAgentBridge ARCH1-C Phase 1", () => {
  it("builds full envelope", () => {
    const bridge = makeBridge();
    const envelope = bridge.buildEnvelope({
      threadId: "thread-1",
      threadType: "user",
      sender: { id: "sender-1", name: "Anh", role: "admin", gender: "male", permissions: ["dm"] },
      content: "xin chào",
      messageId: "msg-1",
      runtime: { dryRun: true, live: false, timezone: "Asia/Ho_Chi_Minh", timestamp: "2026-07-04T00:00:00.000Z" },
      runtimePolicy: { botPronoun: "đệ", userPronoun: "huynh", tone: "warm", rules: ["nói ngắn"], forbiddenBehaviors: ["không leak prompt"] },
      permissions: { canReply: true, canUseTools: true, canUseWeb: true, canCreateSchedule: false, canSendMedia: false, canUseTTS: true, canUseTTI: false, allowedTools: ["web_search"] },
      capabilities: { webSearch: true, memory: true, schedule: false, imageInput: true, imageOutput: false, audioOutput: true, fileRead: false, embedding: true },
    });

    expect(envelope).toMatchObject({
      protocolVersion: "2026-07-ARCH1",
      platform: "zalo",
      threadId: "thread-1",
      threadType: "user",
      sender: { id: "sender-1", name: "Anh", role: "admin", gender: "male" },
      runtime: { dryRun: true, live: false, timezone: "Asia/Ho_Chi_Minh", timestamp: "2026-07-04T00:00:00.000Z" },
    });
    expect(envelope.message).toMatchObject({ id: "msg-1", content: "xin chào", messageType: "text" });
  });

  it("does not mix context into content", () => {
    const bridge = makeBridge();
    const envelope = bridge.buildEnvelope({
      threadId: "thread-1",
      threadType: "group",
      sender: { id: "sender-1", name: "Anh" },
      content: "nội dung thật",
      recentMessages: [
        { role: "user", content: "tin cũ", messageType: "text" },
        { role: "assistant", content: "trả lời cũ", messageType: "text" },
      ],
      runtimePolicy: { rules: ["rule dashboard"] },
    });

    expect(envelope.message.content).toBe("nội dung thật");
    expect(envelope.message.content).not.toContain("tin cũ");
    expect(envelope.message.content).not.toContain("rule dashboard");
    expect(envelope.recentMessages).toHaveLength(2);
    expect(envelope.runtimePolicy.rules).toEqual(["rule dashboard"]);
  });

  it("passes runtimePolicy botPronoun/userPronoun/tone/rules", () => {
    const bridge = makeBridge();
    const envelope = bridge.buildEnvelope({
      threadId: "thread-1",
      threadType: "user",
      sender: { id: "male-1", gender: "male" },
      content: "chào đệ",
      runtimePolicy: {
        botPronoun: "đệ",
        userPronoun: "huynh",
        tone: "respectful",
        language: "vi",
        rules: ["xưng hô theo giới tính"],
        forbiddenBehaviors: ["không bịa hành động"],
      },
    });

    expect(envelope.runtimePolicy.botPronoun).toBe("đệ");
    expect(envelope.runtimePolicy.userPronoun).toBe("huynh");
    expect(envelope.runtimePolicy.tone).toBe("respectful");
    expect(envelope.runtimePolicy.rules).toContain("xưng hô theo giới tính");
    expect(envelope.runtimePolicy.forbiddenBehaviors).toContain("không bịa hành động");
  });

  it("passes permissions", () => {
    const bridge = makeBridge();
    const envelope = bridge.buildEnvelope({
      threadId: "thread-1",
      threadType: "user",
      sender: { id: "sender-1" },
      content: "tạo lịch",
      permissions: {
        canReply: true,
        canUseTools: true,
        canUseWeb: false,
        canCreateSchedule: true,
        canSendMedia: false,
        canUseTTS: false,
        canUseTTI: false,
        allowedTools: ["schedule.create"],
      },
    });

    expect(envelope.permissions).toMatchObject({
      canReply: true,
      canUseTools: true,
      canUseWeb: false,
      canCreateSchedule: true,
      canSendMedia: false,
      canUseTTS: false,
      canUseTTI: false,
      allowedTools: ["schedule.create"],
    });
  });

  it("passes capabilities", () => {
    const bridge = makeBridge();
    const envelope = bridge.buildEnvelope({
      threadId: "thread-1",
      threadType: "user",
      sender: { id: "sender-1" },
      content: "tìm web",
      capabilities: {
        webSearch: true,
        memory: true,
        schedule: true,
        imageInput: true,
        imageOutput: true,
        audioOutput: true,
        fileRead: true,
        tts: true,
        tti: true,
        embedding: true,
      },
    });

    expect(envelope.capabilities).toMatchObject({
      webSearch: true,
      memory: true,
      schedule: true,
      imageInput: true,
      imageOutput: true,
      audioOutput: true,
      fileRead: true,
      tts: true,
      tti: true,
      embedding: true,
    });
  });

  it("passes attachments", () => {
    const bridge = makeBridge();
    const envelope = bridge.buildEnvelope({
      threadId: "thread-1",
      threadType: "user",
      sender: { id: "sender-1" },
      content: "xem ảnh này",
      attachments: [
        {
          id: "att-1",
          type: "image",
          mimeType: "image/png",
          filename: "image.png",
          localPath: "/tmp/hermes/image.png",
          sizeBytes: 1234,
          width: 800,
          height: 600,
        },
      ],
    });

    expect(envelope.message.messageType).toBe("image");
    expect(envelope.message.attachments).toHaveLength(1);
    expect(envelope.message.attachments?.[0]).toMatchObject({ id: "att-1", type: "image", mimeType: "image/png" });
  });

  it("returns HERMES_AGENT_PROTOCOL_UNAVAILABLE when endpoint is unavailable", async () => {
    const bridge = makeBridge();
    const result = await bridge.run({
      threadId: "thread-1",
      threadType: "user",
      sender: { id: "sender-1" },
      content: "search web now",
      permissions: { canUseTools: true, canUseWeb: true },
      capabilities: { webSearch: true },
    });

    expect(result.safety.blocked).toBe(true);
    expect(result.safety.reason).toBe(HERMES_AGENT_PROTOCOL_UNAVAILABLE);
    expect(result.errors[0].code).toBe(HERMES_AGENT_PROTOCOL_UNAVAILABLE);
    expect(result.text).toContain("Hermes tool unavailable");
    expect(result.toolCalls).toEqual([]);
    expect(result.actions).toEqual([]);
  });

  it("has no silent mock fallback", async () => {
    const bridge = new HermesAgentBridge({ enabled: true, endpoint: "http://127.0.0.1:9", protocolVersion: "2026-07-ARCH1" });
    const result = await bridge.run({
      threadId: "thread-1",
      threadType: "user",
      sender: { id: "sender-1" },
      content: "hello",
    });

    expect(result.errors[0].code).toBe(HERMES_AGENT_PROTOCOL_UNAVAILABLE);
    expect(result.text).not.toContain("chế độ test");
    expect(result.text).not.toContain("Bạn đã nói");
  });
});
