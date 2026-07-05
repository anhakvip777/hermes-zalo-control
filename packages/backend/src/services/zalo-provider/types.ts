// =============================================================================
// ZaloProvider — abstraction over zca-js write actions (Phase 2)
// =============================================================================
// Tools/services depend on THIS interface, never on zca-js/getApi() directly.
// Phase 2 scope: reaction + poll write actions (+ isConnected). Message sends
// (text/media/voice) keep using OutboundDispatcher — NOT added here.
// The provider never returns raw session/token/cookie.
// =============================================================================

export interface ProviderActionResult {
  ok: boolean;
  /** Provider-side id (poll_id, reaction ack, etc.) — never a session/token. */
  providerResultId?: string;
  error?: string;
  errorCode?: string;
}

export interface PollProviderResult extends ProviderActionResult {
  question?: string;
  optionsCount?: number;
  creator?: string;
  created?: string;
}

export interface ReactionActionInput {
  threadId: string;
  threadType: "user" | "group";
  msgId: string;
  cliMsgId?: string;
  /** Only HEART supported today; kept explicit for future icons. */
  icon: "heart";
}

export interface PollActionInput {
  groupId: string;
  question: string;
  options: string[];
  expiredTime?: number;
  allowMultiChoices?: boolean;
  allowAddNewOption?: boolean;
  hideVotePreview?: boolean;
  isAnonymous?: boolean;
}

// ── Read-side result types (whitelisted fields only — never raw session) ────

export interface ProviderRuntimeStatus {
  connected: boolean;
  connectionStatus: string;
  listenerActive?: boolean;
  selfUserId: string | null;
  selfDisplayName: string | null;
  dryRun: boolean;
}

export interface ProviderGroupSummary {
  groupId: string;
  name: string;
  memberCount: number;
  avatar: string | null;
}

export interface ProviderUserSummary {
  userId: string;
  displayName: string;
  avatar: string | null;
}

export interface ListGroupsResult extends ProviderActionResult {
  groups?: ProviderGroupSummary[];
}

export interface GroupInfoResult extends ProviderActionResult {
  group?: ProviderGroupSummary;
}

export interface UserInfoResult extends ProviderActionResult {
  user?: ProviderUserSummary;
}

export interface ListFriendsResult extends ProviderActionResult {
  friends?: ProviderUserSummary[];
}

export interface ZaloProvider {
  isConnected(): boolean;

  // ── Write actions (Phase 2) ──
  addReaction(input: ReactionActionInput): Promise<ProviderActionResult>;
  createPoll(input: PollActionInput): Promise<PollProviderResult>;

  // ── Read actions (Phase 3) — whitelisted fields only, no secrets ──
  /** Runtime status from the gateway (no cookie/token/session/context). */
  getRuntimeStatus(): ProviderRuntimeStatus;
  listGroups(): Promise<ListGroupsResult>;
  getGroupInfo(groupId: string): Promise<GroupInfoResult>;
  getUserInfo(userId: string): Promise<UserInfoResult>;
  listFriends(): Promise<ListFriendsResult>;
}
