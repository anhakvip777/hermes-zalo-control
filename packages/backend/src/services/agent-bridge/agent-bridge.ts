// =============================================================================
// AgentBridge — bounded, agent-agnostic tool loop (Phase 5)
// =============================================================================
// Orchestrates: build AgentRequest (allowedTools from Bridge) → adapter.run →
// execute toolCalls via ToolGateway → feed results back → repeat, BOUNDED by
// max rounds + per-round + total timeouts. On any error/timeout/too-many-rounds
// → safe fallback. Applies the shared unsupported-claim guard using turn-local
// tool evidence + DB evidence. NEVER calls zca-js/getApi/sendMessage.
//
// Structured bridge is OFF by default (config.hermesAgentBridge.enabled=false);
// this class is only constructed when the flag is on (or in tests).
// =============================================================================

import { ToolGateway } from "../tool-gateway/gateway.js";
import { getToolRegistry, type ToolRegistry } from "../tool-gateway/registry.js";
import { buildAllowedTools } from "../tool-gateway/permissions.js";
import { redact } from "../tool-gateway/redaction.js";
import type { AgentToolResult, ToolContext, ToolRole } from "../tool-gateway/types.js";
import { hasUnsupportedSystemClaim, hasScheduleEvidence } from "../unsupported-claim-guard.service.js";
import { MAX_AGENT_TOOL_CALLS, parseAgentResponse } from "./agent-response-schema.js";
import type { AgentAdapter, AgentBridgeResult, AgentRequest, AgentResponse } from "./types.js";

export interface AgentBridgeInput {
  threadId: string;
  threadType: "user" | "group";
  senderId: string | null;
  senderName?: string;
  role: ToolRole;
  principalId: string | null;
  /** Trusted caller assertion; absent means the gateway resolves blocked status. */
  principalBlocked?: boolean;
  /** Exact AgentTask.id owned by the caller. */
  agentTaskId?: string;
  content: string;
  recentMessages?: string[];
  scheduleContext?: string;
  agentName?: string;
  relatedMessageId?: string;
  runtime?: { dryRun: boolean; live: boolean };
}

export interface AgentBridgeOptions {
  adapter: AgentAdapter;
  registry?: ToolRegistry;
  gateway?: ToolGateway;
  /** Configured provider-neutral names; missing means no tools are granted. */
  allowedToolNames?: readonly string[];
  maxRounds?: number; // default 3, cap 5
  maxCallsPerRound?: number; // default 5
  perRoundTimeoutMs?: number; // default 30_000
  totalTimeoutMs?: number; // default 60_000
  now?: () => number;
  /** Safe fallback text when the loop cannot produce a trustworthy answer. */
  fallbackText?: string;
  /** Injectable DB-evidence check (default: shared hasScheduleEvidence). */
  hasScheduleEvidence?: (threadId: string) => Promise<boolean>;
}

const HARD_MAX_ROUNDS = 5;
const DEFAULT_FALLBACK = "Xin lỗi, mình chưa xử lý được yêu cầu này. Bạn thử lại sau nhé.";

function redactProviderText(value: string): string {
  const safe = redact(value);
  return typeof safe === "string" ? safe : "[REDACTED]";
}

export class AgentBridge {
  private readonly adapter: AgentAdapter;
  private readonly registry: ToolRegistry;
  private readonly gateway: ToolGateway;
  private readonly allowedToolNames: readonly string[];
  private readonly maxRounds: number;
  private readonly maxCallsPerRound: number;
  private readonly perRoundTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly fallbackText: string;
  private readonly nowFn: () => number;
  private readonly evidenceCheck: (threadId: string) => Promise<boolean>;

  constructor(opts: AgentBridgeOptions) {
    this.adapter = opts.adapter;
    this.registry = opts.registry ?? getToolRegistry();
    this.gateway = opts.gateway ?? new ToolGateway({ registry: this.registry });
    this.allowedToolNames = Object.freeze([...(opts.allowedToolNames ?? [])]);
    this.maxRounds = Math.min(Math.max(1, opts.maxRounds ?? 3), HARD_MAX_ROUNDS);
    const requestedMaxCalls = opts.maxCallsPerRound ?? MAX_AGENT_TOOL_CALLS;
    this.maxCallsPerRound = Number.isFinite(requestedMaxCalls)
      ? Math.min(Math.max(1, Math.floor(requestedMaxCalls)), MAX_AGENT_TOOL_CALLS)
      : MAX_AGENT_TOOL_CALLS;
    this.perRoundTimeoutMs = Math.max(1, opts.perRoundTimeoutMs ?? 30_000);
    this.totalTimeoutMs = Math.max(1, opts.totalTimeoutMs ?? 60_000);
    this.fallbackText = opts.fallbackText ?? DEFAULT_FALLBACK;
    this.nowFn = opts.now ?? Date.now;
    this.evidenceCheck = opts.hasScheduleEvidence ?? hasScheduleEvidence;
  }

  async run(input: AgentBridgeInput): Promise<AgentBridgeResult> {
    const allowedTools = buildAllowedTools(input.role, this.registry.list(), this.allowedToolNames);
    Object.freeze(allowedTools);
    const request = this.buildRequest(input, allowedTools);
    const toolCtx: ToolContext = {
      agentName: input.agentName,
      allowedTools,
      threadId: input.threadId,
      threadType: input.threadType,
      senderId: input.senderId,
      role: input.role,
      principalId: input.principalId,
      principalBlocked: input.principalBlocked,
      agentTaskId: input.agentTaskId,
      relatedMessageId: input.relatedMessageId,
    };

    const deadline = this.nowFn() + this.totalTimeoutMs;
    const toolResults: AgentToolResult[] = [];
    let rounds = 0;
    let finalText = "";
    let confidence: number | undefined;

    // ── Bounded loop ────────────────────────────────────────────────
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const remainingForAdapter = deadline - this.nowFn();
      if (remainingForAdapter <= 0) {
        return this.fallback("total_timeout", toolResults, rounds);
      }

      let rawResponse: unknown;
      const adapterBoundByTotal = remainingForAdapter <= this.perRoundTimeoutMs;
      try {
        rawResponse = await this.withTimeout(
          Promise.resolve(this.adapter.run(request, toolResults)),
          Math.min(this.perRoundTimeoutMs, remainingForAdapter),
        );
      } catch (err: unknown) {
        const timedOut = err instanceof Error && err.message === "__timeout__";
        if ((timedOut && adapterBoundByTotal) || this.nowFn() >= deadline) {
          return this.fallback("total_timeout", toolResults, rounds);
        }
        return this.fallback(
          timedOut ? "adapter_timeout" : "adapter_error",
          toolResults,
          rounds,
        );
      }

      if (this.nowFn() >= deadline) {
        return this.fallback("total_timeout", toolResults, rounds);
      }

      let resp: AgentResponse;
      try {
        resp = parseAgentResponse(rawResponse);
      } catch {
        return this.fallback("malformed_response", toolResults, rounds);
      }

      if (resp.safety?.blocked) {
        return this.fallback("adapter_safety", toolResults, rounds);
      }

      const calls = resp.toolCalls ?? [];
      confidence = resp.confidence ?? confidence;

      if (calls.length > this.maxCallsPerRound) {
        return this.fallback("max_calls_per_round", toolResults, rounds);
      }

      // Terminal: no tool calls, or we've hit the round cap → take the text.
      if (calls.length === 0 || rounds >= this.maxRounds) {
        finalText = (resp.text ?? "").trim();
        if (calls.length > 0 && rounds >= this.maxRounds) {
          // Wanted more tools but hit the cap → don't trust a partial claim.
          return this.fallback("max_rounds", toolResults, rounds);
        }
        break;
      }

      // Execute this round's tool calls via the gateway (perms + redaction + evidence).
      for (const call of calls) {
        const remainingForTool = deadline - this.nowFn();
        if (remainingForTool <= 0) {
          return this.fallback("total_timeout", toolResults, rounds);
        }

        let result: AgentToolResult;
        try {
          result = await this.withTimeout(
            Promise.resolve(this.gateway.execute(call, toolCtx)),
            remainingForTool,
          );
        } catch (err: unknown) {
          if (
            (err instanceof Error && err.message === "__timeout__") ||
            this.nowFn() >= deadline
          ) {
            return this.fallback("total_timeout", toolResults, rounds);
          }
          return this.fallback("tool_gateway_error", toolResults, rounds);
        }
        toolResults.push(result);

        if (this.nowFn() >= deadline) {
          return this.fallback("total_timeout", toolResults, rounds);
        }
        if (result.executionStatus !== "success") {
          return this.fallback(this.toolFailureReason(result), toolResults, rounds);
        }
      }
      rounds++;
    }

    // ── Unsupported-claim guard (shared) ────────────────────────────
    if (finalText && hasUnsupportedSystemClaim(finalText)) {
      const turnEvidence = this.hasSuccessfulWriteOrOutbound(toolResults);
      let dbEvidence = turnEvidence;
      if (!turnEvidence) {
        const remainingForEvidence = deadline - this.nowFn();
        if (remainingForEvidence <= 0) {
          return this.fallback("total_timeout", toolResults, rounds);
        }
        try {
          dbEvidence = await this.withTimeout(
            Promise.resolve(this.evidenceCheck(input.threadId)),
            remainingForEvidence,
          );
        } catch (err: unknown) {
          if (
            (err instanceof Error && err.message === "__timeout__") ||
            this.nowFn() >= deadline
          ) {
            return this.fallback("total_timeout", toolResults, rounds);
          }
          return this.fallback("evidence_check_error", toolResults, rounds);
        }
        if (this.nowFn() >= deadline) {
          return this.fallback("total_timeout", toolResults, rounds);
        }
      }
      if (!turnEvidence && !dbEvidence) {
        return this.fallback("unsupported_system_claim", toolResults, rounds);
      }
    }

    if (!finalText) {
      return this.fallback("empty_final_text", toolResults, rounds);
    }

    return { text: finalText, confidence, rounds, toolResults, usedFallback: false };
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private buildRequest(input: AgentBridgeInput, allowedTools: string[]): AgentRequest {
    // The same frozen exact grant crosses both adapter and gateway boundaries.
    return {
      threadId: input.threadId,
      threadType: input.threadType,
      sender: {
        id: input.senderId,
        name: input.senderName === undefined ? undefined : redactProviderText(input.senderName),
        role: input.role,
      },
      content: redactProviderText(input.content),
      recentMessages: (input.recentMessages ?? []).map(redactProviderText),
      scheduleContext:
        input.scheduleContext === undefined ? undefined : redactProviderText(input.scheduleContext),
      runtime: input.runtime ?? { dryRun: true, live: false },
      permissions: { canUseTools: allowedTools.length > 0, allowedTools },
      metadata: { agentName: input.agentName ?? null },
    };
  }

  private toolFailureReason(result: AgentToolResult): string {
    if (result.error?.code === "invalid_args") return "tool_invalid_args";
    if (result.error?.code === "timeout") return "tool_timeout";
    if (result.executionStatus === "unavailable") return "tool_unavailable";
    if (result.executionStatus === "blocked") return "tool_blocked";
    return "tool_failed";
  }

  /** Turn-local evidence: a successful live write/outbound ran this turn. */
  private hasSuccessfulWriteOrOutbound(results: AgentToolResult[]): boolean {
    return results.some(
      (r) =>
        (r.kind === "write" || r.kind === "outbound") &&
        r.executionStatus === "success" &&
        r.deliveryStatus === "live_sent",
    );
  }

  private fallback(reason: string, toolResults: AgentToolResult[], rounds: number, text?: string): AgentBridgeResult {
    return { text: text ?? this.fallbackText, confidence: 0, rounds, toolResults, usedFallback: true, reason };
  }

  private async withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("__timeout__")), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
