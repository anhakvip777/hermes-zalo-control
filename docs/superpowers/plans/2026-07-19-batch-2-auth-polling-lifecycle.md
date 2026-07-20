# Batch 2 Auth and Polling Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development for each task. The repository deliberately remains on the existing working tree; do not create a worktree, commit, push, deploy, or change runtime data. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden frontend authentication and operational polling against stale responses, teardown races, timeout misclassification, and post-stop refreshes.

**Architecture:** Keep Fastify/Next.js/Prisma and the existing HTTP Basic contract. Add two small restartable coordinators in the frontend library layer so lifecycle behavior is testable in Vitest's Node environment. Providers become thin React adapters; no DOM test dependency is added.

**Tech Stack:** TypeScript, React 19, Vitest 3, AbortController, existing `adminCredentials` store.

---

### Task 1: Lock the API transport boundary with RED tests

**Files:**

- Modify: `packages/frontend/src/lib/admin-auth.test.ts`
- Modify: `packages/frontend/src/lib/api.ts` (only after RED)

- [x] Add `does not invalidate stored credentials when an explicit Authorization header receives 401`: set a stored credential, call `apiFetch('/api/test', { headers: { Authorization: 'Basic external' } })`, return a 401, assert the explicit header was sent, the error status is 401, and the stored credential is unchanged.
- [x] Add `returns REQUEST_TIMEOUT when the internal 15-second timer aborts`: use fake timers and a fetch promise that rejects when its signal aborts; advance 15 seconds and assert the error code is `REQUEST_TIMEOUT`.
- [x] Add `discards a response when credentials change while response body is pending`: return a Response whose body promise is deferred, change credentials before releasing the body, and assert `STALE_RESPONSE`.
- [x] Run the focused file and confirm the new tests fail for the intended reasons (explicit 401 currently clears; timeout currently reports `REQUEST_ABORTED`).
- [x] Implement the smallest fix: capture `storeOwnsAuthorization` before merging headers; clear on 401 only when true; record the first abort cause (caller or timeout); check the abort state after body parsing; preserve existing path/error parsing.
- [x] Re-run the focused file and confirm all tests pass.

Expected transport shape:

```ts
const callerSuppliedAuthorization = headers.has("Authorization");
const storeOwnsAuthorization = !callerSuppliedAuthorization && authorization !== null;
let abortCause: "caller" | "timeout" | null = null;
const abort = (cause: "caller" | "timeout") => {
  if (abortCause === null) abortCause = cause;
  controller.abort();
};
const timeout = setTimeout(() => abort("timeout"), 15_000);
// ... after readResponseBody(response):
if (controller.signal.aborted) throw abortError(abortCause);
if (response.status === 401 && !skipAuthInvalidation && storeOwnsAuthorization) {
  adminCredentials.clear(generation);
}
```

### Task 2: Add the auth-session coordinator with RED/GREEN tests

**Files:**

- Create: `packages/frontend/src/lib/auth-session-coordinator.ts`
- Create: `packages/frontend/src/lib/auth-session-coordinator.test.ts`
- Modify: `packages/frontend/src/components/auth-provider.tsx`

- [x] Write tests first for: latest attempt aborts the previous attempt; only the active generation is current; `clearIfCurrent` cannot clear a newer attempt; `cancel` aborts and clears the store; `finish` for an old attempt cannot release a newer attempt; a new attempt works after cancel.
- [x] Run the new test file and confirm it fails for the intended ownership and stale-generation cases.
- [x] Implement `createAuthSessionCoordinator(store)` with this public interface and no React dependency:

```ts
export interface AuthAttempt {
  id: number;
  generation: number;
  candidate: string;
  controller: AbortController;
}

export interface AuthSessionCoordinator {
  begin(username: string, password: string): AuthAttempt;
  isCurrent(attempt: AuthAttempt): boolean;
  clearIfCurrent(attempt: AuthAttempt): boolean;
  finish(attempt: AuthAttempt): void;
  cancel(): void;
}
```

`begin` must abort the prior attempt, call `store.set`, and capture the new generation. `isCurrent` compares attempt id, attempt generation, and the live store generation; `clearIfCurrent` delegates to `store.clear(generation)` only for the active attempt. `cancel` aborts the active controller, drops it, and clears only the coordinator-owned expected generation; it must be idempotent and restartable.

- [x] Replace `attemptRef`, `probeControllerRef`, direct `adminCredentials.set`, and direct cleanup logic in `AuthProvider` with one coordinator ref. Keep the existing response validation and messages. Treat only `REQUEST_ABORTED`/`STALE_RESPONSE` as silent cancellation; treat `REQUEST_TIMEOUT` as unavailable.
- [x] Make both logout and effect cleanup call `coordinator.cancel()` before setting unauthenticated state.
- [x] Run coordinator and auth transport tests; confirm GREEN before touching polling.

### Task 3: Add the operational polling coordinator with RED/GREEN tests

**Files:**

- Create: `packages/frontend/src/lib/operational-status-coordinator.ts`
- Create: `packages/frontend/src/lib/operational-status-coordinator.test.ts`
- Modify: `packages/frontend/src/components/operational-status-provider.tsx`

- [x] Write tests first with deferred promises and Vitest fake timers for: single-flight refresh; no interval overlap while a request is pending; stale response ignored after `stop`; `stop` aborts and clears the timer; a captured refresh is a no-op after stop; `start` is idempotent and restartable; old `finally` cannot clear a newer request.
- [x] Run the new test file and confirm it fails for the intended synchronous/re-entrant lifecycle cases.
- [x] Implement `createOperationalStatusCoordinator<T>({ load, commit, onError, intervalMs })` with `start(): void`, `refresh(): Promise<void>`, and `stop(): void`. Use an epoch/id and controller; defer load until active registration and contain reporting-callback errors; do not add a generic request abstraction or test-only production methods.
- [x] Refactor `OperationalStatusProvider` to create one coordinator ref. Its `load(signal)` must keep the existing `Promise.allSettled` and `readyState`/`unknownState` mapping. Its `commit` must perform the two React state updates. Expose the coordinator's `refresh` and call `start`/`stop` from the effect.
- [x] Confirm endpoint-specific failure still yields one `unknownState` and one `readyState`; do not change API-client contracts.
- [x] Run the coordinator tests and the existing frontend tests; confirm GREEN.

### Task 4: Integrated verification and scoped review

**Files:**

- No additional production files expected.

- [x] Run focused tests with escalated execution only if the sandbox blocks esbuild:

```powershell
npm exec -- vitest run --config ./vitest.config.ts `
  packages/frontend/src/lib/admin-auth.test.ts `
  packages/frontend/src/lib/auth-session-coordinator.test.ts `
  packages/frontend/src/lib/operational-status-coordinator.test.ts
```

- [x] Run `npm run typecheck` and `npm run build`.
- [x] Run root `npm test`; do not treat the existing certificate-path and Node `DEP0190` warnings as test failures, but report them separately.
- [x] Run `git diff --check` and inspect only the Batch 2 paths. Confirm no Prisma schema, migration, `dev.db`, backup, session, `.env`, or live configuration changed.
- [ ] Run a read-only browser wiring check later, if requested, for login, logout, backend-down, and no protected polling after logout. Do not add page-level health polling (`packages/frontend/src/app/page.tsx`) to this batch.

**Completion notes (2026-07-19):**

- Focused Batch 2 tests: 30/30 passed (13 transport, 8 auth coordinator, 9 polling coordinator).
- Workspace typecheck and root build passed; root tests passed with backend 1175, shared 6, and frontend 64 tests.
- `npm run db:guard` returned `HEALTH: PASS`. Certificate-path warnings and Node `DEP0190` were observed and are non-fatal.
- Browser wiring remains intentionally deferred because it was not requested and the existing Vitest environment is Node-only; `app/page.tsx` health polling remains out of scope.

### File handoff

**New files planned:**

- `docs/superpowers/specs/2026-07-19-batch-2-auth-polling-design.md`
- `docs/superpowers/plans/2026-07-19-batch-2-auth-polling-lifecycle.md`
- `packages/frontend/src/lib/auth-session-coordinator.ts`
- `packages/frontend/src/lib/auth-session-coordinator.test.ts`
- `packages/frontend/src/lib/operational-status-coordinator.ts`
- `packages/frontend/src/lib/operational-status-coordinator.test.ts`

**Existing files planned for modification:**

- `packages/frontend/src/lib/api.ts`
- `packages/frontend/src/lib/admin-auth.test.ts`
- `packages/frontend/src/components/auth-provider.tsx`
- `packages/frontend/src/components/operational-status-provider.tsx`

No commit is planned unless separately requested.
