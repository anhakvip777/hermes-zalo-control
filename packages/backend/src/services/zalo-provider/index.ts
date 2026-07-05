// =============================================================================
// ZaloProvider — public surface (Phase 2)
// =============================================================================

export type {
  ZaloProvider,
  ProviderActionResult,
  PollProviderResult,
  ReactionActionInput,
  PollActionInput,
  ProviderRuntimeStatus,
  ProviderGroupSummary,
  ProviderUserSummary,
  ListGroupsResult,
  GroupInfoResult,
  UserInfoResult,
  ListFriendsResult,
} from "./types.js";
export { ZcaJsProvider, getZaloProvider, setZaloProviderForTest } from "./zca-js-provider.js";
export {
  performGovernedZaloAction,
  type GovernedActionInput,
  type GovernedActionDeps,
  type GovernedActionResult,
} from "./governed-action.js";
