// =============================================================================
// Tool Gateway — core types (Phase 1)
// =============================================================================
// Agent-agnostic core. Neutral names (Agent*), NOT Hermes-specific. Adapters map
// their own shapes to/from these. See PLAN.md Phase 1 / Phase 5.
// =============================================================================

import type { z } from "zod";

// ── Roles (mirror principal.service.ts PrincipalRole) ────────────────
export type ToolRole = "form_only" | "basic_chat" | "advanced" | "admin";

// ── Tool kind + status model (two fields, per approved decisions) ────
export type ToolKind = "read" | "write" | "outbound";

/** Whether the tool ran / was permitted. */
export type ExecutionStatus =
  | "requested"
  | "success"
  | "failed"
  | "unavailable"
  | "blocked";

/** The send/live outcome (write/outbound only; read → not_applicable). */
export type DeliveryStatus =
  | "not_applicable"
  | "dry_run"
  | "live_sent"
  | "skipped"
  | "cooldown_blocked";

/** Data scope a tool operates over — enforced generically at the gateway. */
export type DataScope = "own_thread" | "cross_thread" | "global" | "none";

/** Tool sensitivity — used for admin/approval gating (Phase 2+ can extend). */
export type ToolSensitivity = "normal" | "admin" | "approval_required";

// ── Error shape ──────────────────────────────────────────────────────
export type ToolErrorCode =
  | "blocked"
  | "unavailable"
  | "invalid_args"
  | "provider_error"
  | "timeout"
  | "dry_run";

export interface ToolErrorShape {
  code: ToolErrorCode;
  message: string;
  detail?: unknown; // redacted before persistence/return
  retryable?: boolean;
}

// ── Evidence link pointers (string-id links; no FK) ──────────────────
export interface ToolEvidenceLinks {
  outboundRecordId?: string;
  zaloActionRecordId?: string;
  agentTaskId?: string;
  scheduleId?: string;
  relatedMessageId?: string;
}

// ── Call + context + result ──────────────────────────────────────────
export interface AgentToolCall {
  /** Tool name, e.g. "zalo.listGroups", "memory.searchMessages". */
  name: string;
  /** Raw arguments as supplied by the agent (validated + redacted by gateway). */
  arguments?: Record<string, unknown>;
  /** Optional agent-supplied idempotency key (namespaced by gateway; never trusted raw). */
  idempotencyKey?: string;
}

export interface ToolContext {
  /** Adapter id. Gateway falls back to "hermes" when omitted. */
  agentName?: string;
  /** Exact caller-owned grant. The gateway independently enforces membership. */
  readonly allowedTools: readonly string[];
  threadId: string;
  threadType: "user" | "group";
  /** Canonical sender id (for principal resolution / evidence). */
  senderId?: string | null;
  /** Caller-resolved role — preferred over a gateway lookup. */
  role?: ToolRole;
  /** Caller-resolved principal id — preferred over a gateway lookup. */
  principalId?: string | null;
  /** Trusted caller assertion; absent means the gateway resolves blocked status. */
  readonly principalBlocked?: boolean;
  /** Exact AgentTask.id owned by the dispatcher (for evidence linking). */
  agentTaskId?: string;
  /** The inbound message id this tool call relates to (for evidence linking). */
  relatedMessageId?: string;
  /** Free-form metadata carried into evidence. */
  metadata?: Record<string, unknown>;
}

export interface AgentToolResult {
  toolName: string;
  kind: ToolKind;
  executionStatus: ExecutionStatus;
  deliveryStatus: DeliveryStatus;
  /** Redacted result payload (safe to return to the agent + UI). */
  result?: unknown;
  error?: ToolErrorShape;
  /** Evidence row id written by the gateway (ToolCallRecord.id). */
  toolCallRecordId?: string;
  idempotencyKey?: string;
  idempotencyKeySource?: "agent" | "derived";
  links?: ToolEvidenceLinks;
  durationMs?: number;
}

// ── Tool definition (registry entry) ─────────────────────────────────
export interface ToolExecuteResult {
  /** Redacted-or-raw result; gateway redacts before persist/return. */
  result?: unknown;
  /** For write/outbound tools: delivery outcome the tool actually achieved. */
  deliveryStatus?: DeliveryStatus;
  /** Optional evidence links produced by the tool (e.g. outboundRecordId). */
  links?: ToolEvidenceLinks;
}

export interface ToolExecuteInput {
  args: unknown; // already schema-validated
  ctx: ToolContext;
  /** Effective dryRun decision computed by the gateway for write/outbound tools. */
  dryRun: boolean;
  /** True when a live-test session authorizes a live send for this thread. */
  liveAllowed: boolean;
  /** Gateway-resolved role (caller-passed or resolved via principal service). */
  role: ToolRole;
  /** Gateway-resolved principal id (may be null). */
  principalId: string | null;
}

export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  name: string;
  kind: ToolKind;
  /** Minimum role required to invoke. */
  minRole: ToolRole;
  sensitivity?: ToolSensitivity;
  dataScope?: DataScope;
  /** Whether write/outbound tools require an idempotency key (gateway derives if missing). */
  requiresIdempotencyKey?: boolean;
  /** Per-tool timeout override (ms). Gateway applies a default otherwise. */
  timeoutMs?: number;
  argsSchema: z.ZodType<TArgs>;
  resultSchema: z.ZodType<TResult>;
  /** The tool body. MUST NOT throw for expected errors — throw only for bugs. */
  execute(input: ToolExecuteInput & { args: TArgs }): Promise<ToolExecuteResult> | ToolExecuteResult;
}

// ── Evidence sink (injectable — Prisma impl or in-memory for tests) ──
export interface ToolCallEvidence {
  agentName: string;
  toolName: string;
  kind: ToolKind;
  threadId: string;
  threadType: "user" | "group";
  principalId?: string | null;
  role: ToolRole;
  executionStatus: ExecutionStatus;
  deliveryStatus: DeliveryStatus;
  idempotencyKey?: string | null;
  idempotencyKeySource?: "agent" | "derived" | null;
  argsRedacted?: string | null;
  resultRedacted?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  evidence?: string | null;
  outboundRecordId?: string | null;
  zaloActionRecordId?: string | null;
  agentTaskId?: string | null;
  scheduleId?: string | null;
  relatedMessageId?: string | null;
  durationMs?: number | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export interface ZaloActionEvidence {
  actionType: string; // reaction | poll | ...
  threadId: string;
  threadType: "user" | "group";
  principalId?: string | null;
  trigger?: "agent_tool" | "listener" | "manual" | "system";
  targetMsgId?: string | null;
  payloadRedacted?: string | null;
  dryRun?: boolean;
  decision?: "allow" | "skip" | "block";
  reason: string;
  executionStatus: ExecutionStatus;
  deliveryStatus: DeliveryStatus;
  providerResultId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  idempotencyKey?: string | null;
  toolCallRecordId?: string | null;
  createdBy?: string | null;
}

export interface ToolEvidenceSink {
  /** Persist a tool-call trace. Returns the record id. */
  writeToolCall(record: ToolCallEvidence): Promise<string>;
  /** Persist a non-message Zalo write-action trace. Returns the record id. */
  writeZaloAction(record: ZaloActionEvidence): Promise<string>;
  /**
   * Idempotency lookup for write/outbound tools. Returns the prior result payload
   * (redacted JSON string) if this key already executed, else null.
   */
  findByIdempotencyKey(key: string): Promise<{ id: string; resultRedacted: string | null } | null>;
}

export const DEFAULT_AGENT_NAME = "hermes";
export const DEFAULT_TOOL_TIMEOUT_MS = 15_000;
