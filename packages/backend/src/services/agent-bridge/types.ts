// =============================================================================
// Agent Bridge — neutral, agent-agnostic protocol (Phase 5)
// =============================================================================
// Core names are neutral (Agent*, no Hermes). Adapters (HermesAdapter first,
// later ClaudeAdapter/OpenAIAdapter/...) map their own I/O to/from these types.
// Reuses the gateway's AgentToolCall / AgentToolResult (Phase 1) — no duplication.
// =============================================================================

import type { AgentToolCall, AgentToolResult, ToolRole } from "../tool-gateway/types.js";

export interface AgentSender {
  id: string | null;
  name?: string;
  role: ToolRole;
}

export interface AgentRuntime {
  dryRun: boolean;
  live: boolean;
}

export interface AgentPermissions {
  canUseTools: boolean;
  /** Built by the Bridge from role + registry. Adapters MUST NOT expand this. */
  allowedTools: string[];
}

export interface AgentRequest {
  threadId: string;
  threadType: "user" | "group";
  sender: AgentSender;
  content: string;
  recentMessages: string[];
  scheduleContext?: string;
  runtime: AgentRuntime;
  permissions: AgentPermissions;
  metadata?: Record<string, unknown>;
}

export interface AgentResponse {
  /** Final (or intermediate) text from the agent. */
  text?: string;
  /** Tool calls the agent wants executed this round. */
  toolCalls?: AgentToolCall[];
  confidence?: number;
  safety?: { blocked?: boolean; reason?: string };
}

/**
 * An agent adapter. `run` is called once per loop round with the accumulated
 * tool results so far. It must NEVER call zca-js / getApi / sendMessage — it
 * only returns text and/or tool calls; the Bridge executes tools via the gateway.
 */
export interface AgentAdapter {
  readonly name: string;
  run(request: AgentRequest, priorToolResults: AgentToolResult[]): Promise<AgentResponse>;
}

export interface AgentBridgeResult {
  /** Final text to hand to the dispatcher (already claim-guarded). */
  text: string;
  confidence?: number;
  rounds: number;
  toolResults: AgentToolResult[];
  /** True when a safe fallback was used (error/timeout/too-many-rounds/claim). */
  usedFallback: boolean;
  reason?: string;
}

export type { AgentToolCall, AgentToolResult } from "../tool-gateway/types.js";
