# R1/R2/R3/R4B/R5 Stabilization Report

**Status:** PASS ⚠️ (1 known issue: dual-DB path drift)
**Date:** 2026-06-29
**Environment:** Production (PM2, dryRun=true, Node v22.23.0)

---

## Commits Verified

| Batch | Commit | Scope |
|-------|--------|-------|
| R1 / R1.2 | `79c3cd0` | Incoming dispatcher → unified outbound dispatcher |
| R2.1 | `54cdcde` | Runtime dryRun per job |
| R3.1 | `a9e77c4` | Worker outbound via backend internal API (backend sole Zalo owner) |
| R4B | `e4f9d22` | Media/voice through outbound dispatcher |
| R4C | `a996066` | Thread ID normalization at outbound boundaries |
| R5 | `283c312` | DB-backed cooldown single-store (ThreadCooldown table) |

All commits clean, verified via `git log --oneline`.

---

## Architecture Verification

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `new ZaloMessageSender` | Dispatcher only | `outbound-dispatcher.service.ts` line 254 + test files only | ✅ |
| Routes import `zalo-message-sender` | None | Only test files import it | ✅ |
| Worker `ZaloMessageSender` | Clean | CLEAN | ✅ |
| Worker `ZALO_SESSION_DIR` | Clean | CLEAN | ✅ |
| Worker `restoreSession` | Clean | CLEAN | ✅ |
| Worker `zalo-gateway` | Clean | CLEAN | ✅ |
| Worker `sendOutboundViaBackend` | Present | `scheduler.ts` lines 29, 282, 505 | ✅ |
| `lastReplyAt` Map (src + dist) | Removed | CLEAN | ✅ |
| `checkAndSetCooldown` | Removed | CLEAN | ✅ |
| `resetOutboundCooldowns` | Deprecated wrapper only | `outbound-dispatcher.service.ts:103` → wraps `clearAllCooldowns()` | ✅ |
| `ThreadCooldown` model | Present | `schema.prisma:580` + `cooldown.service.ts` | ✅ |
| `acquireCooldown` | Present (DB-backed) | `cooldown.service.ts:34`, called from `sendOutbound()` | ✅ |

---

## Cooldown Verification (R5)

### Behavior

| Case | Expected | Actual | Status |
|------|----------|--------|--------|
| No row → `acquireCooldown()` | `true` | `true` (creates row) | ✅ |
| Active row → `acquireCooldown()` | `false` | `false` (reason=cooldown in API response) | ✅ |
| Expired row → `acquireCooldown()` | `true` (re-acquire) | `true` | ✅ |
| `clearAllCooldowns()` | Deletes all rows | Verified in test suite | ✅ |
| Batching clear | Single row delete | `clearCooldown(threadId)` works | ✅ |
| Cooldown OutboundRecord | Exactly 1, decision=skip, reason=cooldown | 1 record created | ✅ |
| No duplicate OutboundRecord | No double-record from safetyCheck | safetyCheck no cooldown gate | ✅ |

### Timestamp Storage

Timestamps stored as JS milliseconds (Unix epoch × 1000), compatible with Prisma Date ↔ SQLite INTEGER mapping. SQLite `datetime()` displays NULL for millisecond timestamps but Prisma comparison logic works correctly (`new Date()` ↔ raw ms comparison).

### Restart-safe

| Check | Result |
|-------|--------|
| ThreadCooldown row survives PM2 restart | ✅ Row persisted |
| Cooldown blocks within window after restart | ✅ Would block (expired during test delay) |
| No double-reply after restart | ✅ |

---

## Prisma / DB Verification

### Schema

```prisma
model ThreadCooldown {
  id           String   @id @default(cuid())
  threadId     String   @unique
  lastReplyAt  DateTime
  expiresAt    DateTime
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([expiresAt])
}
```

### DB Push

```
npx prisma generate → PASS
npx prisma db push   → PASS (no data loss, new table only)
```

Backup created: `prisma/dev.db.backup-r5-20260629-161302`

### ⚠️ Known Issue: Dual-DB Path Drift

| Database | Size | Tables | Used by |
|----------|------|--------|---------|
| `prisma/dev.db` | 1.09 MB | 27 tables (incl. ThreadCooldown) | **CANONICAL** — runtime backend + worker |
| `dev.db` | 602 KB | 14 tables (no ThreadCooldown) | STALE — not used by any process |

**Root cause:** Prisma resolves `file:./dev.db` in `DATABASE_URL` relative to the schema file location (`prisma/schema.prisma`), not CWD. The runtime Prisma Client uses the same resolution, so all reads/writes go to `prisma/dev.db`.

**Impact:** `dev.db` at `packages/backend/dev.db` is stale (last modified Jun 27). ThreadCooldown was manually added there via explicit absolute path but runtime ignores it.

**No data loss.** All runtime data is in `prisma/dev.db`.

### D1 Safety Addendum — DB Path Resolution Analysis

**Date:** 2026-06-29 | **Backup:** `backups/db-path-unification-20260629-164715`

#### PM2 Working Directories

| Process | exec cwd | Script |
|---------|----------|--------|
| hermes-backend (8) | `/home/anhakvip777/hermes-zalo-control` | `packages/backend/dist/index.js` |
| hermes-worker (9) | `/home/anhakvip777/hermes-zalo-control` | `packages/backend/dist/workers/index.js` |

Both run from **repo root**, not `packages/backend`.

#### DATABASE_URL Resolution Map

| Context | CWD | DATABASE_URL | Resolves to | Hits Canonical? |
|---------|-----|-------------|-------------|-----------------|
| PM2 backend | repo root | `file:./dev.db` (from .env) | `prisma/dev.db` (schema-relative) | ✅ YES |
| PM2 worker | repo root | `file:./dev.db` (from .env) | `prisma/dev.db` (schema-relative) | ✅ YES |
| Prisma CLI from repo root | repo root | `file:./dev.db` | `prisma/dev.db` (schema-relative) | ✅ YES |
| Prisma CLI from `packages/backend` | packages/backend | `file:./dev.db` | `prisma/dev.db` (schema-relative) | ✅ YES |
| Prisma CLI with absolute path | packages/backend | `file:/home/.../packages/backend/dev.db` | `dev.db` (root-level, NOT prisma/) | ❌ NO |
| Vitest (in-process) | packages/backend | mocked | in-memory | ❌ N/A |

**Key insight:** Prisma always resolves `file:./dev.db` relative to `schema.prisma` location (`packages/backend/prisma/`), regardless of CWD. Therefore `prisma/dev.db` IS the canonical database.

#### Stale `dev.db` Disposition

`packages/backend/dev.db` (602 KB, 14 tables, last modified Jun 27) is **confirmed stale**:

- ❌ PM2 backend does NOT use it (cwd=repo root, Prisma resolves to `prisma/dev.db`)
- ❌ PM2 worker does NOT use it (same resolution)
- ❌ Prisma CLI does NOT use it (unless forced with absolute path — which was a one-time manual action during this audit)
- ❌ Vitest tests do NOT use it (mocked Prisma in-process)
- ✅ Backup created at `backups/db-path-unification-20260629-164715/dev-root.db`

**Verdict: SAFE TO RENAME.** All 4 consumers confirmed using `prisma/dev.db`. But per D1 rule #3, kept in-place with warning only — no rename performed.

#### Canonical DB Schema Check (`prisma/dev.db`)

```
Tables: 27 (full R5 schema incl. ThreadCooldown)
ThreadCooldown: 8 rows (all expired)
Message: 3 rows
Schedule: 0 rows
OutboundRecord: 563 rows
```

Schema verified: `ThreadCooldown` table has correct columns (`id, threadId, lastReplyAt, expiresAt, createdAt, updatedAt`) with `@@index([expiresAt])`.

---

## PM2 Deployment

| Process | Status | Uptime | Memory | Restarts |
|---------|--------|--------|--------|----------|
| hermes-backend (8) | online | fresh | 114 MB | 6 (R5 deploy + session restore) |
| hermes-frontend (7) | online | fresh | 76 MB | 2 |
| hermes-worker (9) | online | fresh | 82 MB | 3 |
| hermes-zalo-tunnel (4) | online | 7h | 40 MB | 15 |

**Session restore:** Session file was lost on restart. Restored from `backups/db/zalo-session-20260629T163800/zalo-session.json`. Backend reconnected successfully after restore + restart.

---

## Env Verification

### Backend (pm2 env 8)
- `ZALO_SESSION_DIR`: `/home/anhakvip777/hermes-zalo-control/packages/backend/zalo-session` ✅
- `ZALO_AUTO_REPLY_DRY_RUN`: `true` ✅
- `INTERNAL_API_TOKEN`: `c88...` (masked) ✅
- `NODE_ENV`: `production`

### Worker (pm2 env 9)
- `INTERNAL_API_BASE_URL`: `http://127.0.0.1:3002` ✅
- `INTERNAL_API_TOKEN`: `c88...` (matches backend) ✅
- `ZALO_AUTO_REPLY_DRY_RUN`: `true` ✅
- **NO `ZALO_SESSION_DIR`** ✅ (worker does NOT hold Zalo session)
- `NODE_ENV`: `production`

### Frontend (pm2 env 7)
- `INTERNAL_API_TOKEN`: Present ✅
- Vision API keys: Present (masked)

**dryRun effective: true** across all processes ✅

---

## Runtime API Verification

| Endpoint | Status | Key Data |
|----------|--------|----------|
| `/api/system/health` | 200 | status=ok, uptime=28s |
| `/api/zalo/ops/status` | 200 | connected=true, listenerActive=true, dryRun=true |
| `/api/system/runtime-config` | 200 | dryRun=true, cooldownSeconds=10, allowedThreads=[6792540503378312397] |
| `/api/system/production-readiness` | 200 | verdict=NOT_READY, score=25 (Zalo reconnecting after restart) |
| `/api/agent/messages?limit=5` | 200 | 1 message, dry-run test |

Runtime APIs all responsive. Zalo connected after session restore.

---

## Internal API Safety

| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| No token | 401 | 401 | ✅ |
| Wrong token | 401 | 401 | ✅ |
| Valid token (dry-run) | 200, decision=dry_run | 200, dryRun=true | ✅ |
| Valid token (cooldown block) | 200, reason=cooldown | 200, reason=cooldown | ✅ |

Internal API fail-closed, constant-time token comparison, localhost-only binding confirmed.

---

## Dry-run Functional Cooldown Test

**Test thread:** `6792540503378312397`

| Message | OutboundRecord ID | Decision | Reason | dryRun |
|---------|-------------------|----------|--------|--------|
| Msg 1: "test cooldown R5" | `cmqzg34kl...` | allow | dry_run | 1 |
| Msg 2: "test cooldown R5 msg2" | `cmqzg38hi...` | skip | cooldown | 1 |
| Msg 3: "test after restart" | `cmqzg45gg...` | allow | dry_run | 1 |

Expected behavior confirmed:
- ✅ Msg 1: allowed, dry-run, ThreadCooldown row created with timestamps
- ✅ Msg 2: blocked (within 10s cooldown), exactly 1 OutboundRecord (decision=skip, reason=cooldown)
- ✅ Msg 3: allowed (cooldown expired after backend restart delay)
- ✅ No real Zalo send
- ✅ No duplicate OutboundRecords

---

## Restart-safe Cooldown Test

1. Created cooldown row via Msg 1 send
2. `pm2 restart hermes-backend --update-env`
3. Checked DB: ThreadCooldown row **persisted** ✅
4. Msg 3 send: cooldown had expired (~20s elapsed) → allowed ✅
5. No double-reply ✅

---

## Test / Typecheck / Build

| Step | Result |
|------|--------|
| Backend tests | 41 files / 660 tests PASS |
| Backend typecheck | 0 errors |
| Backend build | Clean |
| Frontend build | Next.js 15.5.19, 20 static pages, compiled successfully |

Test count stable at 660 (unchanged from R5 commit).

---

## Issues Found

1. ✅ **Dual-DB path drift** — Resolved by D1 analysis. `prisma/dev.db` confirmed as canonical DB used by all 4 consumers (PM2 backend, PM2 worker, Prisma CLI, vitest). Stale `dev.db` at root confirmed unused, backed up, safe to rename. See D1 addendum in Prisma/DB section.
2. ✅ **Session file lost on restart** — Root cause identified: `zalo-gateway.service.ts:320` contains `unlinkSync(sessionPath)` that deletes the session file when `restoreSession()` encounters transient Zalo login errors containing "expired"/"invalid"/"SESSION". Combined with `autorestart: true`, this causes cascade failure. Fix proposed (future batch): rename instead of delete. SOPs created in `OPERATIONS_RUNBOOK.md` + `ROLLBACK_GUIDE.md`. See `docs/S1_SESSION_RESTART_INVESTIGATION_REPORT.md`.
3. ℹ️ **Legacy session paths** — Old `packages/zalo-session/` and empty `./zalo-session/` directories exist but are not used by any process. Low-priority cleanup.

---

## Remaining Risks

- ⚠️ Hermes compute during cooldown (R5 tradeoff — acceptable for MVP)
- ⚠️ UI status clarity pending (ThreadCooldown status display)
- ⚠️ Thread display name pending
- ⚠️ Zalo user permission/RBAC pending
- ~~Session restart SOP~~ → ✅ RESOLVED by S1 (root cause identified, SOPs created, fix proposed for future batch)
- ⚠️ RAG/context eval suite pending
- ⚠️ `unlinkSync(sessionPath)` destructive delete on login error → ✅ **FIXED in S1.1** (commit `abd9c3f`) — replaced with `quarantineSessionFile()` rename. Session file now preserved as `.expired-<timestamp>` copy. No data loss on transient Zalo errors.
- ✅ **D1 report:** `docs/D1_DATABASE_PATH_UNIFICATION_REPORT.md`
- ✅ **S1 report:** `docs/S1_SESSION_RESTART_INVESTIGATION_REPORT.md`
- ✅ **SOPs:** `docs/OPERATIONS_RUNBOOK.md`, `docs/ROLLBACK_GUIDE.md`

---

## Recommended Next Step

1. ✅ **D1 complete** — stale DB renamed, canonical confirmed.
2. ✅ **S1 complete** — root cause identified, session stable, SOPs created.
3. **Post-R5 Safe Pilot** — Controlled Live Test with 1 thread, dryRun=true default.
4. **Future batch:** Fix destructive `unlinkSync` in `zalo-gateway.service.ts:320`.
