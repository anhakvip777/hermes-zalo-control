import { getZaloGateway } from "../services/zalo-gateway.service.js";
import { getCurrentEffectiveDryRun } from "../services/runtime-config.service.js";

interface PollOptions {
  question: string;
  options: string[];
  expiredTime?: number;
  allowMultiChoices?: boolean;
  allowAddNewOption?: boolean;
  hideVotePreview?: boolean;
  isAnonymous?: boolean;
  groupId: string;
}

export async function createPollInGroup(opts: PollOptions) {
  const gw = getZaloGateway();
  if (!gw.isConnected()) {
    return { success: false, error: "ZALO_NOT_CONNECTED", errorCode: "ZALO_NOT_CONNECTED" };
  }

  // DryRun guard — block poll creation when dryRun is active
  if (getCurrentEffectiveDryRun()) {
    return { success: false, error: "DRY_RUN_ACTIVE", errorCode: "DRY_RUN_ACTIVE" };
  }

  const api = gw.getApi();
  if (!api) {
    return { success: false, error: "ZALO_API_UNAVAILABLE", errorCode: "ZALO_API_UNAVAILABLE" };
  }

  try {
    const result = await api.createPoll(
      {
        question: opts.question,
        options: opts.options,
        expiredTime: opts.expiredTime ?? 0,
        allowMultiChoices: opts.allowMultiChoices ?? false,
        allowAddNewOption: opts.allowAddNewOption ?? false,
        hideVotePreview: opts.hideVotePreview ?? false,
        isAnonymous: opts.isAnonymous ?? false,
      },
      opts.groupId,
    );

    return {
      success: true,
      pollId: (result as any)?.poll_id ?? (result as any)?.pollId ?? "unknown",
      question: (result as any)?.question,
      optionsCount: (result as any)?.options?.length ?? opts.options.length,
      creator: (result as any)?.creator,
      created: (result as any)?.created_time,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message ?? String(err),
      errorCode: "CREATE_POLL_FAILED",
    };
  }
}
