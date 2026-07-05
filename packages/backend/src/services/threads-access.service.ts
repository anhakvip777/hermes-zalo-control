// =============================================================================
// Threads Access (AllowThreads) — discovery + normalization
// =============================================================================
// Discovers real Zalo friends/groups via the ZaloProvider (never raw zca-js),
// normalizes to a common shape, and joins the persistent allowlist to mark
// `allowed`. Pure/injectable so tests run without DB or network.
//
// Output is whitelisted (no raw metadata / session / cookie / token).
// =============================================================================

import type { AllowedThreadEntry, AllowThreadType } from "./allowlist.service.js";
import type { ZaloProvider } from "./zalo-provider/types.js";

export interface DiscoverItem {
  threadId: string;
  threadType: AllowThreadType;
  displayName: string;
  avatarUrl?: string;
  subtitle?: string;
  memberCount?: number;
  allowed: boolean;
  source: "zalo";
}

export interface DiscoverResult {
  items: DiscoverItem[];
  nextCursor?: string;
  connected: boolean;
  error?: string;
  errorCode?: string;
}

export type DiscoverType = "user" | "group" | "all";

export interface DiscoverParams {
  type: DiscoverType;
  query?: string;
  limit?: number;
  cursor?: string;
}

export interface DiscoverDeps {
  provider: Pick<ZaloProvider, "isConnected" | "listFriends" | "listGroups">;
  allowedEntries: AllowedThreadEntry[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : DEFAULT_LIMIT;
  if (v < 1) return 1;
  if (v > MAX_LIMIT) return MAX_LIMIT;
  return v;
}

function matches(item: DiscoverItem, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    item.displayName.toLowerCase().includes(needle) ||
    item.threadId.toLowerCase().includes(needle) ||
    item.threadType.toLowerCase().includes(needle)
  );
}

/**
 * Discover threads (friends/groups) and mark which are allowed.
 * Returns `connected:false` + errorCode when Zalo isn't connected — never mock data.
 */
export async function discoverThreads(
  params: DiscoverParams,
  deps: DiscoverDeps,
): Promise<DiscoverResult> {
  const { provider, allowedEntries } = deps;

  if (!provider.isConnected()) {
    return { items: [], connected: false, error: "Zalo is not connected", errorCode: "ZALO_NOT_CONNECTED" };
  }

  const allowedSet = new Set(allowedEntries.map((e) => `${e.threadType}:${e.threadId}`));
  const wantUser = params.type === "user" || params.type === "all";
  const wantGroup = params.type === "group" || params.type === "all";

  const items: DiscoverItem[] = [];
  let firstError: { error?: string; errorCode?: string } | null = null;

  if (wantUser) {
    const res = await provider.listFriends();
    if (res.ok && res.friends) {
      for (const f of res.friends) {
        items.push({
          threadId: f.userId,
          threadType: "user",
          displayName: f.displayName || f.userId,
          avatarUrl: f.avatar ?? undefined,
          allowed: allowedSet.has(`user:${f.userId}`),
          source: "zalo",
        });
      }
    } else if (!firstError) {
      firstError = { error: res.error, errorCode: res.errorCode };
    }
  }

  if (wantGroup) {
    const res = await provider.listGroups();
    if (res.ok && res.groups) {
      for (const g of res.groups) {
        items.push({
          threadId: g.groupId,
          threadType: "group",
          displayName: g.name || g.groupId,
          avatarUrl: g.avatar ?? undefined,
          memberCount: typeof g.memberCount === "number" ? g.memberCount : undefined,
          subtitle: typeof g.memberCount === "number" ? `${g.memberCount} thành viên` : undefined,
          allowed: allowedSet.has(`group:${g.groupId}`),
          source: "zalo",
        });
      }
    } else if (!firstError) {
      firstError = { error: res.error, errorCode: res.errorCode };
    }
  }

  // Filter by query.
  const q = (params.query ?? "").trim();
  const filtered = q ? items.filter((i) => matches(i, q)) : items;

  // Stable sort: allowed first, then by name.
  filtered.sort((a, b) => {
    if (a.allowed !== b.allowed) return a.allowed ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });

  // Cursor-based pagination (numeric offset encoded as string).
  const limit = clampLimit(params.limit);
  const offset = params.cursor ? Math.max(0, parseInt(params.cursor, 10) || 0) : 0;
  const page = filtered.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const nextCursor = nextOffset < filtered.length ? String(nextOffset) : undefined;

  // If nothing came back AND a provider call failed, surface the error.
  const result: DiscoverResult = { items: page, connected: true };
  if (nextCursor) result.nextCursor = nextCursor;
  if (page.length === 0 && filtered.length === 0 && firstError) {
    result.error = firstError.error ?? "Provider unavailable";
    result.errorCode = firstError.errorCode ?? "PROVIDER_UNAVAILABLE";
  }
  return result;
}
