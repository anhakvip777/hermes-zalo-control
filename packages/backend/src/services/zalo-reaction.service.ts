// =============================================================================
// Zalo Reaction Service — inbound reaction handling + auto-react
// =============================================================================

import type { NormalizedReaction } from "./zalo-reaction-utils.js";
import { config } from "../config.js";
import { getCurrentEffectiveDryRun } from "../services/runtime-config.service.js";

// ═══════════════════════════════════════════════════════════════════
// Reaction audit
// ═══════════════════════════════════════════════════════════════════

export interface ReactionAudit {
  decision: "allow" | "skip" | "block" | "auto_react";
  reason: string;
  threadId: string;
  threadType: "user" | "group";
  uidFrom: string;
  msgId: string;
  reactionType: string;
  dryRun: boolean;
  errorCode?: string;
}

function logReactionAudit(audit: ReactionAudit): void {
  console.log(`[reaction] ${JSON.stringify({ ...audit, ts: new Date().toISOString() })}`);
}

// ═══════════════════════════════════════════════════════════════════
// Cooldown for auto-react (separate from text reply cooldown)
// ═══════════════════════════════════════════════════════════════════

const reactionCooldowns = new Map<string, number>();

function isReactionCooldown(threadId: string): boolean {
  const last = reactionCooldowns.get(threadId);
  if (!last) return false;
  const cooldownMs = (config.autoReply.cooldownSeconds || 10) * 1000;
  if (Date.now() - last < cooldownMs) return true;
  reactionCooldowns.delete(threadId);
  return false;
}

function touchReactionCooldown(threadId: string): void {
  reactionCooldowns.set(threadId, Date.now());
  // Prune old entries
  for (const [k, v] of reactionCooldowns) {
    if (Date.now() - v > 3600_000) reactionCooldowns.delete(k);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Safety gates for auto-react
// ═══════════════════════════════════════════════════════════════════

interface ReactionGateResult {
  allowed: boolean;
  reason: string;
  errorCode?: string;
}

async function checkReactionGates(
  reaction: NormalizedReaction,
  selfUserId: string | null,
): Promise<ReactionGateResult> {
  const threadType: "user" | "group" = reaction.isGroup ? "group" : "user";

  // 1. Self-message guard
  if (reaction.isSelf) {
    return { allowed: false, reason: "self_reaction" };
  }

  // 2. Auto-reply must be enabled
  if (!config.autoReply.enabled) {
    return { allowed: false, reason: "auto_reply_disabled" };
  }

  // 3. Thread allowlist
  if (
    config.autoReply.allowedThreads.length > 0 &&
    !config.autoReply.allowedThreads.includes(reaction.threadId)
  ) {
    return { allowed: false, reason: "thread_not_allowed" };
  }

  // 4. Group mention gate
  if (reaction.isGroup) {
    const { getThreadSettings } = await import("./thread-settings.service.js");
    const settings = await getThreadSettings(reaction.threadId, "group");
    if (!settings.autoReplyEnabled) {
      return { allowed: false, reason: "group_disabled" };
    }
    if (settings.groupMentionRequired) {
      const { getGroupReplyWindow } = await import("./group-safety.service.js");
      const window = getGroupReplyWindow(reaction.threadId);
      if (window === 0) {
        return { allowed: false, reason: "group_reply_window_closed" };
      }
    }
  }

  // 5. Reaction cooldown
  if (isReactionCooldown(reaction.threadId)) {
    return { allowed: false, reason: "cooldown", errorCode: "RATE_LIMITED" };
  }

  // 6. Check thread settings for auto-react eligibility
  try {
    const { getThreadSettings } = await import("./thread-settings.service.js");
    const settings = await getThreadSettings(reaction.threadId, threadType);
    if (!settings.autoReplyEnabled) {
      return { allowed: false, reason: "auto_reply_disabled_thread" };
    }
  } catch {
    // Non-fatal — settings may not exist yet
  }

  return { allowed: true, reason: "ok" };
}

// ═══════════════════════════════════════════════════════════════════
// Main handler — called from the listener
// ═══════════════════════════════════════════════════════════════════

export async function handleIncomingReaction(
  reaction: NormalizedReaction,
  selfUserId: string | null,
): Promise<void> {
  const threadType: "user" | "group" = reaction.isGroup ? "group" : "user";
  const dryRun = getCurrentEffectiveDryRun();

  // Check gates
  const gate = await checkReactionGates(reaction, selfUserId);

  if (!gate.allowed) {
    logReactionAudit({
      decision: "skip",
      reason: gate.reason,
      threadId: reaction.threadId,
      threadType,
      uidFrom: reaction.uidFrom,
      msgId: reaction.msgId,
      reactionType: reaction.rIcon,
      dryRun,
      errorCode: gate.errorCode,
    });
    return;
  }

  // Auto-react with ❤️
  const REACTION_ICON = "/-heart"; // Reactions.HEART from zca-js

  // Phase 2: route through the governed action path (ZaloProvider + evidence).
  // NO direct getApi()/api.addReaction here — the provider is the sole zca-js caller,
  // dryRun/live is enforced centrally, and a ZaloActionRecord is always written.
  try {
    const { performGovernedZaloAction } = await import("./zalo-provider/governed-action.js");
    const result = await performGovernedZaloAction({
      actionType: "reaction",
      threadId: reaction.threadId,
      threadType,
      targetMsgId: reaction.msgId,
      payload: { icon: REACTION_ICON },
      trigger: "listener",
      principalId: reaction.uidFrom || null,
      perform: (provider) =>
        provider.addReaction({
          threadId: reaction.threadId,
          threadType,
          msgId: reaction.msgId,
          cliMsgId: reaction.cliMsgId,
          icon: "heart",
        }),
    });

    if (result.sent) {
      touchReactionCooldown(reaction.threadId);
    }

    logReactionAudit({
      decision: result.executionStatus === "success" ? "auto_react" : "block",
      reason: result.dryRun ? "dry_run" : result.sent ? "success" : result.error ?? result.errorCode ?? "send_failed",
      threadId: reaction.threadId,
      threadType,
      uidFrom: reaction.uidFrom,
      msgId: reaction.msgId,
      reactionType: REACTION_ICON,
      dryRun: result.dryRun,
      errorCode: result.errorCode,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logReactionAudit({
      decision: "block",
      reason: "send_failed",
      threadId: reaction.threadId,
      threadType,
      uidFrom: reaction.uidFrom,
      msgId: reaction.msgId,
      reactionType: REACTION_ICON,
      dryRun,
      errorCode: "SEND_FAILED",
    });
    console.error("[reaction] governed action error: " + msg);
  }
}

/** Reset cooldowns (for tests). */
export function resetReactionCooldowns(): void {
  reactionCooldowns.clear();
}
