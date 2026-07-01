# D2 DB Data Loss Incident Report

**Status**: ROOT CAUSE FOUND → FIXED  
**Severity**: CRITICAL  
**Date**: 2026-07-01  
**Batch**: TDB1 — Test Database Isolation

---

## Summary

Runtime pilot data (Messages, OutboundRecords, ZaloPrincipals) was wiped because backend tests shared the same SQLite database as the running app. The test helper `cleanDatabase()` in `shared-setup.ts` used the production Prisma client with no test DB isolation.

## Root Cause

`cleanDatabase()` in `packages/backend/src/__tests__/shared-setup.ts` imports the production `PrismaClient` from `../db.js`. When `npm test` ran, any test file calling `cleanDatabase()` executed `prisma.message.deleteMany()`, `prisma.outboundRecord.deleteMany()`, etc. against the runtime database `packages/backend/prisma/dev.db`.

No separate test database existed — Vitest config had no `DATABASE_URL` override, no `globalSetup` to create an isolated DB.

### Mechanism

```
npm test
  → vitest runs test files
  → test file calls cleanDatabase()
  → cleanDatabase() imports prisma from db.js (production client)
  → deleteMany() on Message, OutboundRecord, MessageBatch, ZaloPrincipal
  → ALL production data in those tables wiped
```

### Evidence — Survival Pattern Match

| Table | In cleanDatabase()? | Survived? | Match |
|-------|---------------------|-----------|-------|
| Message | ✅ YES | ❌ WIPED | ✓ |
| OutboundRecord | ✅ YES | ❌ WIPED | ✓ |
| MessageBatch | ✅ YES | ❌ WIPED | ✓ |
| ZaloPrincipal | ✅ YES | ❌ WIPED | ✓ |
| ZaloPrincipalAudit | ✅ YES | ❌ WIPED | ✓ |
| ThreadProfile | ✅ YES | ❌ WIPED | ✓ |
| LiveTestSession | ❌ NO | ✅ SURVIVED | ✓ |
| ThreadCooldown | ❌ NO | ✅ SURVIVED | ✓ |
| RuntimeSetting | ❌ NO | ✅ SURVIVED | ✓ |
| RuntimeConfigAudit | ❌ NO | ✅ SURVIVED | ✓ |

**10/10 tables match the cleanDatabase() touch pattern exactly.**

## Affected Tables

- **Message** — from 30+ to 2 (only 2 new rows written after wipe)
- **OutboundRecord** — from 7+ to 1 (only 1 new row after wipe)
- **ZaloPrincipal** — from 3 to 0 (recreated manually post-incident)
- **MessageBatch** — from 100+ to 1
- **ZaloPrincipalAudit** — wiped
- **ThreadProfile** — wiped

## Not Root Cause

- ❌ PM2 restart alone — restart doesn't wipe DB
- ❌ Prisma db push — only additive schema changes, no table drops
- ❌ DB path drift — `prisma` is a symlink, same inode confirmed
- ❌ Session restore failure — unrelated

## Immediate Mitigation (TDB1 Fix Applied)

### 1. Test Database Isolation

- **Test DB**: `packages/backend/prisma/test.db` (separate from `dev.db`)
- **Vitest config**: `env: { NODE_ENV: "test", DATABASE_URL: "file:./test.db" }`
- **Test runner**: `scripts/run-tests.mjs` — spawns `prisma db push`, `assert-test-db.mjs`, and `vitest` with test env vars inheriting to all child processes
- **Test script**: `"test": "node scripts/run-tests.mjs"`

### 2. cleanDatabase() Guard

`assert-test-db.mjs` enforces:
- `NODE_ENV` must be `"test"`
- `DATABASE_URL` must contain `test.db` (not `dev.db`)
- Blocks test run if either condition fails

### 3. Deterministic Test Fix

`allowed-thread-review.test.ts` was depending on runtime data existing in the DB. Fixed by seeding a Message in `beforeAll`.

## Files Changed (TDB1)

```
packages/backend/package.json                              — test script → run-tests.mjs
packages/backend/vitest.config.ts                          — env: test DB override
packages/backend/scripts/run-tests.mjs                     — NEW: controlled test runner
packages/backend/scripts/assert-test-db.mjs                — NEW: DB safety guard
packages/backend/src/__tests__/allowed-thread-review.test.ts — seed data for deterministic test
packages/backend/src/__tests__/shared-setup.ts             — assertTestDatabase() guard
```

## Verification (post-TDB1)

| Check | Result |
|-------|--------|
| Backend tests | 46 files / 788 tests PASS ✅ |
| Typecheck | PASS ✅ |
| Backend build | PASS ✅ |
| Frontend build | PASS ✅ |
| dev.db untouched by tests | ✅ Confirmed — counts stable |
| test.db isolated | ✅ Used exclusively by test suite |

### DB Counts After TDB1

| Table | dev.db (runtime) | test.db |
|-------|-----------------|---------|
| Message | 5 (live traffic) | 1 (seed) |
| OutboundRecord | 10 (live traffic) | 1 |
| ZaloPrincipal | 3 | 0 |
| LiveTestSession | 19 | 0 |

## Recovery Status

- **Pilot 3 data lost** — recent Messages/OutboundRecords from Pilot 3 testing are unrecoverable (no backup captured them)
- **ZaloPrincipal** — recreated manually
- **Historical data** — best backup from Jun 29 has 563 OutboundRecords, 438 MessageBatches, but NO ZaloPrincipal (table added later)
- **LiveTestSessions** — survived (not in cleanDatabase())

## Lessons Learned

1. Test suites MUST use isolated databases — never share production DB
2. `cleanDatabase()` functions need hard guards (env check + DB name check)
3. Pre-commit test runs can wipe production data silently
4. Shell env vars don't survive `&&` chains — use Node script runners
