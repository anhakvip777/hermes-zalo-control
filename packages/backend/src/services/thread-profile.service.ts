import { prisma } from "../db.js";

// ═══════════════════════════════════════════════════════════════════
// ThreadProfile — thread display name + identity metadata
// Batch T1: upsert from inbound Zalo events, enrich API responses
// ═══════════════════════════════════════════════════════════════════

export interface ThreadProfileInput {
  threadId: string;
  threadType?: string | null;
  senderName?: string | null;
  threadName?: string | null;
}

/**
 * Determine displayName from inbound Zalo message.
 *
 * Rules:
 *   DM (user):  senderName > threadName > null
 *   Group:       threadName only (never use senderName as group name)
 */
function resolveDisplayNameFromMessage(
  threadType: string | undefined | null,
  senderName: string | undefined | null,
  threadName: string | undefined | null,
): { displayName: string | null; source: string } {
  const isGroup = threadType === "group";

  if (isGroup) {
    // Group: only use threadName (group name), never senderName
    if (threadName?.trim()) {
      return { displayName: threadName.trim(), source: "zalo_event_group" };
    }
    return { displayName: null, source: "zalo_event_group" };
  }

  // DM: prefer senderName (the user's name), fallback to threadName
  if (senderName?.trim()) {
    return { displayName: senderName.trim(), source: "zalo_event_user" };
  }
  if (threadName?.trim()) {
    return { displayName: threadName.trim(), source: "zalo_event_user" };
  }
  return { displayName: null, source: "zalo_event_user" };
}

/**
 * Upsert ThreadProfile from an inbound Zalo message.
 * Called on every Message.create — non-blocking, never throws.
 */
export async function upsertThreadProfileFromMessage(
  input: ThreadProfileInput,
): Promise<void> {
  const { displayName, source } = resolveDisplayNameFromMessage(
    input.threadType,
    input.senderName,
    input.threadName,
  );

  try {
    await prisma.threadProfile.upsert({
      where: { threadId: input.threadId },
      create: {
        threadId: input.threadId,
        threadType: input.threadType ?? undefined,
        displayName,
        source,
        lastSeenAt: new Date(),
        lastSyncAt: new Date(),
      },
      update: {
        threadType: input.threadType ?? undefined,
        displayName: displayName ?? undefined,
        source: source ?? undefined,
        lastSeenAt: new Date(),
        lastSyncAt: new Date(),
      },
    });
  } catch {
    // Non-blocking: profile upsert failure must not affect message processing
  }
}

/**
 * Get a single ThreadProfile by threadId.
 * Returns null if not found (never throws).
 */
export async function getThreadProfile(threadId: string) {
  try {
    return await prisma.threadProfile.findUnique({ where: { threadId } });
  } catch {
    return null;
  }
}

/**
 * Batch-get ThreadProfiles for multiple threadIds.
 * Returns Map<threadId, ThreadProfile>.
 */
export async function getThreadProfiles(
  threadIds: string[],
): Promise<Map<string, { displayName: string | null; threadType: string | null; avatarUrl: string | null }>> {
  const uniqueIds = Array.from(new Set(threadIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

  try {
    const profiles = await prisma.threadProfile.findMany({
      where: { threadId: { in: uniqueIds } },
    });
    const map = new Map<string, { displayName: string | null; threadType: string | null; avatarUrl: string | null }>();
    for (const p of profiles) {
      map.set(p.threadId, {
        displayName: p.displayName,
        threadType: p.threadType,
        avatarUrl: p.avatarUrl,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Resolve display name for a single threadId.
 * Returns null if no profile found (never throws).
 */
export async function resolveDisplayName(threadId: string): Promise<string | null> {
  const profile = await getThreadProfile(threadId);
  return profile?.displayName ?? null;
}
