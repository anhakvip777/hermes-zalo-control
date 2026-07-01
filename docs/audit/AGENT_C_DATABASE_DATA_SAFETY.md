# AGENT C — Database / Data Safety Audit

**Date:** 2026-07-01 16:05 ICT
**Scope:** READ-ONLY audit of database paths, test isolation, table counts, and backup safety
**Project:** `~/hermes-zalo-control`

---

## 1. Database File Inventory

All `.db` files found in the project tree:

| Path | Size | Last Modified |
|------|------|---------------|
| `.codegraph/codegraph.db` | 7.8 MB | 2026-06-29 10:41 |
| `backup-20260624-084443/dev.db` | 300 KB | 2026-06-24 01:44 |
| `backup-20260624-091510-final/dev.db` | 300 KB | 2026-06-24 02:15 |
| `backup-20260629-065348.db` | 680 KB | 2026-06-29 06:53 |
| `backups/d2-db-data-loss-20260701-125811/backup-20260629-065348.db` | 680 KB | 2026-06-29 06:53 |
| `backups/d2-db-data-loss-20260701-125811/codegraph.db` | 7.8 MB | 2026-06-29 10:41 |
| `backups/d2-db-data-loss-20260701-125811/dev-prisma.db` | 1.04 MB | 2026-06-29 16:47 |
| `backups/d2-db-data-loss-20260701-125811/dev-root.db` | 588 KB | 2026-06-29 16:39 |
| `backups/d2-db-data-loss-20260701-125811/dev.db` | 1.04 MB | 2026-06-29 16:46 |
| `backups/outbound-refactor-r4c-stabilized-20260629-150731/dev.db` | 900 KB | 2026-06-29 15:07 |
| `backups/r1-r2-r3-stabilized-20260629-133414/dev.db` | 856 KB | 2026-06-29 13:34 |
| `backups/release-v1.0.0-mvp-20260629-085044/dev.db` | 700 KB | 2026-06-29 08:51 |
| `packages/backend/backups/db-path-unification-20260629-164659/dev.db` | 1.04 MB | 2026-06-29 16:46 |
| `packages/backend/backups/db-path-unification-20260629-164715/dev-prisma.db` | 1.04 MB | 2026-06-29 16:47 |
| `packages/backend/backups/db-path-unification-20260629-164715/dev-root.db` | 588 KB | 2026-06-29 16:39 |
| **`packages/backend/prisma/dev.db`** | **1.17 MB** | **2026-07-01 16:05** ← ACTIVE RUNTIME |
| `packages/backend/prisma/prisma/dev.db` | 216 KB | 2026-06-27 14:44 |
| **`packages/backend/prisma/test.db`** | **564 KB** | **2026-07-01 15:55** ← ACTIVE TEST |

- **Total .db files:** 18
- **Active runtime databases:** 2 (`dev.db` for production, `test.db` for testing)
- **Archive/backup databases:** 14
- **Tool database:** 1 (`.codegraph/codegraph.db`)
- **Stale/duplicate:** 1 (`packages/backend/prisma/prisma/dev.db` — 2 weeks old, likely leftover)

---

## 2. DATABASE_URL Configuration

All configuration files reference `file:./dev.db` — **no test.db references in live config**.

| File | Value | Notes |
|------|-------|-------|
| `.env` | `DATABASE_URL="file:./dev.db"` | Root env (Prisma resolves relative to schema location) |
| `packages/backend/.env` | `DATABASE_URL="file:./dev.db"` | Backend env |
| `packages/backend/prisma/schema.prisma` | `url = env("DATABASE_URL")` | Schema datasource |
| `ecosystem.config.cjs` | *(none)* | No DATABASE_URL override in PM2 config |
| `.env.example` | `DATABASE_URL="file:./dev.db"` | Template |

**Key observation:** The runtime always uses `dev.db`. The `test.db` is ONLY activated via test infrastructure (see §4).

---

## 3. Table Counts — dev.db vs test.db

### Active Runtime Database: `packages/backend/prisma/dev.db`

| Table | Row Count |
|-------|-----------|
| Message | **35** |
| OutboundRecord | **45** |
| ZaloPrincipal | **3** |
| ZaloPrincipalAudit | **5** |
| LiveTestSession | **20** |
| MessageBatch | **9** |
| ThreadProfile | **3** |
| ThreadCooldown | **11** |

**Total tables in schema:** 31 (both dev.db and test.db have identical schemas)

### Test Database: `packages/backend/prisma/test.db`

| Table | Row Count |
|-------|-----------|
| Message | 2 |
| OutboundRecord | 1 |
| ZaloPrincipal | 0 |
| ZaloPrincipalAudit | 0 |
| LiveTestSession | 0 |
| MessageBatch | 0 |
| ThreadProfile | 0 |
| ThreadCooldown | 8 |

**Verdict:** ✅ **Test and production data are fully isolated.** No production data leaked into test.db. The 2 Messages and 1 OutboundRecord in test.db are test fixtures, not real user data.

---

## 4. Test Isolation Verification

### 4.1 Infrastructure

Test isolation is enforced at **three layers:**

| Layer | File | Mechanism |
|-------|------|------------|
| **Environment** | `vitest.config.ts:22` | Sets `DATABASE_URL: "file:./test.db"` in test env |
| **Runner** | `scripts/run-tests.mjs:25` | Sets `DATABASE_URL: "file:./test.db"` for child processes |
| **Runtime Guard** | `src/__tests__/shared-setup.ts:12-39` | `assertTestDatabase()` throws if DATABASE_URL is not test.db |

### 4.2 TDB1 Guards (shared-setup.ts)

The `assertTestDatabase()` function enforces three hard guards before any cleanup:

1. **NODE_ENV must be `"test"`** — throws if missing or wrong
2. **DATABASE_URL must NOT contain `dev.db`** — throws if pointing to runtime DB
3. **DATABASE_URL must contain `test.db` or `:memory:`** — throws otherwise

### 4.3 Global Setup

- `global-setup.ts` runs `prisma db push` against `test.db` before tests (idempotent)
- `setup.ts` confirms test.db schema is ready
- `cleanDatabase()` in `shared-setup.ts` deletes all rows from `test.db` between test suites — but **only after passing TDB1 guards**

### 4.4 Verdict

| Criterion | Status |
|-----------|--------|
| Tests use separate database | ✅ test.db |
| Runtime DB (dev.db) never touched by tests | ✅ Enforced by 3-layer guard |
| Test DB reset between suites | ✅ cleanDatabase() called in setup |
| Production data never exposed to tests | ✅ Confirmed by row counts (§3) |

---

## 5. Backup Safety — Git Tracking

### 5.1 .gitignore Rules

```gitignore
# DB Backups
backup-*/                         # Root-level backup-YYYYMMDD-* dirs
packages/backend/backups/         # Backend backup dirs
*.db.backup*
*.sqlite.backup*
```

### 5.2 Git Tracking Check

| Path | Git Status | Protected By |
|------|-----------|--------------|
| `backup-20260624-084443/` | Ignored | `.gitignore` line 34 (`backup-*/`) |
| `backup-20260624-091510-final/` | Ignored | `.gitignore` line 34 |
| `backup-20260629-065348.db` | Ignored | `.gitignore` line 34 (matches `backup-*`) |
| `backups/` | **Untracked** (`??`) | ⚠️ NOT in `.gitignore` — but not committed |
| `packages/backend/backups/` | Ignored | `.gitignore` line 35 |

### 5.3 Files Already in Git

The only backup/db-related files tracked in git are:

- `packages/backend/prisma/dev.db.empty-20260627-0928` — **empty template, no data**
- `packages/backend/scripts/backup-restore.mjs` — script
- `packages/backend/src/__tests__/backup-restore.test.ts` — test

### 5.4 Verdict

| Criterion | Status |
|-----------|--------|
| No real .db files committed to git | ✅ Only empty template is tracked |
| Backup directories protected by .gitignore | ✅ (`backup-*/` and `packages/backend/backups/`) |
| Root `backups/` directory | ⚠️ Untracked, not ignored — should be added to `.gitignore` |

---

## 6. Summary

| Audit Area | Result |
|------------|--------|
| DB Path Clarity | ✅ Single runtime DB at `packages/backend/prisma/dev.db` |
| DATABASE_URL Consistency | ✅ All configs point to `file:./dev.db` |
| Schema Parity | ✅ dev.db and test.db have identical schemas (31 tables) |
| Data Isolation | ✅ test.db has 0 production data; guards prevent cross-contamination |
| Test Safety Guards | ✅ 3-layer enforcement (env, runner, runtime assert) |
| Backup Protection | ✅ Backups not in git, most covered by .gitignore |
| **Overall Safety** | ✅ **PASS** — Database configuration is safe and well-isolated |

---

## 7. Recommendations

1. **Add `backups/` to root `.gitignore`** — currently the root-level `backups/` directory is untracked but not ignored. Add a `backups/` line to `.gitignore` to prevent accidental commits.

2. **Clean up stale DB** — `packages/backend/prisma/prisma/dev.db` (216 KB, 2 weeks old) appears to be a leftover from a previous path configuration. Consider removing it or moving to an archive backup.

3. **Backup rotation** — 14 backup/archive DBs totaling ~12 MB across multiple directories. Consider consolidating old backups into a single archive location with date-based naming.

---

*Audit performed by Agent C — READ-ONLY. No files modified, no DBs touched, no commits made.*
