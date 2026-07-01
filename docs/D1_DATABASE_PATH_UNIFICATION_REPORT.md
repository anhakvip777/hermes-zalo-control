# D1 — Database Path Unification Report

**Status:** ✅ PASS
**Date:** 2026-06-29

---

## Background

R1/R2/R3/R4B/R5 Stabilization audit discovered dual `dev.db` files:
- `prisma/dev.db` (1.09 MB, 27 tables) — canonical, used by all runtime consumers
- `dev.db` (602 KB, 14 tables) — stale, not used by any process

Root cause: Prisma resolves `file:./dev.db` in `DATABASE_URL` relative to `schema.prisma` location (`packages/backend/prisma/`), not CWD. The stale `dev.db` was a historical artifact from before this resolution behavior was understood.

## D1 Safety Addendum — DB Path Resolution

### PM2 Working Directories

| Process | exec cwd |
|---------|----------|
| hermes-backend (8) | `/home/anhakvip777/hermes-zalo-control` |
| hermes-worker (9) | `/home/anhakvip777/hermes-zalo-control` |

Both run from **repo root**.

### DATABASE_URL Resolution Map

| Consumer | DATABASE_URL | Resolves to | Status |
|----------|-------------|-------------|--------|
| PM2 backend | `file:./dev.db` | `prisma/dev.db` (schema-relative) | ✅ Canonical |
| PM2 worker | `file:./dev.db` | `prisma/dev.db` (schema-relative) | ✅ Canonical |
| Prisma CLI | `file:./dev.db` | `prisma/dev.db` (schema-relative) | ✅ Canonical |
| Vitest | N/A | in-memory mock | ✅ N/A |
| Stale `dev.db` | N/A | N/A | ❌ No consumer |

### Stale DB Disposition

| Check | Result |
|-------|--------|
| PM2 backend uses it? | ❌ No |
| PM2 worker uses it? | ❌ No |
| Prisma CLI uses it? | ❌ No |
| Vitest uses it? | ❌ No |
| Backup created? | ✅ `backups/db-path-unification-20260629-164715/` |

**Verdict: SAFE TO RENAME** — approved by user.

## Execution

### Rename

```bash
cd packages/backend
mv dev.db dev.db.stale-20260629-164912
```

| File | Size | Status |
|------|------|--------|
| `dev.db.stale-20260629-164912` | 588 KB | Renamed (stale) |
| `prisma/dev.db` | 1.1 MB | Canonical (unchanged) |
| New `dev.db` | N/A | NOT recreated ✅ |

### PM2 Restart

```
pm2 restart hermes-backend --update-env   → online ✅
pm2 restart hermes-worker --update-env    → online ✅
```

### Post-Restart Verification

| Check | Result |
|-------|--------|
| Health API | `{"status":"ok"}` ✅ |
| Runtime config | dryRun=true, cooldown=10s ✅ |
| Zalo connection | connected=true, listener=true ✅ |
| Canonical DB: ThreadCooldown | 8 rows ✅ |
| Canonical DB: OutboundRecord | 563 rows (pre-existing) ✅ |
| Canonical DB: Message | 3 rows ✅ |
| New `dev.db` recreated? | No ✅ |
| Cooldown: msg1 allow | `{"reason":"dry_run"}` ✅ |
| Cooldown: msg2 block | `{"reason":"cooldown"}` ✅ |
| Cooldown: ThreadCooldown ACTIVE | lastReplyAt + expiresAt set correctly ✅ |

## Issues

None.

## Next Steps

1. ✅ D1 complete — stale DB renamed, canonical confirmed
2. Proceed to S1 — Session Restart SOP / Session Loss Investigation
3. Không mở Controlled Live Test vội
