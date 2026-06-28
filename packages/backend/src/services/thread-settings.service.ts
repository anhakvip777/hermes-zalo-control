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
};

const GROUP_DEFAULTS: ThreadSettingData = {
  threadId: "",
  autoReplyEnabled: true,
  groupMentionRequired: true,
  groupReplyWindowSeconds: 600,
  allowCreateReminder: true,
  allowMedia: false,
  allowImageUnderstanding: false,
};

/**
 * Get thread settings, creating defaults if not yet saved.
 * DM threads: groupMentionRequired=false, groupReplyWindowSeconds=0.
 * Group threads: groupMentionRequired=true, groupReplyWindowSeconds=600.
 */
export async function getThreadSettings(
  threadId: string,
  threadType: "user" | "group" = "group",
): Promise<ThreadSettingData> {
  let s = await prisma.threadSetting.findUnique({ where: { threadId } });
  if (s) {
    return {
      threadId: s.threadId,
      autoReplyEnabled: s.autoReplyEnabled,
      groupMentionRequired: s.groupMentionRequired,
      groupReplyWindowSeconds: s.groupReplyWindowSeconds,
      allowCreateReminder: s.allowCreateReminder,
      allowMedia: s.allowMedia,
      allowImageUnderstanding: (s as any).allowImageUnderstanding ?? false,
      notes: s.notes,
    };
  }

  // Create defaults based on thread type
  const defaults = threadType === "user" ? { ...DM_DEFAULTS, threadId } : { ...GROUP_DEFAULTS, threadId };
  s = await prisma.threadSetting.create({
    data: {
      threadId,
      autoReplyEnabled: defaults.autoReplyEnabled,
      groupMentionRequired: defaults.groupMentionRequired,
      groupReplyWindowSeconds: defaults.groupReplyWindowSeconds,
      allowCreateReminder: defaults.allowCreateReminder,
      allowMedia: defaults.allowMedia,
      allowImageUnderstanding: defaults.allowImageUnderstanding,
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
    notes: s.notes,
  };
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
    notes: s.notes,
  };
}

/**
 * List all thread settings (for admin UI).
 */
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
