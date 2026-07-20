# Batch 4 Fail-Closed Dashboard Design

**Goal:** close the remaining dashboard safety gaps after Batch 3 without changing the
Fastify/Prisma/SQLite architecture, schema, runtime database, Zalo session, or live policy.

## Scope and approved invariants

- `/errors` is read-only in the dashboard. It must never expose a Test Alert button or
  call a mutation endpoint. The existing backend alert service remains available only for
  separately approved operational use and is not wired from this page.
- A failed, timed-out, aborted, or malformed error-summary request renders an explicit
  `UNKNOWN`/error state. It must not render `status=ok`, green success styling, zero counters,
  or an empty-list success message.
- `/system-health` treats health, config-check, and heartbeat data as remote evidence. A
  missing or malformed response produces an explicit unknown state for that section; it must
  not substitute `null`, `0`, `false`, `—`, or a green status as if the request succeeded.
- Polling is single-flight and is cancelled on unmount. A late response cannot overwrite a
  newer state or a stopped page.
- `config:check:strict` must work from npm on Windows and POSIX without shell-specific
  `NAME=value command` syntax.

## Design

Use the existing `RemoteDataState<T>` and `apiFetch()` seams. Each page owns an
`AbortController`, an in-flight guard, and a generation token. Successful validated payloads
enter `ready`; any other outcome enters `unknown` with a user-visible error. Rendering is
branch-based: loading, unknown, and ready are mutually exclusive. No fallback data is created
in the render path.

The Windows command is moved behind a small Node wrapper that sets `STRICT_CONFIG_CHECK=true`
in a copied environment and forwards the child exit code. This keeps the package script
portable without adding a dependency or changing config semantics.

## Verification seams

1. Frontend API-client tests reject incomplete health/error/config payloads.
2. Frontend state tests prove failed remote data has `data === null` and cannot classify as
   healthy/zero.
3. Backend full suite, frontend focused suite, typechecks, and builds run after the edits.
4. Isolated backend-up smoke and Browser QA remain read-only/dry-run; no live/Zalo operation is
   part of this batch.
