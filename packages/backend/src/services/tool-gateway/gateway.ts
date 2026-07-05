// =============================================================================
// Tool Gateway — orchestrator (Phase 1)
// =============================================================================
// Single, permissioned, audited entry point for every agent tool call.
//
// Order: resolve context → registry lookup → permission → dataScope → validate
//        args → idempotency (write/outbound) → dryRun/live decision → execute
//        under per-tool timeout → redact → persist ToolCallRecord → return.
//
// - agentName from ToolContext (fallback "hermes"); Hermes never hardcoded in core.
// - caller-passed role/principal preferred; fallback resolvePrincipal.
// - per-tool timeout (Phase 1); total agent-loop timeout is Phase 5. No retry.
// - errors never thrown across the boundary → mapped to AgentToolResult.
// =============================================================================

import { createHash } from "node:crypto";
import {
  DEFAULT_AGENT_NAME,
  DEFAULT_TOOL_TIMEOUT_MS,
  type AgentToolCall,
  type AgentToolResult,
  type DeliveryStatus,
  type ExecutionStatus,
  type ToolContext,
  type ToolDefinition,
  type ToolEvidenceSink,
  type ToolRole,
} from "./types.js";
import { ToolError, executionStatusForError, toolErrors } from "./errors.js";
import { ToolRegistry, getToolRegistry } from "./registry.js";
import { checkDataScope, checkToolPermission, roleLevel } from "./permissions.js";
import { validateArgs, validateResult } from "./schema.js";
import { getToolEvidenceSink } from "./evidence.js";
import { redact, redactToJson } from "./redaction.js";

export interface ResolvedRole {
  role: ToolRole;
  principalId: string | null;
  blocked: boolean;
}

export interface ToolGatewayOptions {
  registry?: ToolRegistry;
  evidence?: ToolEvidenceSink;
  /** Effective global dryRun. Default: runtime-config getCurrentEffectiveDryRun (dynamic import). */
  getDryRun?: () => boolean | Promise<boolean>;
  /** Whether a live-test session authorizes a live send for a thread. Default: live-test.service. */
  getLiveAllowed?: (threadId: string) => boolean | Promise<boolean>;
  /** Role/principal resolver fallback. Default: principal.service resolvePrincipal. */
  resolveRole?: (senderId: string | null | undefined, threadId: string) => Promise<ResolvedRole>;
  /** Whether a role may see phone numbers (redaction). Default: admin only. */
  allowPhoneForRole?: (role: ToolRole) => boolean;
  /** Clock (testable). */
  now?: () => number;
  defaultTimeoutMs?: number;
}

const DEFAULT_ROLE: ToolRole = "form_only";

export class ToolGateway {
  private readonly registry: ToolRegistry;
  private readonly evidence: ToolEvidenceSink;
  private readonly opts: ToolGatewayOptions;

  constructor(opts: ToolGatewayOptions = {}) {
    this.opts = opts;
    this.registry = opts.registry ?? getToolRegistry();
    this.evidence = opts.evidence ?? getToolEvidenceSink();
  }

  async execute(call: AgentToolCall, ctx: ToolContext): Promise<AgentToolResult> {
    const startedAt = new Date(this.now());
    const agentName = (ctx.agentName && ctx.agentName.trim()) || DEFAULT_AGENT_NAME;
    const def = this.registry.get(call.name);

    // 1. ── Resolve role/principal (caller-preferred; fallback resolver) ──
    let role: ToolRole = ctx.role ?? DEFAULT_ROLE;
    let principalId: string | null = ctx.principalId ?? null;
    let principalBlocked = false;
    if (ctx.role == null) {
      const resolved = await this.resolveRole(ctx.senderId, ctx.threadId);
      role = resolved.role;
      principalId = resolved.principalId;
      principalBlocked = resolved.blocked;
    }

    const kind = def?.kind ?? "read";
    const allowPhone = this.allowPhoneForRole(role);
    const argsRedacted = redactToJson(call.arguments, { allowPhone });

    // Helper to finalize + persist a terminal result.
    const finalize = async (params: {
      executionStatus: ExecutionStatus;
      deliveryStatus: DeliveryStatus;
      result?: unknown;
      error?: ToolError;
      idempotencyKey?: string | null;
      idempotencyKeySource?: "agent" | "derived" | null;
      links?: AgentToolResult["links"];
    }): Promise<AgentToolResult> => {
      const completedAt = new Date(this.now());
      const durationMs = completedAt.getTime() - startedAt.getTime();
      // Redact ONCE: the same redacted value is both persisted and returned to
      // the agent/UI. Never return the raw result across the gateway boundary.
      const redactedResult = params.result === undefined ? undefined : redact(params.result, { allowPhone });
      const resultRedacted = redactToJson(params.result, { allowPhone });
      const errShape = params.error?.toShape();
      const errorDetailRedacted = errShape?.detail !== undefined
        ? redactToJson(errShape.detail, { allowPhone })
        : null;

      const toolCallRecordId = await this.evidence.writeToolCall({
        agentName,
        toolName: call.name,
        kind,
        threadId: ctx.threadId,
        threadType: ctx.threadType,
        principalId,
        role,
        executionStatus: params.executionStatus,
        deliveryStatus: params.deliveryStatus,
        idempotencyKey: params.idempotencyKey ?? null,
        idempotencyKeySource: params.idempotencyKeySource ?? null,
        argsRedacted,
        resultRedacted,
        errorCode: errShape?.code ?? null,
        errorMessage: errShape?.message ?? null,
        evidence: errorDetailRedacted ? JSON.stringify({ errorDetail: JSON.parse(errorDetailRedacted) }) : null,
        outboundRecordId: params.links?.outboundRecordId ?? null,
        zaloActionRecordId: params.links?.zaloActionRecordId ?? null,
        agentTaskId: params.links?.agentTaskId ?? null,
        scheduleId: params.links?.scheduleId ?? null,
        relatedMessageId: ctx.relatedMessageId ?? params.links?.relatedMessageId ?? null,
        durationMs,
        startedAt,
        completedAt,
      });

      return {
        toolName: call.name,
        kind,
        executionStatus: params.executionStatus,
        deliveryStatus: params.deliveryStatus,
        result: redactedResult,
        error: errShape,
        toolCallRecordId,
        idempotencyKey: params.idempotencyKey ?? undefined,
        idempotencyKeySource: params.idempotencyKeySource ?? undefined,
        links: params.links,
        durationMs,
      };
    };

    // 2. ── Unknown tool → unavailable ───────────────────────────────
    if (!def) {
      return finalize({
        executionStatus: "unavailable",
        deliveryStatus: "not_applicable",
        error: toolErrors.unavailable(`Tool "${call.name}" is not available`),
      });
    }

    // 3. ── Blocked principal → blocked ──────────────────────────────
    if (principalBlocked) {
      return finalize({
        executionStatus: "blocked",
        deliveryStatus: "not_applicable",
        error: toolErrors.blocked("Principal is blocked"),
      });
    }

    // 4. ── Permission (min role) ────────────────────────────────────
    const perm = checkToolPermission(role, def);
    if (!perm.allowed) {
      return finalize({
        executionStatus: "blocked",
        deliveryStatus: "not_applicable",
        error: toolErrors.blocked(
          `Permission denied for "${call.name}" (role=${role}, required=${perm.requiredRole})`,
        ),
      });
    }

    // 5. ── Generic dataScope gate (tool re-checks at query level) ───
    const scope = checkDataScope(role, def.dataScope);
    if (!scope.allowed) {
      return finalize({
        executionStatus: "blocked",
        deliveryStatus: "not_applicable",
        error: toolErrors.blocked(
          `Data scope denied for "${call.name}" (scope=${def.dataScope}, role=${role})`,
        ),
      });
    }

    // 6. ── Validate args (invalid → blocked, NO execution) ──────────
    let args: unknown;
    try {
      args = validateArgs(def.argsSchema as any, call.arguments ?? {});
    } catch (err) {
      const te = err instanceof ToolError ? err : toolErrors.invalidArgs("Invalid arguments");
      return finalize({
        executionStatus: executionStatusForError(te.code),
        deliveryStatus: "not_applicable",
        error: te,
      });
    }

    // 7. ── Idempotency (write/outbound only) ────────────────────────
    let idempotencyKey: string | null = null;
    let idempotencyKeySource: "agent" | "derived" | null = null;
    if (kind === "write" || kind === "outbound") {
      const derived = this.deriveIdempotencyKey(call.name, ctx, principalId, argsRedacted);
      if (call.idempotencyKey && call.idempotencyKey.trim()) {
        // Namespace the agent key with the scope hash — never trust raw.
        idempotencyKey = `${this.scopeHash(call.name, ctx, principalId)}:${call.idempotencyKey.trim()}`;
        idempotencyKeySource = "agent";
      } else {
        idempotencyKey = derived;
        idempotencyKeySource = "derived";
      }

      const prior = await this.evidence.findByIdempotencyKey(idempotencyKey);
      if (prior) {
        let priorResult: unknown = undefined;
        if (prior.resultRedacted) {
          try {
            priorResult = JSON.parse(prior.resultRedacted);
          } catch {
            priorResult = undefined;
          }
        }
        // Replay → success/skipped, NO second execution.
        return finalize({
          executionStatus: "success",
          deliveryStatus: "skipped",
          result: priorResult,
          idempotencyKey,
          idempotencyKeySource,
          links: { relatedMessageId: ctx.relatedMessageId },
        });
      }
    }

    // 8. ── dryRun / live decision (write/outbound) ──────────────────
    let dryRun = false;
    let liveAllowed = false;
    if (kind === "write" || kind === "outbound") {
      dryRun = await this.getDryRun();
      if (dryRun) {
        liveAllowed = await this.getLiveAllowed(ctx.threadId);
        if (liveAllowed) dryRun = false;
      }
    }

    // 9. ── Execute under per-tool timeout ───────────────────────────
    const timeoutMs = def.timeoutMs ?? this.opts.defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    try {
      const exec = await this.runWithTimeout(
        Promise.resolve(def.execute({ args: args as any, ctx, dryRun, liveAllowed, role, principalId })),
        timeoutMs,
        call.name,
      );

      // Validate result (malformed → provider_error).
      const validated = validateResult(def.resultSchema as any, exec.result ?? null);

      // Determine deliveryStatus.
      let deliveryStatus: DeliveryStatus = "not_applicable";
      if (kind === "write" || kind === "outbound") {
        // Not dryRun ⇒ a real send occurred (global live or live-test override) ⇒ live_sent.
        deliveryStatus = exec.deliveryStatus ?? (dryRun ? "dry_run" : "live_sent");
      }

      return finalize({
        executionStatus: "success",
        deliveryStatus,
        result: validated,
        idempotencyKey,
        idempotencyKeySource,
        links: exec.links,
      });
    } catch (err) {
      const te = err instanceof ToolError ? err : toolErrors.providerError((err as Error)?.message ?? "tool error");
      let deliveryStatus: DeliveryStatus = "not_applicable";
      if (kind === "write" || kind === "outbound") {
        deliveryStatus = dryRun ? "dry_run" : "not_applicable";
      }
      return finalize({
        executionStatus: executionStatusForError(te.code),
        deliveryStatus,
        error: te,
        idempotencyKey,
        idempotencyKeySource,
      });
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private allowPhoneForRole(role: ToolRole): boolean {
    if (this.opts.allowPhoneForRole) return this.opts.allowPhoneForRole(role);
    return roleLevel(role) >= roleLevel("admin");
  }

  private scopeHash(toolName: string, ctx: ToolContext, principalId: string | null): string {
    return createHash("sha256")
      .update(`${toolName}|${ctx.threadId}|${principalId ?? ""}`)
      .digest("hex")
      .slice(0, 16);
  }

  private deriveIdempotencyKey(
    toolName: string,
    ctx: ToolContext,
    principalId: string | null,
    argsRedacted: string | null,
  ): string {
    return createHash("sha256")
      .update(
        [
          toolName,
          ctx.threadId,
          principalId ?? "",
          argsRedacted ?? "",
          ctx.relatedMessageId ?? "",
        ].join("|"),
      )
      .digest("hex");
  }

  private async runWithTimeout<T>(p: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(toolErrors.timeout(`Tool "${toolName}" timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async getDryRun(): Promise<boolean> {
    if (this.opts.getDryRun) return this.opts.getDryRun();
    const { getCurrentEffectiveDryRun } = await import("../runtime-config.service.js");
    return getCurrentEffectiveDryRun();
  }

  private async getLiveAllowed(threadId: string): Promise<boolean> {
    if (this.opts.getLiveAllowed) return this.opts.getLiveAllowed(threadId);
    try {
      const { shouldSendLiveForThread } = await import("../live-test.service.js");
      const res = await shouldSendLiveForThread(threadId);
      return !!res.live;
    } catch {
      return false;
    }
  }

  private async resolveRole(senderId: string | null | undefined, threadId: string): Promise<ResolvedRole> {
    if (this.opts.resolveRole) return this.opts.resolveRole(senderId, threadId);
    try {
      const { resolvePrincipal, isBlocked } = await import("../principal.service.js");
      const ctx = await resolvePrincipal(senderId ?? null, threadId);
      return { role: ctx.role as ToolRole, principalId: ctx.principal?.principalId ?? null, blocked: isBlocked(ctx.status) };
    } catch {
      return { role: DEFAULT_ROLE, principalId: null, blocked: false };
    }
  }
}

// Default shared gateway (runtime). Tests construct their own with injected deps.
let defaultGateway: ToolGateway | null = null;

export function getToolGateway(): ToolGateway {
  if (!defaultGateway) defaultGateway = new ToolGateway();
  return defaultGateway;
}

export function setToolGatewayForTest(gw: ToolGateway | null): void {
  defaultGateway = gw;
}
