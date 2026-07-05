// =============================================================================
// Governed Zalo write-action executor (Phase 2)
// =============================================================================
// Single governance path for non-message Zalo write actions (reaction, poll):
//   redact payload → derive idempotency key → dryRun/live decision →
//   (dryRun) NO provider call + ZaloActionRecord(dry_run)
//   (live)   provider call + ZaloActionRecord(live_sent | failed | blocked)
//
// Mirrors sendOutbound's dryRun/live semantics. The provider is the ONLY thing
// that touches zca-js. Evidence is always written (ZaloActionRecord).
// =============================================================================

import { getToolEvidenceSink } from "../tool-gateway/evidence.js";
import { deriveZaloActionIdempotencyKey } from "../tool-gateway/keys.js";
import { redactToJson } from "../tool-gateway/redaction.js";
import type { DeliveryStatus, ExecutionStatus, ToolEvidenceSink } from "../tool-gateway/types.js";
import { getZaloProvider } from "./zca-js-provider.js";
import type { ProviderActionResult, ZaloProvider } from "./types.js";

export interface GovernedActionDeps {
  provider?: ZaloProvider;
  evidence?: ToolEvidenceSink;
  getDryRun?: () => boolean | Promise<boolean>;
  getLiveAllowed?: (threadId: string) => boolean | Promise<boolean>;
}

export interface GovernedActionInput {
  actionType: "reaction" | "poll";
  threadId: string;
  threadType: "user" | "group";
  targetMsgId?: string | null;
  /** Raw payload — redacted before persistence. */
  payload: Record<string, unknown>;
  trigger?: "agent_tool" | "listener" | "manual" | "system";
  principalId?: string | null;
  createdBy?: string | null;
  /** Performs the actual provider call. Only invoked on the live path. */
  perform: (provider: ZaloProvider) => Promise<ProviderActionResult>;
}

export interface GovernedActionResult {
  sent: boolean;
  dryRun: boolean;
  executionStatus: ExecutionStatus;
  deliveryStatus: DeliveryStatus;
  providerResultId?: string;
  errorCode?: string;
  error?: string;
  zaloActionRecordId: string;
  idempotencyKey: string;
}

async function defaultGetDryRun(): Promise<boolean> {
  const { getCurrentEffectiveDryRun } = await import("../runtime-config.service.js");
  return getCurrentEffectiveDryRun();
}

async function defaultGetLiveAllowed(threadId: string): Promise<boolean> {
  try {
    const { shouldSendLiveForThread } = await import("../live-test.service.js");
    const res = await shouldSendLiveForThread(threadId);
    return !!res.live;
  } catch {
    return false;
  }
}

export async function performGovernedZaloAction(
  input: GovernedActionInput,
  deps: GovernedActionDeps = {},
): Promise<GovernedActionResult> {
  const evidence = deps.evidence ?? getToolEvidenceSink();
  const trigger = input.trigger ?? "system";
  const payloadRedacted = redactToJson(input.payload);
  const idempotencyKey = deriveZaloActionIdempotencyKey({
    actionType: input.actionType,
    threadId: input.threadId,
    targetMsgId: input.targetMsgId ?? null,
    payloadRedacted,
  });

  const writeEv = (extra: {
    dryRun: boolean;
    decision: "allow" | "skip" | "block";
    reason: string;
    executionStatus: ExecutionStatus;
    deliveryStatus: DeliveryStatus;
    providerResultId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }) =>
    evidence.writeZaloAction({
      actionType: input.actionType,
      threadId: input.threadId,
      threadType: input.threadType,
      principalId: input.principalId ?? null,
      trigger,
      targetMsgId: input.targetMsgId ?? null,
      payloadRedacted,
      idempotencyKey,
      createdBy: input.createdBy ?? null,
      ...extra,
    });

  // ── dryRun / live decision (mirror sendOutbound) ─────────────────
  let dryRun = await (deps.getDryRun ?? defaultGetDryRun)();
  let liveAllowed = false;
  if (dryRun) {
    liveAllowed = await (deps.getLiveAllowed ?? defaultGetLiveAllowed)(input.threadId);
    if (liveAllowed) dryRun = false;
  }

  // ── DryRun path: NEVER call the provider ─────────────────────────
  if (dryRun) {
    const id = await writeEv({
      dryRun: true,
      decision: "allow",
      reason: "dry_run",
      executionStatus: "success",
      deliveryStatus: "dry_run",
    });
    return {
      sent: false,
      dryRun: true,
      executionStatus: "success",
      deliveryStatus: "dry_run",
      zaloActionRecordId: id,
      idempotencyKey,
    };
  }

  // ── Live path: provider must be connected ────────────────────────
  const provider = deps.provider ?? getZaloProvider();
  if (!provider.isConnected()) {
    const id = await writeEv({
      dryRun: false,
      decision: "block",
      reason: "ZALO_NOT_CONNECTED",
      executionStatus: "blocked",
      deliveryStatus: "not_applicable",
      errorCode: "ZALO_NOT_CONNECTED",
    });
    return {
      sent: false,
      dryRun: false,
      executionStatus: "blocked",
      deliveryStatus: "not_applicable",
      errorCode: "ZALO_NOT_CONNECTED",
      zaloActionRecordId: id,
      idempotencyKey,
    };
  }

  const res = await input.perform(provider);
  if (res.ok) {
    const id = await writeEv({
      dryRun: false,
      decision: "allow",
      reason: "live_sent",
      executionStatus: "success",
      deliveryStatus: "live_sent",
      providerResultId: res.providerResultId ?? null,
    });
    return {
      sent: true,
      dryRun: false,
      executionStatus: "success",
      deliveryStatus: "live_sent",
      providerResultId: res.providerResultId,
      zaloActionRecordId: id,
      idempotencyKey,
    };
  }

  const id = await writeEv({
    dryRun: false,
    decision: "block",
    reason: res.error ?? "send_failed",
    executionStatus: "failed",
    deliveryStatus: "not_applicable",
    errorCode: res.errorCode ?? "SEND_FAILED",
    errorMessage: res.error ?? null,
  });
  return {
    sent: false,
    dryRun: false,
    executionStatus: "failed",
    deliveryStatus: "not_applicable",
    errorCode: res.errorCode ?? "SEND_FAILED",
    error: res.error,
    zaloActionRecordId: id,
    idempotencyKey,
  };
}
