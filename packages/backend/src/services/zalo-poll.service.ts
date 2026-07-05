// =============================================================================
// Zalo Poll Service (Phase 2) — governed via ZaloProvider + ZaloActionRecord
// =============================================================================
// No direct getApi()/api.createPoll here. Goes through the governed action path:
// dryRun/live enforced centrally, ZaloActionRecord evidence always written.
// Return shape preserved for routes/zalo.ts (incl. DRY_RUN_ACTIVE on dryRun).
// =============================================================================

import { performGovernedZaloAction } from "./zalo-provider/governed-action.js";
import type { GovernedActionDeps } from "./zalo-provider/governed-action.js";
import type { PollProviderResult } from "./zalo-provider/types.js";

interface PollOptions {
  question: string;
  options: string[];
  expiredTime?: number;
  allowMultiChoices?: boolean;
  allowAddNewOption?: boolean;
  hideVotePreview?: boolean;
  isAnonymous?: boolean;
  groupId: string;
  /** Optional actor id for evidence. */
  createdBy?: string;
}

export interface CreatePollResult {
  success: boolean;
  pollId?: string;
  question?: string;
  optionsCount?: number;
  creator?: string;
  created?: string;
  error?: string;
  errorCode?: string;
  dryRun?: boolean;
}

/**
 * Create a poll in a group. Deps are injectable for tests (provider/evidence/
 * dryRun/live); production uses the real ZaloProvider + evidence sink.
 */
export async function createPollInGroup(
  opts: PollOptions,
  deps: GovernedActionDeps = {},
): Promise<CreatePollResult> {
  // Capture the full provider result (for the preserved return shape) while the
  // governed path handles dryRun/live + evidence.
  let pollRes: PollProviderResult | undefined;

  const result = await performGovernedZaloAction(
    {
      actionType: "poll",
      threadId: opts.groupId,
      threadType: "group",
      targetMsgId: null,
      payload: {
        question: opts.question,
        options: opts.options,
        expiredTime: opts.expiredTime ?? 0,
        allowMultiChoices: opts.allowMultiChoices ?? false,
        allowAddNewOption: opts.allowAddNewOption ?? false,
        hideVotePreview: opts.hideVotePreview ?? false,
        isAnonymous: opts.isAnonymous ?? false,
      },
      trigger: "manual",
      createdBy: opts.createdBy ?? null,
      perform: async (provider) => {
        pollRes = await provider.createPoll({
          groupId: opts.groupId,
          question: opts.question,
          options: opts.options,
          expiredTime: opts.expiredTime,
          allowMultiChoices: opts.allowMultiChoices,
          allowAddNewOption: opts.allowAddNewOption,
          hideVotePreview: opts.hideVotePreview,
          isAnonymous: opts.isAnonymous,
        });
        return {
          ok: pollRes.ok,
          providerResultId: pollRes.providerResultId,
          error: pollRes.error,
          errorCode: pollRes.errorCode,
        };
      },
    },
    deps,
  );

  // DryRun (and not live-test authorized) → preserve legacy DRY_RUN_ACTIVE contract.
  if (result.dryRun) {
    return { success: false, error: "DRY_RUN_ACTIVE", errorCode: "DRY_RUN_ACTIVE", dryRun: true };
  }

  if (result.executionStatus === "blocked") {
    return { success: false, error: result.error ?? "ZALO_NOT_CONNECTED", errorCode: result.errorCode ?? "ZALO_NOT_CONNECTED" };
  }

  if (result.executionStatus === "failed" || !result.sent) {
    return { success: false, error: result.error ?? "CREATE_POLL_FAILED", errorCode: result.errorCode ?? "CREATE_POLL_FAILED" };
  }

  return {
    success: true,
    pollId: pollRes?.providerResultId ?? result.providerResultId ?? "unknown",
    question: pollRes?.question ?? opts.question,
    optionsCount: pollRes?.optionsCount ?? opts.options.length,
    creator: pollRes?.creator,
    created: pollRes?.created,
  };
}
