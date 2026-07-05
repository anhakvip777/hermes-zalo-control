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
import type { AgentToolResult, ToolContext, ToolRole } from "../tool-gateway/types.js";
import { hasUnsupportedSystemClaim, hasScheduleEvidence } from "../unsupported-claim-guard.service.js";
import type { AgentAdapter, AgentBridgeResult, AgentRequest, AgentResponse } from "./types.js";

export interface AgentBridgeInput {
  threadId: string;
  threadType: "user" | "group";
  senderId: string | null;
  senderName?: string;
  role: ToolRole;
  principalId: string | null;
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

export class AgentBridge {
  private readonly adapter: AgentAdapter;
  private readonly registry: ToolRegistry;
  private readonly gateway: ToolGateway;
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
    this.maxRounds = Math.min(Math.max(1, opts.maxRounds ?? 3), HARD_MAX_ROUNDS);
    this.maxCallsPerRound = Math.max(1, opts.maxCallsPerRound ?? 5);
    this.perRoundTimeoutMs = Math.max(1, opts.perRoundTimeoutMs ?? 30_000);
    this.totalTimeoutMs = Math.max(1, opts.totalTimeoutMs ?? 60_000);
    this.fallbackText = opts.fallbackText ?? DEFAULT_FALLBACK;
    this.nowFn = opts.now ?? Date.now;
    this.evidenceCheck = opts.hasScheduleEvidence ?? hasScheduleEvidence;
  }

  async run(input: AgentBridgeInput): Promise<AgentBridgeResult> {
    const request = this.buildRequest(input);
    const toolCtx: ToolContext = {
      agentName: input.agentName,
      threadId: input.threadId,
      threadType: input.threadType,
      senderId: input.senderId,
      role: input.role,
      principalId: input.principalId,
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
      if (this.nowFn() > deadline) {
        return this.fallback("total_timeout", toolResults, rounds);
      }

      let resp: AgentResponse;
      try {
        resp = await this.withTimeout(
          Promise.resolve(this.adapter.run(request, toolResults)),
          this.perRoundTimeoutMs,
        );
      } catch (err: unknown) {
        return this.fallback(
          err instanceof Error && err.message === "__timeout__" ? "adapter_timeout" : "adapter_error",
          toolResults,
          rounds,
        );
      }

      if (resp.safety?.blocked) {
        return this.fallback(`adapter_safety:${resp.safety.reason ?? "blocked"}`, toolResults, rounds);
      }

      const calls = resp.toolCalls ?? [];
      confidence = resp.confidence ?? confidence;

      // Terminal: no tool calls, or we've hit the round cap → take the text.
      if (calls.length === 0 || rounds >= this.maxRounds) {
        finalText = (resp.text ?? "").trim();
        if (calls.length > 0 && rounds >= this.maxRounds) {
          // Wanted more tools but hit the cap → don't trust a partial claim.
          return this.fallback("max_rounds", toolResults, rounds, finalText || undefined);
        }
        break;
      }

      // Execute this round's tool calls via the gateway (perms + redaction + evidence).
      for (const call of calls.slice(0, this.maxCallsPerRound)) {
        const result = await this.gateway.execute(call, toolCtx);
        toolResults.push(result);
      }
      rounds++;
    }

    // ── Unsupported-claim guard (shared) ────────────────────────────
    if (finalText && hasUnsupportedSystemClaim(finalText)) {
      const turnEvidence = this.hasSuccessfulWriteOrOutbound(toolResults);
      const dbEvidence = turnEvidence ? true : await this.evidenceCheck(input.threadId);
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

  private buildRequest(input: AgentBridgeInput): AgentRequest {
    // Bridge OWNS allowedTools — derived from role + registry. The adapter cannot
    // expand it; the gateway independently enforces permission on execute anyway.
    const allowedTools = buildAllowedTools(input.role, this.registry.list());
    return {
      threadId: input.threadId,
      threadType: input.threadType,
      sender: { id: input.senderId, name: input.senderName, role: input.role },
      content: input.content,
      recentMessages: input.recentMessages ?? [],
      scheduleContext: input.scheduleContext,
      runtime: input.runtime ?? { dryRun: true, live: false },
      permissions: { canUseTools: allowedTools.length > 0, allowedTools },
      metadata: { agentName: input.agentName ?? null },
    };
  }

  /** Turn-local evidence: a successful write/outbound tool ran this turn. */
  private hasSuccessfulWriteOrOutbound(results: AgentToolResult[]): boolean {
    return results.some(
      (r) =>
        (r.kind === "write" || r.kind === "outbound") &&
        r.executionStatus === "success" &&
        (r.deliveryStatus === "live_sent" || r.deliveryStatus === "dry_run"),
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
