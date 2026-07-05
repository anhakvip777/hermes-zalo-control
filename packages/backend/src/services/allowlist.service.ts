// =============================================================================
// AllowThreads allowlist service
// =============================================================================
// Persistent, threadType-aware allowlist that gates auto-reply / agent
// processing per thread. Backed by the existing RuntimeSetting key-value table
// (key: "access.allowedThreads", value: JSON [{threadId, threadType}]) so it is
// runtime-mutable WITHOUT a schema change/migration and matches the repo's
// runtime-config pattern (hot in-memory cache + sync getter for the gate).
//
// The gate (incoming-dispatcher.safetyCheck) reads isThreadAllowedCached() —
// which is sync and must never touch the DB. The cache is loaded at startup and
// refreshed on every setThreadAllowed().
//
// Backward compat: entries from env `config.autoReply.allowedThreads` (plain
// threadIds, no type) are also honored (matched against either thread type).
// =============================================================================

import { config } from "../config.js";

export type AllowThreadType = "user" | "group";

export interface AllowedThreadEntry {
  threadId: string;
  threadType: AllowThreadType;
}

export const ALLOWLIST_KEY = "access.allowedThreads";

function keyOf(threadId: string, threadType: AllowThreadType): string {
  return `${threadType}:${threadId}`;
}

// ── Hot in-memory cache (Set of "type:id") ───────────────────────────
let _cache: Set<string> | null = null;

/** Env-seeded plain threadIds (backward compat) — matched against any type. */
function envAllowedIds(): Set<string> {
  return new Set(config.autoReply.allowedThreads ?? []);
}

// ── Persistence layer (injectable for tests) ─────────────────────────
export interface AllowlistStore {
  read(): Promise<AllowedThreadEntry[]>;
  write(entries: AllowedThreadEntry[], actor: string, reason?: string): Promise<void>;
}

class RuntimeSettingAllowlistStore implements AllowlistStore {
  async read(): Promise<AllowedThreadEntry[]> {
    const { prisma } = await import("../db.js");
    const row = await prisma.runtimeSetting.findUnique({ where: { key: ALLOWLIST_KEY } });
    if (!row?.value) return [];
    return parseEntries(row.value);
  }

  async write(entries: AllowedThreadEntry[], actor: string, reason?: string): Promise<void> {
    const { prisma } = await import("../db.js");
    const value = JSON.stringify(entries);
    let oldValue: string | null = null;
    try {
      const existing = await prisma.runtimeSetting.findUnique({ where: { key: ALLOWLIST_KEY } });
      oldValue = existing?.value ?? null;
    } catch {
      /* ignore */
    }
    await prisma.runtimeSetting.upsert({
      where: { key: ALLOWLIST_KEY },
      create: { key: ALLOWLIST_KEY, value, updatedBy: actor },
      update: { value, updatedBy: actor },
    });
    // Audit trail (same convention as runtime-config changes).
    try {
      await prisma.runtimeConfigAudit.create({
        data: {
          key: ALLOWLIST_KEY,
          oldValue: oldValue ?? undefined,
          newValue: value,
          changedBy: actor,
          reason: reason ?? null,
        },
      });
    } catch {
      /* audit failure must not break the update */
    }
  }
}

let store: AllowlistStore = new RuntimeSettingAllowlistStore();

/** Test hook: inject an in-memory store. Pass null to reset to Prisma-backed. */
export function setAllowlistStoreForTest(s: AllowlistStore | null): void {
  store = s ?? new RuntimeSettingAllowlistStore();
  _cache = null;
}

// ── Parse / validate stored JSON ─────────────────────────────────────
export function parseEntries(json: string): AllowedThreadEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: AllowedThreadEntry[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as any).threadId === "string" &&
      ((item as any).threadType === "user" || (item as any).threadType === "group")
    ) {
      out.push({ threadId: (item as any).threadId, threadType: (item as any).threadType });
    }
  }
  return out;
}

function rebuildCache(entries: AllowedThreadEntry[]): void {
  _cache = new Set(entries.map((e) => keyOf(e.threadId, e.threadType)));
}

// ── Public API ───────────────────────────────────────────────────────

/** Load the allowlist cache from the store. Call once at app startup. */
export async function initAllowlist(): Promise<void> {
  try {
    const entries = await store.read();
    rebuildCache(entries);
    console.log(`[allowlist] Initialized: ${entries.length} allowed thread(s)`);
  } catch {
    _cache = new Set();
  }
}

/**
 * Sync gate check — safe for all code paths (no DB). A thread is allowed if it
 * is in the persistent allowlist (type-scoped) OR seeded via env (any type).
 */
export function isThreadAllowedCached(threadId: string, threadType: AllowThreadType): boolean {
  if (!threadId) return false;
  if (_cache?.has(keyOf(threadId, threadType))) return true;
  return envAllowedIds().has(threadId);
}

/** Return the current persistent allowlist entries (reads store). */
export async function getAllowedThreads(): Promise<AllowedThreadEntry[]> {
  return store.read();
}

/** Whether a specific thread is allowed (reads store, authoritative). */
export async function isThreadAllowed(threadId: string, threadType: AllowThreadType): Promise<boolean> {
  const entries = await store.read();
  if (entries.some((e) => e.threadId === threadId && e.threadType === threadType)) return true;
  return envAllowedIds().has(threadId);
}

export interface AllowChange {
  threadId: string;
  threadType: AllowThreadType;
  allowed: boolean;
}

/**
 * Apply a batch of allow/disallow changes. Persists to the store, refreshes the
 * cache, and returns the resulting allowlist. Does NOT send any Zalo message or
 * create an OutboundRecord — pure config mutation.
 */
export async function applyAllowChanges(
  changes: AllowChange[],
  actor = "admin",
  reason?: string,
): Promise<AllowedThreadEntry[]> {
  const current = await store.read();
  const map = new Map(current.map((e) => [keyOf(e.threadId, e.threadType), e] as const));

  for (const c of changes) {
    const k = keyOf(c.threadId, c.threadType);
    if (c.allowed) map.set(k, { threadId: c.threadId, threadType: c.threadType });
    else map.delete(k);
  }

  const next = [...map.values()];
  await store.write(next, actor, reason);
  rebuildCache(next);
  return next;
}
