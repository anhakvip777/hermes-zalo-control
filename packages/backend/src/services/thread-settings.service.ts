// =============================================================================
// ThreadSettings service — per-thread auto-reply configuration
// =============================================================================

import { prisma } from "../db.js";

export interface ThreadSettingData {
  threadId: string;
  autoReplyEnabled: boolean;
  groupMentionRequired: boolean;
  groupReplyWindowSeconds: number;
  allowCreateReminder: boolean;
  allowMedia: boolean;
  allowImageUnderstanding: boolean;
  allowDocumentUnderstanding: boolean;
  notes?: string | null;
}

// Default settings per thread type
const DM_DEFAULTS: ThreadSettingData = {
  threadId: "",
  autoReplyEnabled: true,
  groupMentionRequired: false,
  groupReplyWindowSeconds: 0,
  allowCreateReminder: true,
  allowMedia: false,
  allowImageUnderstanding: false,
  allowDocumentUnderstanding: false,
};

const GROUP_DEFAULTS: ThreadSettingData = {
  threadId: "",
  autoReplyEnabled: true,
  groupMentionRequired: true,
  groupReplyWindowSeconds: 600,
  allowCreateReminder: true,
  allowMedia: false,
  allowImageUnderstanding: false,
  allowDocumentUnderstanding: false,
};

/** Convert a persisted Prisma row to the runtime DTO. */
function toThreadSettingData(s: {
  threadId: string;
  autoReplyEnabled: boolean;
  groupMentionRequired: boolean;
  groupReplyWindowSeconds: number;
  allowCreateReminder: boolean;
  allowMedia: boolean;
  allowImageUnderstanding?: boolean | null;
  allowDocumentUnderstanding?: boolean | null;
  notes: string | null;
}): ThreadSettingData {
  return {
    threadId: s.threadId,
    autoReplyEnabled: s.autoReplyEnabled,
    groupMentionRequired: s.groupMentionRequired,
    groupReplyWindowSeconds: s.groupReplyWindowSeconds,
    allowCreateReminder: s.allowCreateReminder,
    allowMedia: s.allowMedia,
    allowImageUnderstanding: s.allowImageUnderstanding ?? false,
    allowDocumentUnderstanding: s.allowDocumentUnderstanding ?? false,
    notes: s.notes,
  };
}

function defaultsFor(threadId: string, threadType: "user" | "group"): ThreadSettingData {
  return { ...(threadType === "user" ? DM_DEFAULTS : GROUP_DEFAULTS), threadId };
}

/** Read settings without creating a default row. */
export async function peekThreadSettings(
  threadId: string,
  threadType: "user" | "group" = "group",
): Promise<{ data: ThreadSettingData; configured: boolean }> {
  const s = await prisma.threadSetting.findUnique({ where: { threadId } });
  return s
    ? { data: toThreadSettingData(s), configured: true }
    : { data: defaultsFor(threadId, threadType), configured: false };
}

/**
 * Get thread settings, creating defaults if not yet saved.
 * Runtime dispatcher/reaction callers retain this persistence behavior.
 */
export async function getThreadSettings(
  threadId: string,
  threadType: "user" | "group" = "group",
): Promise<ThreadSettingData> {
  const s = await prisma.threadSetting.findUnique({ where: { threadId } });
  if (s) return toThreadSettingData(s);

  const defaults = defaultsFor(threadId, threadType);
  const created = await prisma.threadSetting.create({
    data: {
      threadId,
      autoReplyEnabled: defaults.autoReplyEnabled,
      groupMentionRequired: defaults.groupMentionRequired,
      groupReplyWindowSeconds: defaults.groupReplyWindowSeconds,
      allowCreateReminder: defaults.allowCreateReminder,
      allowMedia: defaults.allowMedia,
      allowImageUnderstanding: defaults.allowImageUnderstanding,
      allowDocumentUnderstanding: defaults.allowDocumentUnderstanding,
    },
  });
  return toThreadSettingData(created);
}

/** List settings for runtime callers; admin DTO enrichment is route-owned. */
export async function listThreadSettings(page = 1, pageSize = 50) {
  const [data, total] = await Promise.all([
    prisma.threadSetting.findMany({
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.threadSetting.count(),
  ]);
  return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/**
 * Update thread settings.
 */
export async function updateThreadSettings(
  threadId: string,
  updates: Partial<Omit<ThreadSettingData, "threadId">>,
): Promise<ThreadSettingData> {
  const s = await prisma.threadSetting.upsert({
    where: { threadId },
    update: {
      ...(updates.autoReplyEnabled !== undefined && { autoReplyEnabled: updates.autoReplyEnabled }),
      ...(updates.groupMentionRequired !== undefined && { groupMentionRequired: updates.groupMentionRequired }),
      ...(updates.groupReplyWindowSeconds !== undefined && {
        groupReplyWindowSeconds: updates.groupReplyWindowSeconds,
      }),
      ...(updates.allowCreateReminder !== undefined && { allowCreateReminder: updates.allowCreateReminder }),
      ...(updates.allowMedia !== undefined && { allowMedia: updates.allowMedia }),
      ...(updates.allowImageUnderstanding !== undefined && { allowImageUnderstanding: updates.allowImageUnderstanding }),
      ...(updates.allowDocumentUnderstanding !== undefined && { allowDocumentUnderstanding: updates.allowDocumentUnderstanding }),
      ...(updates.notes !== undefined && { notes: updates.notes }),
    },
    create: {
      threadId,
      autoReplyEnabled: updates.autoReplyEnabled ?? true,
      groupMentionRequired: updates.groupMentionRequired ?? true,
      groupReplyWindowSeconds: updates.groupReplyWindowSeconds ?? 600,
      allowCreateReminder: updates.allowCreateReminder ?? true,
      allowMedia: updates.allowMedia ?? false,
      allowImageUnderstanding: updates.allowImageUnderstanding ?? false,
      allowDocumentUnderstanding: updates.allowDocumentUnderstanding ?? false,
      notes: updates.notes,
    },
  });
  return {
    threadId: s.threadId,
    autoReplyEnabled: s.autoReplyEnabled,
    groupMentionRequired: s.groupMentionRequired,
    groupReplyWindowSeconds: s.groupReplyWindowSeconds,
    allowCreateReminder: s.allowCreateReminder,
    allowMedia: s.allowMedia,
    allowImageUnderstanding: (s as any).allowImageUnderstanding ?? false,
    allowDocumentUnderstanding: (s as any).allowDocumentUnderstanding ?? false,
    notes: s.notes,
  };
}
