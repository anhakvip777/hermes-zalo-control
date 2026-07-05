// =============================================================================
// ZcaJsProvider — the ONLY place that calls zca-js write APIs (Phase 2)
// =============================================================================
// Wraps getZaloGateway().getApi(). Closes the reaction/poll direct-getApi bypass:
// after Phase 2, zalo-reaction.service / zalo-poll.service must go through this
// provider, never call api.addReaction / api.createPoll themselves.
//
// Returns structured results only — never raw session/token/cookie.
// The Bridge retains sole ownership of the zca-js session.
// =============================================================================

import { getZaloGateway } from "../zalo-gateway.service.js";
import type {
  GroupInfoResult,
  ListFriendsResult,
  ListGroupsResult,
  PollActionInput,
  PollProviderResult,
  ProviderActionResult,
  ProviderGroupSummary,
  ProviderRuntimeStatus,
  ProviderUserSummary,
  ReactionActionInput,
  UserInfoResult,
  ZaloProvider,
} from "./types.js";

export class ZcaJsProvider implements ZaloProvider {
  isConnected(): boolean {
    try {
      return getZaloGateway().isConnected();
    } catch {
      return false;
    }
  }

  async addReaction(input: ReactionActionInput): Promise<ProviderActionResult> {
    const api = getZaloGateway().getApi();
    if (!api) {
      return { ok: false, error: "Zalo API not available", errorCode: "ZALO_API_UNAVAILABLE" };
    }
    try {
      const { ThreadType, Reactions } = (await import("zca-js")) as any;
      await api.addReaction(Reactions.HEART, {
        data: { msgId: input.msgId, cliMsgId: input.cliMsgId },
        threadId: input.threadId,
        type: input.threadType === "group" ? ThreadType.Group : ThreadType.User,
      });
      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg, errorCode: "SEND_FAILED" };
    }
  }

  async createPoll(input: PollActionInput): Promise<PollProviderResult> {
    const api = getZaloGateway().getApi();
    if (!api) {
      return { ok: false, error: "Zalo API not available", errorCode: "ZALO_API_UNAVAILABLE" };
    }
    try {
      const result = await api.createPoll(
        {
          question: input.question,
          options: input.options,
          expiredTime: input.expiredTime ?? 0,
          allowMultiChoices: input.allowMultiChoices ?? false,
          allowAddNewOption: input.allowAddNewOption ?? false,
          hideVotePreview: input.hideVotePreview ?? false,
          isAnonymous: input.isAnonymous ?? false,
        },
        input.groupId,
      );
      const r = result as any;
      return {
        ok: true,
        providerResultId: r?.poll_id ?? r?.pollId ?? "unknown",
        question: r?.question,
        optionsCount: r?.options?.length ?? input.options.length,
        creator: r?.creator,
        created: r?.created_time,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg, errorCode: "CREATE_POLL_FAILED" };
    }
  }

  // ── Read actions (Phase 3) — whitelisted fields only, no secrets ──

  getRuntimeStatus(): ProviderRuntimeStatus {
    const gw = getZaloGateway();
    let status: any = {};
    try {
      status = gw.getStatus();
    } catch {
      /* fall through to safe defaults */
    }
    return {
      connected: !!status.connected,
      connectionStatus: String(status.connectionStatus ?? "disconnected"),
      listenerActive: typeof (gw as any).listenerActive === "boolean" ? (gw as any).listenerActive : undefined,
      selfUserId: status.selfUserId ?? null,
      selfDisplayName: status.selfDisplayName ?? null,
      dryRun: !!status.dryRun,
    };
  }

  async listGroups(): Promise<ListGroupsResult> {
    const api = getZaloGateway().getApi();
    if (!api) return { ok: false, error: "Zalo API not available", errorCode: "ZALO_API_UNAVAILABLE" };
    try {
      const all = await api.getAllGroups();
      const groupIds = Object.keys(all?.gridVerMap ?? {});
      if (groupIds.length === 0) return { ok: true, groups: [] };
      const info = await api.getGroupInfo(groupIds);
      const map = info?.gridInfoMap ?? {};
      const groups: ProviderGroupSummary[] = groupIds.map((gid) => {
        const gi = map[gid] ?? {};
        return {
          groupId: gid,
          name: gi.name ?? "Unknown",
          memberCount: gi.totalMember ?? gi.memberCount ?? 0,
          avatar: gi.avatar ?? null,
        };
      });
      return { ok: true, groups };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), errorCode: "LIST_GROUPS_FAILED" };
    }
  }

  async getGroupInfo(groupId: string): Promise<GroupInfoResult> {
    const api = getZaloGateway().getApi();
    if (!api) return { ok: false, error: "Zalo API not available", errorCode: "ZALO_API_UNAVAILABLE" };
    try {
      const info = await api.getGroupInfo([groupId]);
      const gi = info?.gridInfoMap?.[groupId];
      if (!gi) return { ok: false, error: "group not found", errorCode: "GROUP_NOT_FOUND" };
      return {
        ok: true,
        group: {
          groupId,
          name: gi.name ?? "Unknown",
          memberCount: gi.totalMember ?? gi.memberCount ?? 0,
          avatar: gi.avatar ?? null,
        },
      };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), errorCode: "GROUP_INFO_FAILED" };
    }
  }

  async getUserInfo(userId: string): Promise<UserInfoResult> {
    const api = getZaloGateway().getApi();
    if (!api) return { ok: false, error: "Zalo API not available", errorCode: "ZALO_API_UNAVAILABLE" };
    try {
      const res = await api.getUserInfo(userId);
      const profile = res?.changed_profiles?.[userId] ?? res?.unchanged_profiles?.[userId];
      if (!profile) return { ok: false, error: "user not found", errorCode: "USER_NOT_FOUND" };
      return {
        ok: true,
        user: {
          userId,
          // Whitelist only — NEVER include phoneNumber or other PII fields.
          displayName: profile.displayName ?? profile.zaloName ?? "Unknown",
          avatar: profile.avatar ?? null,
        },
      };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), errorCode: "USER_INFO_FAILED" };
    }
  }

  async listFriends(): Promise<ListFriendsResult> {
    const api = getZaloGateway().getApi();
    if (!api) return { ok: false, error: "Zalo API not available", errorCode: "ZALO_API_UNAVAILABLE" };
    if (typeof api.getAllFriends !== "function") {
      return { ok: false, error: "getAllFriends not supported", errorCode: "UNSUPPORTED" };
    }
    try {
      const friends = await api.getAllFriends();
      const list: ProviderUserSummary[] = (Array.isArray(friends) ? friends : []).map((u: any) => ({
        userId: u.userId,
        // Whitelist only — NEVER include phoneNumber.
        displayName: u.displayName ?? u.zaloName ?? "Unknown",
        avatar: u.avatar ?? null,
      }));
      return { ok: true, friends: list };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), errorCode: "LIST_FRIENDS_FAILED" };
    }
  }
}

// Default shared provider (runtime). Tests inject a stub.
let defaultProvider: ZaloProvider | null = null;

export function getZaloProvider(): ZaloProvider {
  if (!defaultProvider) defaultProvider = new ZcaJsProvider();
  return defaultProvider;
}

export function setZaloProviderForTest(provider: ZaloProvider | null): void {
  defaultProvider = provider;
}
