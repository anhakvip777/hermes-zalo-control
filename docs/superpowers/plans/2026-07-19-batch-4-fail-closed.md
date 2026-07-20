# Batch 4 Fail-Closed Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the remaining dashboard status pages truthful under backend failure and make strict config checking portable on Windows.

**Architecture:** Reuse `RemoteDataState` and `apiFetch`; keep page state read-only and fail-closed. Remove the dashboard's Test Alert mutation wiring while leaving unrelated backend alert internals unchanged. Wrap strict config execution in a Node child-process shim rather than relying on shell syntax.

**Tech Stack:** Next.js/React/TypeScript, Vitest, Fastify backend, Node.js child process wrapper.

---

### Task 1: Lock the error-dashboard seam with RED tests

**Files:**
- Modify: `packages/frontend/src/lib/api-client.test.ts`
- Modify: `packages/frontend/src/lib/dashboard-state.test.ts`

- [x] Add a malformed/incomplete `ErrorSummaryResponse` fixture and assert `getErrorSummary()` rejects with `INVALID_RESPONSE`.
- [x] Add a state assertion that `unknownState()` returns `data: null` and never represents a zero/green summary.
- [x] Run the two focused files and record the intended RED failure before changing page code.

### Task 2: Make `/errors` read-only and fail-closed

**Files:**
- Modify: `packages/frontend/src/app/errors/page.tsx`
- Modify: `packages/frontend/src/lib/api-client.ts`

- [x] Remove `triggerTestAlert` import, button, handler, and client mutation helper.
- [x] Replace nullable `data` state with `RemoteDataState<ErrorSummaryResponse>` and use an AbortController plus single-flight guard for refresh.
- [x] Render explicit loading/unknown/ready branches; only ready data may render status, totals, groups, or “no errors” success text.
- [x] Run the focused frontend tests and typecheck.

### Task 3: Lock and fix `/system-health`

**Files:**
- Modify: `packages/frontend/src/lib/api-client.ts`
- Modify: `packages/frontend/src/lib/api-client.test.ts`
- Modify: `packages/frontend/src/app/system-health/page.tsx`

- [x] Extend health/config/heartbeat validation to reject missing required nested fields and malformed counters/timestamps.
- [x] Replace `getConfigCheck().catch(() => null)` and heartbeat silent catch with explicit remote states.
- [x] Add AbortController/single-flight refresh and render unknown sections without safe-looking defaults.
- [x] Run focused frontend tests and confirm the new malformed fixtures fail before the implementation and pass afterward.

### Task 4: Portable strict config command

**Files:**
- Create: `packages/backend/scripts/config-check-strict.mjs`
- Modify: `packages/backend/package.json`

- [x] Add a Node wrapper that sets `STRICT_CONFIG_CHECK=true`, invokes the local `tsx` executable with `src/config-consistency.ts`, forwards stdio, and exits with the child status.
- [x] Replace the POSIX-only npm script with the wrapper command.
- [x] Run `npm run config:check:strict -w packages/backend` from PowerShell and verify exit `0` with no live/DB mutation.

### Task 5: Integrated verification and safety audit

**Files:**
- No schema, migration, runtime DB, session, backup, secret, or live config edits.

- [x] Run `git diff --check`, focused frontend tests, full backend tests through the isolated runner, all-package typecheck, backend/frontend builds, `db:guard`, and strict config check.
- [x] Run isolated backend-up smoke and record source DB hashes before/after.
- [x] Run fresh authenticated Browser QA with isolated backend-up, backend-down, and malformed-response scenarios; no unapproved browser was substituted.
- [x] Remove only temporary artifacts created by this batch and inspect the final diff/status.
- [x] Update `HANDOVER.md` with current evidence and remaining blockers; do not commit or push without separate approval.
