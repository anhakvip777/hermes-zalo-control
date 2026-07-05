// =============================================================================
// Zalo tools — shared dependencies (Phase 3)
// =============================================================================
// Injectable deps so tools are DB-free testable. Defaults use the real
// ZaloProvider + OutboundDispatcher + Prisma. Tools NEVER import zca-js and
// NEVER call getApi()/sendMessage directly — only the provider / dispatcher.
// =============================================================================

import type { OutboundIntent, OutboundResult } from "../../outbound-dispatcher.service.js";
import type { ZaloProvider } from "../../zalo-provider/types.js";

export interface DbThreadInfo {
  source: "db";
  threadId: string;
  threadType: "user" | "group";
  name: string | null;
}

export interface ZaloToolDeps {
  /** Provider accessor (default: getZaloProvider). */
  getProvider?: () => ZaloProvider;
  /** Outbound dispatcher (default: sendOutbound). zalo.sendText uses ONLY this. */
  sendOutbound?: (intent: OutboundIntent) => Promise<OutboundResult>;
  /** DB fallback reader for getThreadInfo (default: Prisma ZaloThread/ThreadProfile). */
  readThreadFromDb?: (threadId: string, threadType: "user" | "group") => Promise<DbThreadInfo | null>;
}

/** Resolve the provider (injected or default). */
export async function resolveProvider(deps: ZaloToolDeps): Promise<ZaloProvider> {
  if (deps.getProvider) return deps.getProvider();
  const { getZaloProvider } = await import("../../zalo-provider/zca-js-provider.js");
  return getZaloProvider();
}

/** Resolve the outbound sender (injected or default). */
export async function resolveSendOutbound(
  deps: ZaloToolDeps,
): Promise<(intent: OutboundIntent) => Promise<OutboundResult>> {
  if (deps.sendOutbound) return deps.sendOutbound;
  const { sendOutbound } = await import("../../outbound-dispatcher.service.js");
  return sendOutbound;
}

/** Default DB thread reader (Prisma). Non-fatal on error → null. */
export async function defaultReadThreadFromDb(
  threadId: string,
  threadType: "user" | "group",
): Promise<DbThreadInfo | null> {
  try {
    const { prisma } = await import("../../../db.js");
    const row = await (prisma as any).zaloThread.findUnique({ where: { id: threadId } });
    if (row) {
      return { source: "db", threadId, threadType, name: row.name ?? null };
    }
    const profile = await (prisma as any).threadProfile.findUnique({ where: { threadId } });
    if (profile) {
      return { source: "db", threadId, threadType, name: profile.displayName ?? null };
    }
    return null;
  } catch {
    return null;
  }
}
