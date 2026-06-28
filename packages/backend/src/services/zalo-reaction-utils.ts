// =============================================================================
// Zalo Reaction Utils — normalize reaction events from zca-js listener
// =============================================================================

/** Normalized inbound reaction data from zca-js */
export interface NormalizedReaction {
  threadId: string;
  isGroup: boolean;
  isSelf: boolean;
  uidFrom: string;
  msgId: string;       // The message being reacted to
  cliMsgId: string;
  rIcon: string;        // Reactions enum value, e.g. "/-heart"
  rType: number;
  ts: string;
}

/**
 * Normalize a raw reaction event from zca-js listener into a structured object.
 * Returns null if required fields are missing.
 */
export function normalizeReaction(raw: Record<string, unknown> | null): NormalizedReaction | null {
  // Handle null/undefined
  if (!raw) return null;

  // Check for Reaction class instance from zca-js
  const data = (raw as any).data as Record<string, unknown> | undefined;
  if (!data) return null;

  const threadId = (raw as any).threadId as string | undefined;
  const isSelf = (raw as any).isSelf === true;
  const isGroup = (raw as any).isGroup === true;

  if (!threadId) return null;

  const uidFrom = data.uidFrom as string | undefined;
  const msgId = data.msgId as string | undefined;
  const cliMsgId = data.cliMsgId as string | undefined;
  const content = data.content as Record<string, unknown> | undefined;

  if (!uidFrom || !msgId) return null;

  return {
    threadId,
    isGroup,
    isSelf,
    uidFrom,
    msgId,
    cliMsgId: cliMsgId ?? "",
    rIcon: (content?.rIcon as string) ?? "",
    rType: (content?.rType as number) ?? 0,
    ts: (data.ts as string) ?? new Date().toISOString(),
  };
}
