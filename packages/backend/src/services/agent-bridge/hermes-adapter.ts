// =============================================================================
// HermesAdapter (Phase 5) — first AgentAdapter
// =============================================================================
// Delegates to the existing text-only HermesChatAdapter → returns AgentResponse
// with text and NO toolCalls (0-round loop). This proves the agent-agnostic path
// end-to-end without a new external endpoint. A real structured Hermes HTTP/MCP
// endpoint (tool-emitting) is future work — NOT implemented here.
//
// NEVER imports zca-js / calls getApi / sendMessage.
// =============================================================================

import type { AgentAdapter, AgentRequest, AgentResponse } from "./types.js";
import type { AgentToolResult } from "../tool-gateway/types.js";

export class HermesAdapter implements AgentAdapter {
  readonly name = "hermes";

  async run(request: AgentRequest, _priorToolResults: AgentToolResult[]): Promise<AgentResponse> {
    const { getHermesChatAdapter } = await import("../hermes-chat-adapter.js");
    const adapter = getHermesChatAdapter();
    const reply = await adapter.generateReply({
      threadId: request.threadId,
      threadType: request.threadType,
      senderId: request.sender.id ?? "",
      senderName: request.sender.name,
      content: request.content,
      recentMessages: request.recentMessages,
      scheduleContext: request.scheduleContext,
    });
    return { text: reply.reply ?? "", confidence: reply.confidence, toolCalls: [] };
  }
}
