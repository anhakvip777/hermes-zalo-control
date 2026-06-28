// =============================================================================
// ThreadConversationStateService — multi-turn pending intent + slot tracking
// =============================================================================

import { prisma } from "../db.js";

export interface ConversationState {
  threadId: string;
  pendingIntent: string | null;
  missingSlots: string[];
  collectedSlots: Record<string, string>;
  lastAssistantQuestion: string | null;
  expiresAt: Date | null;
}

const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get current conversation state for a thread.
 * Returns null if no active state or expired.
 */
export async function getConversationState(
  threadId: string,
): Promise<ConversationState | null> {
  const row = await prisma.threadConversationState.findUnique({
    where: { threadId },
  });

  if (!row) return null;

  // Check expiration
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
    await clearConversationState(threadId);
    return null;
  }

  return {
    threadId: row.threadId,
    pendingIntent: row.pendingIntent,
    missingSlots: row.missingSlots ? JSON.parse(row.missingSlots) : [],
    collectedSlots: row.collectedSlots ? JSON.parse(row.collectedSlots) : {},
    lastAssistantQuestion: row.lastAssistantQuestion,
    expiresAt: row.expiresAt,
  };
}

/**
 * Set or update conversation state.
 */
export async function setConversationState(
  state: Omit<ConversationState, "expiresAt"> & { ttlMs?: number },
): Promise<ConversationState> {
  const ttlMs = state.ttlMs ?? STATE_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs);

  const row = await prisma.threadConversationState.upsert({
    where: { threadId: state.threadId },
    update: {
      pendingIntent: state.pendingIntent,
      missingSlots: JSON.stringify(state.missingSlots),
      collectedSlots: JSON.stringify(state.collectedSlots),
      lastAssistantQuestion: state.lastAssistantQuestion,
      expiresAt,
      updatedAt: new Date(),
    },
    create: {
      threadId: state.threadId,
      pendingIntent: state.pendingIntent,
      missingSlots: JSON.stringify(state.missingSlots),
      collectedSlots: JSON.stringify(state.collectedSlots),
      lastAssistantQuestion: state.lastAssistantQuestion,
      expiresAt,
    },
  });

  return {
    threadId: row.threadId,
    pendingIntent: row.pendingIntent,
    missingSlots: row.missingSlots ? JSON.parse(row.missingSlots) : [],
    collectedSlots: row.collectedSlots ? JSON.parse(row.collectedSlots) : {},
    lastAssistantQuestion: row.lastAssistantQuestion,
    expiresAt: row.expiresAt,
  };
}

/**
 * Clear conversation state (intent completed or expired).
 */
export async function clearConversationState(threadId: string): Promise<void> {
  await prisma.threadConversationState.deleteMany({ where: { threadId } });
}

/**
 * Try to fill a missing slot from a user message.
 * Returns updated state, or null if unable to fill any slot.
 * Simple approach: if there are missing slots, try to extract the first one
 * from the user's message.
 */
export function tryFillSlot(
  state: ConversationState,
  userMessage: string,
): { updated: ConversationState; slotFilled: string; value: string } | null {
  if (!state.pendingIntent || state.missingSlots.length === 0) return null;

  // Simple: take the first missing slot and use the user's entire message as its value
  const slot = state.missingSlots[0] as string;
  const value = userMessage.trim();

  if (!value || !slot) return null;

  const newMissingSlots = state.missingSlots.slice(1);
  const newCollectedSlots = { ...state.collectedSlots, [slot]: value };

  const updated: ConversationState = {
    ...state,
    missingSlots: newMissingSlots,
    collectedSlots: newCollectedSlots,
  };

  return { updated, slotFilled: slot, value };
}

/**
 * Build a context string describing the current conversation state
 * to inject into the Hermes prompt.
 */
export function buildStateContextString(state: ConversationState): string {
  if (!state.pendingIntent) return "";

  const parts: string[] = [];
  parts.push(`[TRẠNG THÁI HỘI THOẠI ĐANG DỞ]`);
  parts.push(`Intent: ${state.pendingIntent}`);

  if (Object.keys(state.collectedSlots).length > 0) {
    const slots = Object.entries(state.collectedSlots)
      .map(([k, v]) => `${k}="${v}"`)
      .join(", ");
    parts.push(`Đã có: ${slots}`);
  }

  if (state.missingSlots.length > 0) {
    parts.push(`Còn thiếu: ${state.missingSlots.join(", ")}`);
  }

  if (state.lastAssistantQuestion) {
    parts.push(`Câu hỏi trước của bot: "${state.lastAssistantQuestion}"`);
  }

  parts.push("[KẾT THÚC TRẠNG THÁI]");
  parts.push("");

  return parts.join("\n");
}

/**
 * Detect if a user message completes a pending intent.
 * Simple heuristic: if all slots are filled after processing.
 */
export function isIntentComplete(state: ConversationState): boolean {
  return (
    !!state.pendingIntent &&
    state.missingSlots.length === 0 &&
    Object.keys(state.collectedSlots).length > 0
  );
}

// ── Common intent templates ──────────────────────────────────

export const INTENT_TEMPLATES: Record<string, { missingSlots: string[] }> = {
  weather_location: {
    missingSlots: ["location"],
  },
  schedule_create: {
    missingSlots: ["time", "content"],
  },
  poll_options: {
    missingSlots: ["question", "options"],
  },
};
