# Batch 2 Auth and Polling Lifecycle Design

## Goal

Make the frontend authentication and operational-status lifecycle fail-closed under
out-of-order responses, logout/unmount, timeout, StrictMode effect replay, and
manual refresh calls after teardown. The change must remain frontend-only and must
not alter Prisma, runtime data, live mode, or Zalo behavior.

## Current findings

- `apiFetch` can clear the stored credential after a 401 even when the caller sent
  an explicit `Authorization` header that the credential store does not own.
- `AuthProvider` aborts a pending probe on cleanup but leaves the candidate
  credential in the module-level store. A remount can therefore send an
  unverified credential before a new login.
- `apiFetch` maps its 15-second timeout to `REQUEST_ABORTED`; `AuthProvider` then
  treats a real timeout as a silent user cancellation instead of backend
  unavailable.
- `OperationalStatusProvider` protects active requests, but a captured `refresh`
  callback can start a new request after teardown because the current callback
  does not check the stopped state.
- The existing React test environment is Node-only and has no DOM renderer. The
  lifecycle logic will therefore be moved into two small production coordinators
  with explicit interfaces and tested with real promises, `AbortController`, and
  Vitest fake timers. React components remain thin adapters and receive a final
  browser wiring check later.

## Design

1. `apiFetch` records whether it injected the store-owned Authorization header.
   Only a 401 from a store-owned request may call
   `adminCredentials.clear(generation)`. Generation stale-response checks remain
   in place for every request. Abort provenance records the first cause, so a
   caller abort cannot be relabeled as a timeout if the fetch settles late.
2. `createAuthSessionCoordinator` owns one active login attempt. Beginning a new
   attempt aborts the previous one; the coordinator retains the generation it
   owns and cancellation clears only that expected generation. Stale attempts
   cannot clear or publish state, including during cross-coordinator cleanup.
   The coordinator is restartable so React StrictMode effect replay is safe.
3. `createOperationalStatusCoordinator` owns one in-flight refresh, one interval,
   an epoch/id stale-result guard, and an AbortController. `start` is idempotent,
   `stop` aborts and clears, and a refresh captured before stop becomes a no-op
   after stop. Load invocation is deferred until the active request is registered,
   making synchronous/re-entrant loads safe; errors thrown by the reporting
   callback cannot escape fire-and-forget polling. It can be restarted after stop.
4. `AuthProvider` and `OperationalStatusProvider` delegate lifecycle decisions to
   these coordinators. They keep only React state and presentation mapping.
5. `packages/frontend/src/app/page.tsx` health polling is explicitly out of scope
   for this batch; it is tracked as a separate follow-up because it is not owned by
   `OperationalStatusProvider`.

## Error and safety semantics

- Caller abort: `REQUEST_ABORTED`, no user-facing backend error.
- Internal timeout: `REQUEST_TIMEOUT`, treated as unavailable by login.
- Stale response after credential generation changes: `STALE_RESPONSE`, never
  clears the newer credential and never writes stale UI state.
- A failed operational endpoint maps to its existing `unknownState`; a successful
  sibling endpoint remains `readyState`.
- No test or verification command may use `packages/backend/prisma/dev.db`,
  `backups`, `zalo-session`, live Zalo, or global live mode.

## Acceptance criteria

- Explicit-header 401 preserves the current store credential.
- Store-owned current-generation 401 clears exactly once.
- Timeout is distinguishable from caller abort.
- Login A/B and unmount cancellation abort old work and leave no credential.
- Operational polling has no overlap, no stale publish, no timer after stop, and
  can restart cleanly, including synchronous/re-entrant load failures.
- Focused tests, workspace typecheck, build, full tests, DB guard, and scoped diff
  checks pass with fresh exit codes.
