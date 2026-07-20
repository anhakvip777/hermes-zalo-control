# Batch 1 Safety Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the five dashboard-remediation Batch 1 blockers and make their verification unable to mutate runtime database, backup, or Zalo session state.

**Architecture:** Keep the existing Fastify/Next.js/Prisma architecture and schema unchanged. Tighten only route boundaries and frontend runtime validators, and inject explicit test-only filesystem paths into existing scripts so tests operate exclusively below fresh temporary roots.

**Tech Stack:** Node.js 22, TypeScript, Fastify, Vitest, Prisma SQLite, Next.js.

---

### Task 1: Isolate backend test state before any mutation

**Files:**
- Modify: `packages/backend/src/__tests__/backup-restore.test.ts`
- Modify: `packages/backend/src/__tests__/db-guard.test.ts`
- Create: `packages/backend/src/__tests__/test-runner-safety.test.ts`
- Modify: `packages/backend/scripts/backup-restore.mjs`
- Modify: `packages/backend/scripts/db-guard.mjs`
- Modify: `packages/backend/scripts/run-tests.mjs`
- Modify: `packages/backend/vitest.config.ts`

- [ ] Replace every operational backup/session path in the two integration tests with paths below `mkdtempSync(join(tmpdir(), "hermes-..."))`; cleanup must target only that generated root.
- [ ] Add RED assertions that `SYSTEM_BACKUP_ROOT`, `DB_BACKUP_DIR`, and `ZALO_SESSION_DIR` are honored and that `assert-test-db` occurs before `prisma db push`.
- [ ] Run only the two focused integration tests plus the runner-safety test and confirm they fail because the scripts still ignore the overrides/order.
- [ ] Resolve relative overrides against the backend package root and absolute overrides as-is; pass fresh temp-root overrides from the backend runner.
- [ ] Re-run the same focused tests and confirm PASS without creating or deleting anything under `packages/backend/backups` or `packages/backend/zalo-session`.

### Task 2: Finish backend Batch 1 boundary validation

**Files:**
- Modify: `packages/backend/src/__tests__/batch1-backend-safety.test.ts`
- Modify: `packages/backend/src/routes/thread-settings.ts`

- [ ] Add RED route tests for an empty patch body and `groupReplyWindowSeconds` outside the signed 32-bit Prisma `Int` range; both must return canonical HTTP 400 and never call the service.
- [ ] Reject bodies with no declared setting field and restrict the numeric field to `0..2147483647`.
- [ ] Re-run the focused Batch 1 backend route/service tests and confirm PASS.

### Task 3: Finish frontend Batch 1 runtime contracts

**Files:**
- Modify: `packages/frontend/src/lib/api-client.test.ts`
- Modify: `packages/frontend/src/lib/api-client.ts`

- [ ] Add RED cases for extra keys at every Zalo status object level, invalid nullable timestamps, negative/fractional counters and ages, and empty allowlist identifiers.
- [ ] Add exact key sets and semantic helpers for the root, session, heartbeats, heartbeat item, and recovery objects while preserving the backend's declared enum values.
- [ ] Re-run `api-client.test.ts` and confirm all contract tests PASS.

### Task 4: Close direct path/error regressions introduced in the Batch 1 plumbing

**Files:**
- Modify: `packages/backend/src/__tests__/system-health.test.ts`
- Modify: `packages/backend/src/services/system-health.service.ts`
- Modify: `packages/backend/src/__tests__/batch1-backend-safety.test.ts`
- Modify: `packages/backend/src/routes/system.ts`

- [ ] Add RED tests proving an explicit unsupported `DATABASE_URL` is reported as unknown/unavailable rather than silently checking `dev.db`, and malformed `dryRun` uses the canonical API error envelope.
- [ ] Implement the smallest fail-closed behavior needed by those tests without changing runtime architecture or the database schema.
- [ ] Re-run only the affected backend tests and confirm PASS.

### Task 5: Verify the integrated Batch 1 change set

**Files:**
- No production edits expected.

- [ ] Record the production `dev.db` SHA-256 and metadata-only snapshots of backup/session paths.
- [ ] Run focused Batch 1 backend and frontend tests through the isolated runner.
- [ ] After Task 1 proves filesystem isolation, run root `npm test`, then compare the production DB hash and backup/session metadata.
- [ ] Run root `npm run typecheck`, `npm run build`, backend `db:guard --status`, and `git diff --check`.
- [ ] Report lint/format baseline failures separately; do not broaden Batch 1 into repository-wide formatting or architecture/schema work.
