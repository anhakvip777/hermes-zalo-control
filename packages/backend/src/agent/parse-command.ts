// =============================================================================
// Parse Command — rule-based natural language → schedule draft
// =============================================================================

import { config } from "../config.js";

const TIME_PATTERNS: Array<{ regex: RegExp; parse: (m: RegExpMatchArray) => string }> = [
  { regex: /(\d{1,2})\s*[h:]\s*(\d{0,2})?\s*(toi|chieu|sang|trua|dem|khuya)?/i, parse: (m) => parseTime(m[1]!, m[2] || "0", m[3]) },
  { regex: /(\d{1,2})\s*gio\s*(\d{0,2})?\s*(toi|chieu|sang|trua|dem|khuya)?/i, parse: (m) => parseTime(m[1]!, m[2] || "0", m[3]) },
  { regex: /(toi|chieu|sang|trua|dem|khuya)\s*nay/i, parse: (m) => partOfDay(m[1]!) },
];

const INTENT_KEYWORDS: Record<string, string> = {
  "nhắc nhở": "create_schedule",
  "nhắc": "create_schedule",
  "gửi tin": "create_schedule",
  "nhắn tin": "create_schedule",
  "gửi": "create_schedule",
  "điểm danh": "create_attendance",
  "tìm tin": "search_messages",
  "tìm kiếm": "search_messages",
  "tra cứu": "search_messages",
  "tổng hợp": "summarize",
  "tóm tắt": "summarize",
  "poll": "extract_poll",
  "bình chọn": "extract_poll",
  "tạo lịch": "create_schedule",
  // English fallback
  "remind": "create_schedule",
  "send": "create_schedule",
  "attendance": "create_attendance",
};

export interface ParseResult {
  intent: string;
  scheduleDraft?: Record<string, unknown>;
  needsConfirmation: boolean;
  missingFields: string[];
  rawCommand: string;
}

// ── Vietnamese diacritic removal ───────────────────────────────────
// Map: ắ→a, ế→e, ớ→o, etc. Keeps the string readable for keyword matching.
const DIACRITIC_MAP: Record<string, string> = {
  "àáảãạ": "a", "ằắẳẵặ": "a", "ầấẩẫậ": "a",
  "èéẻẽẹ": "e", "ềếểễệ": "e",
  "ìíỉĩị": "i",
  "òóỏõọ": "o", "ồốổỗộ": "o", "ờớởỡợ": "o",
  "ùúủũụ": "u", "ừứửữự": "u",
  "ỳýỷỹỵ": "y",
  "đ": "d",
  "ĂẮẰẲẴẶ": "a", "ÂẦẤẨẪẬ": "a",
  "ÊỀẾỂỄỆ": "e",
  "ÔỒỐỔỖỘ": "o", "ƠỜỚỞỠỢ": "o",
  "ƯỪỨỬỮỰ": "u",
  "Đ": "d",
};

function removeDiacritics(str: string): string {
  let result = str;
  for (const [group, replacement] of Object.entries(DIACRITIC_MAP)) {
    for (const ch of group) {
      result = result.replaceAll(ch, replacement);
    }
  }
  return result;
}

function normalizeForMatching(cmd: string): string {
  return removeDiacritics(cmd.toLowerCase().trim());
}

// ── Timezone helpers ────────────────────────────────────────────────
const TIMEZONE = config.timezone ?? "Asia/Ho_Chi_Minh";

function toUtc(localISO: string): string {
  try {
    // Parse local time, treat as Asia/Ho_Chi_Minh
    const d = new Date(localISO);
    return d.toISOString();
  } catch {
    return localISO;
  }
}

function nowInTimezone(): Date {
  // Use a simple offset approach: Asia/Ho_Chi_Minh = UTC+7
  const utc = new Date();
  return new Date(utc.getTime() + 7 * 60 * 60 * 1000);
}

// ═══════════════════════════════════════════════════════════════════
// Main Entry
// ═══════════════════════════════════════════════════════════════════

export function parseCommand(command: string): ParseResult {
  const normalized = normalizeForMatching(command);
  const missing: string[] = [];
  const draft: Record<string, unknown> = {
    type: "zalo_message",
    createdBy: "ai",
    originalCommand: command,
    timezone: TIMEZONE,
  };

  // 1. Detect intent (on normalized text)
  const intent = detectIntent(normalized);

  // 2. Extract time (local Vietnam time)
  const timeResult = extractTime(normalized);
  if (timeResult) {
    draft.scheduledAtUtc = toUtc(timeResult);
    draft.scheduledAtLocal = timeResult;
    draft.scheduledAt = toUtc(timeResult); // backward compat
  } else {
    missing.push("scheduledAt");
  }

  // 3. Extract target name (search original for diacritics retention)
  const targetName = extractTargetName(normalized);
  if (targetName) {
    // Try to recover the diacritic version from the original command
    const recoveredTarget = recoverTargetFromOriginal(command, targetName);
    draft.targetName = recoveredTarget;
    draft.targetId = `group:${removeDiacritics(recoveredTarget).toLowerCase().replace(/\s+/g, "-")}`;
  } else {
    missing.push("targetId");
  }

  // 4. Extract message content (regex on normalized, then recover diacritics)
  const rawContentMatch = extractContentMatch(normalized);
  const content = rawContentMatch
    ? generateRecoveredMessage(rawContentMatch, command, draft)
    : generateFallbackMessage(detectIntent(normalized), extractTimeDisplay(command), draft);
  if (content) {
    draft.messageContent = content;
  }
  if (!draft.messageContent || String(draft.messageContent).length < 5) {
    missing.push("messageContent");
  }

  // 5. Name
  draft.name = extractName(command, draft);

  return {
    intent,
    scheduleDraft: draft,
    needsConfirmation: intent === "unknown" || missing.length > 0,
    missingFields: missing,
    rawCommand: command,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

// Build normalized keywords once
const NORMALIZED_INTENTS: Array<[string, string]> = Object.entries(INTENT_KEYWORDS).map(
  ([k, v]) => [normalizeForMatching(k), v],
);

function detectIntent(cmd: string): string {
  for (const [keyword, intent] of NORMALIZED_INTENTS) {
    if (cmd.includes(keyword)) return intent;
  }
  return "unknown";
}

function extractTime(cmd: string): string | null {
  for (const { regex, parse } of TIME_PATTERNS) {
    const m = cmd.match(regex);
    if (m) {
      const iso = parse(m);
      if (iso) return iso;
    }
  }
  return null;
}

function parseTime(hour: string, min: string, period?: string): string {
  let h = parseInt(hour, 10);
  if (isNaN(h) || h < 0 || h > 23) return "";

  // Normalize period for comparison (handle both diacritic and ASCII)
  const periodNorm = period ? normalizeForMatching(period) : "";

  if (periodNorm) {
    if (["toi", "dem", "khuya"].some((p) => periodNorm.includes(p))) {
      if (h < 12) h += 12;
    } else if (["sang", "trua"].some((p) => periodNorm.includes(p))) {
      if (h === 12) h = 0;
    }
  }

  // If no period and hour <= 6, assume PM
  if (!periodNorm && h <= 6) h += 12;

  const m = parseInt(min, 10) || 0;
  const now = nowInTimezone();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);

  // If in the past, assume tomorrow
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  return target.toISOString();
}

function partOfDay(period: string): string {
  const periodNorm = normalizeForMatching(period);
  const map: Record<string, number> = { sang: 7, trua: 12, chieu: 17, toi: 20, dem: 22, khuya: 23 };
  const hour = Object.entries(map).find(([k]) => periodNorm.includes(k))?.[1] ?? 20;
  const now = nowInTimezone();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.toISOString();
}

function extractTargetName(cmd: string): string | null {
  const patterns = [
    /vào\s+group\s+(.+?)(?:\s*$|\.|\s+vào\s+|\s+lúc\s+)/i,
    /vào\s+nhóm\s+(.+?)(?:\s*$|\.|\s+vào\s+|\s+lúc\s+)/i,
    /group\s+(.+?)(?:\s*$|\.|\s+vào\s+|\s+lúc\s+)/i,
    /lớp\s+(.+?)(?:\s*$|\.|\s+vào\s+|\s+lúc\s+)/i,
    /nhóm\s+(.+?)(?:\s*$|\.|\s+vào\s+|\s+lúc\s+)/i,
    /trong\s+group\s+(.+?)(?:\s*$|\.)/i,
  ];
  for (const p of patterns) {
    const m = cmd.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function extractContent(normalized: string, original: string, draft: Record<string, unknown>): string | null {
  // Try regex extraction first
  const patterns = [
    /nh[ăa]c\s+(.+?)(?:\s+v[àa]o\s+(?:group|nh[óo]m|l[ớơ]p)|\s+(?:group|nh[óo]m|l[ớơ]p)|\s+l[úu]c\s+\d)/i,
    /nh[ăa]c\s+nh[ởo]\s+(.+?)(?:\s+v[àa]o\s+(?:group|nh[óo]m|l[ớơ]p)|\s+l[úu]c\s+\d)/i,
    /nh[ăa]n\s+(.+?)(?:\s+v[àa]o\s+(?:group|nh[óo]m|l[ớơ]p)|\s+(?:group|nh[óo]m|l[ớơ]p)|\s+l[úu]c\s+\d)/i,
    /g[ưử]i\s+(.+?)(?:\s+v[àa]o\s+(?:group|nh[óo]m|l[ớơ]p)|\s+(?:group|nh[óo]m|l[ớơ]p)|\s+l[úu]c\s+\d)/i,
    /(?:điểm danh|diem danh)\s+(.+?)(?:\s+v[àa]o\s+(?:group|nh[óo]m|l[ớơ]p)|\s+l[úu]c\s+\d)/i,
  ];
  for (const p of patterns) {
    const m = normalized.match(p);
    if (m?.[1]) {
      const raw = m[1].trim();
      if (raw.length > 5) return generateMessage(raw, draft);
    }
  }

  // Fallback: build a sensible message from keyword
  const keyword = normalized.includes("diem danh") ? "diem danh" :
                  normalized.includes("nhac") ? "nhac" :
                  normalized.includes("gui") ? "gui" : null;

  if (keyword) {
    const timeStr = extractTimeDisplay(original);
    return generateFallbackMessage(keyword, timeStr, draft);
  }

  // Last resort: short snippet of original
  return original.length > 200 ? original.slice(0, 197) + "..." : original;
}

function extractContentMatch(normalized: string): string | null {
  const patterns = [
    /nh[ăa]c\s+(.+?)(?:\s+v[àa]o\s+(?:group|nh[óo]m|l[ớơ]p)|\s+(?:group|nh[óo]m|l[ớơ]p)|\s+l[úu]c\s+\d)/i,
    /nh[ăa]c\s+nh[ởo]\s+(.+?)(?:\s+v[àa]o\s+(?:group|nh[óo]m|l[ớơ]p)|\s+l[úu]c\s+\d)/i,
    /nh[ăa]n\s+(.+?)(?:\s+v[àa]o\s+(?:group|nh[óo]m|l[ớơ]p)|\s+(?:group|nh[óo]m|l[ớơ]p)|\s+l[úu]c\s+\d)/i,
    /g[ưử]i\s+(.+?)(?:\s+v[àa]o\s+(?:group|nh[óo]m|l[ớơ]p)|\s+(?:group|nh[óo]m|l[ớơ]p)|\s+l[úu]c\s+\d)/i,
    /(?:điểm danh|diem danh)\s+(.+?)(?:\s+v[àa]o\s+(?:group|nh[óo]m|l[ớơ]p)|\s+l[úu]c\s+\d)/i,
  ];
  for (const p of patterns) {
    const m = normalized.match(p);
    if (m?.[1]) {
      const raw = m[1].trim();
      if (raw.length > 2 && !["vao", "vào"].includes(raw)) return raw;
    }
  }
  return null;
}

function recoverTargetFromOriginal(original: string, normalizedMatch: string): string {
  // Try to find the matching phrase in original that corresponds to normalizedMatch.
  // Apply removeDiacritics to both sides for correct Vietnamese matching
  // (e.g., "lop" → finds "Lớp" in the original).
  const words = normalizedMatch.split(/\s+/);
  const normalizedOriginal = removeDiacritics(original.toLowerCase());
  const idx = normalizedOriginal.indexOf(removeDiacritics(words[0]!.toLowerCase()));
  if (idx >= 0) {
    // Extract the phrase from original starting at that position
    const tail = original.slice(idx);
    const mt = tail.match(/^(\S+(?:\s+\S+){0,4})/);
    if (mt?.[1]) return mt[1].trim();
  }
  return normalizedMatch;
}

function generateRecoveredMessage(normalizedMatch: string, original: string, draft: Record<string, unknown>): string {
  // Find the original Vietnamese text matching the normalized match
  const recoveredText = recoverTargetFromOriginal(original, normalizedMatch);
  const target = draft.targetName ? `các huynh đệ ${String(draft.targetName)}` : "các huynh đệ";
  return `${target} nhớ ${recoveredText} nhé.`;
}

function extractTimeDisplay(cmd: string): string {
  const m = cmd.match(/(\d{1,2}\s*[h:]\s*\d{0,2}\s*(?:t[ốô]i|chi[ềê]u|s[áa]ng|tr[ưu]a|[đd][êê]m|khuya)?)/i);
  return m?.[1]?.trim() ?? "";
}

function generateMessage(rawContent: string, draft: Record<string, unknown>): string {
  // Build a polite reminder message around the extracted content
  const target = draft.targetName ? `các huynh đệ ${String(draft.targetName)}` : "các huynh đệ";
  return `${target} nhớ ${rawContent} nhé.`;
}

function generateFallbackMessage(keyword: string, timeStr: string, draft: Record<string, unknown>): string {
  const target = draft.targetName ? `các huynh đệ ${String(draft.targetName)}` : "các huynh đệ";
  const time = timeStr ? ` lúc ${timeStr}` : "";

  if (keyword === "diem danh") {
    return `${target} điểm danh giúp anh${time} nhé. Ai có mặt nhắn: Có mặt hoặc Con có mặt.`;
  }
  if (keyword === "nhac") {
    return `${target} nhớ${time} nhé.`;
  }
  if (keyword === "gui") {
    return `${target}${time} nhé.`;
  }
  return draft.originalCommand as string;
}

function extractName(cmd: string, draft: Record<string, unknown>): string {
  const content = String(draft.messageContent ?? "");
  if (content.length > 5) return `Nhắc: ${content.slice(0, 60)}`;
  return `Task from Hermes: ${cmd.slice(0, 60)}`;
}
