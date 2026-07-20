# Batch 5 Structured AgentBridge Dry-Run E2E Design

## Status and constraints

This design implements the approved Batch 5 goal without changing the established
`Zalo Bridge -> Tool Gateway -> Agent Adapter` architecture. The structured path
remains disabled by default. When enabled, it is read-only at the tool boundary and
dry-run-only at the outbound boundary.

The implementation must not change Prisma schema or migration history, enable live
sending, call Zalo directly from an adapter/tool, modify runtime DB/session/backup
state, or fall back to the legacy text-only adapter after a structured-path failure.

## Chosen approach

Keep `AgentAdapter.run(request, priorToolResults)` as the only agent-provider seam and
turn `HermesAdapter` into a real structured JSON HTTP adapter. It accepts an injectable
`fetch` implementation for deterministic tests and hides HTTP serialization, timeout,
body-size, status, and JSON parsing details from `AgentBridge`.

`AgentBridge` remains provider-neutral and owns the trust-boundary validation,
read-only grant calculation, bounded tool loop, and fail-closed decision. This avoids
adding a second transport abstraction and avoids promoting the legacy Hermes-specific
protocol stub into the neutral core.

## Components and interfaces

### HermesAdapter

The adapter sends a versioned neutral envelope containing:

- the current `AgentRequest`;
- the accumulated, already-redacted `priorToolResults`;
- the configured protocol version.

It performs one HTTP POST per round, never retries, never logs request/response bodies,
and rejects missing endpoints, non-2xx responses, timeouts, oversized bodies, invalid
JSON, and transport errors with stable adapter errors. It returns unknown provider data
to the Bridge trust boundary; it does not grant tools or execute actions.

### AgentBridge

The Bridge receives an explicit configured tool-name allowlist. Its advertised grant is
the intersection of:

1. configured tool names;
2. registered definitions;
3. definitions with `kind === "read"`;
4. role and data-scope permissions.

Every adapter response is parsed with a strict runtime schema. Extra keys, invalid
confidence, malformed calls, non-object arguments, duplicate call identifiers, and call
overflow are terminal failures. A tool result with `blocked`, `unavailable`, or `failed`
status is also terminal; the adapter does not receive another round after failure.

The total deadline applies across adapter and tool work. The remaining total budget
caps each adapter wait and each tool execution. Round and call limits are hard failures,
not silent truncation.

### ToolGateway

The gateway independently enforces the exact Bridge-issued `allowedTools`, in addition
to existing registry, role, data-scope, schema, and dry-run checks. This prevents an
adapter from invoking a registered but unadvertised tool.

Tool result and error data is redacted before both persistence and return to the next
adapter round. A ToolCallRecord evidence-write failure is terminal; the gateway must
not return a synthetic evidence ID and pretend the call is trustworthy.

The tool context carries the internal inbound `Message.id`, principal/role, agent name,
and `AgentTask.id`, so evidence is linked without trusting external Zalo message IDs.

### Incoming and outbound dispatch

The inbound persistence result exposes the internal `Message.id`, which is carried on
the transient normalized message into the structured dispatch. This is an in-memory
linkage addition only; no schema change is required.

Dispatch behavior is explicit:

- flag OFF: use the existing text-only path unchanged;
- flag ON: use only the structured path;
- structured error/fallback: mark the task with a redacted reason and stop;
- structured success: call `OutboundDispatcher.sendOutbound()` exactly once.

The structured outbound intent uses a `dry_run_only` delivery policy. That policy
forces dry-run even if global runtime state or a controlled live-test session would
otherwise permit live delivery, so `ZaloMessageSender` is unreachable from this path.

Outbound idempotency continues to use the internal inbound `Message.id`. A duplicate
dispatch resolves to the existing outbound record rather than creating or sending a
second message.

## Data flow

1. Persist a synthetic inbound message and retain its internal `Message.id`.
2. Create an `AgentTask` linked to that message.
3. Build an `AgentRequest` with the Bridge-owned read-only tool grant.
4. Hermes round one requests one granted memory read tool.
5. ToolGateway validates, executes, redacts, and persists ToolCallRecord evidence.
6. Hermes round two receives the redacted prior result and returns final text.
7. The dispatcher invokes the sole outbound door with `dry_run_only` and internal IDs.
8. The outbound record, assistant message, task, and tool evidence share exact links.
9. Replaying the same inbound message is suppressed by persistent idempotency.

## Error handling

The structured path fails closed for malformed/unknown/disallowed calls, invalid args,
tool timeout/provider error, evidence failure, adapter error/timeout, body overflow,
round/call overflow, total timeout, safety block, empty final text, and unsupported
system claims. There is no retry loop, text-only fallback, live outbound, or unredacted
provider detail in the returned or persisted evidence.

Separately, Batch 4.5 closes three false-green input/response gaps before Batch 5:

- readiness responses must be semantically consistent with their checks and summary;
- health root status must not contradict nested critical evidence;
- controlled-live parameters must be meaningful strings and finite bounded integers.

## Verification design

Tests are written and observed failing before implementation. Focused coverage includes:

- strict AgentResponse parsing and bounded loop failures;
- exact read-only allowlist enforcement in both Bridge and Gateway;
- redacted errors/results and terminal evidence-write failure;
- structured HTTP serialization of prior results and transport failures;
- flag OFF unchanged and flag ON no text fallback;
- forced dry-run outbound despite a live-test override;
- internal Message/AgentTask/ToolCallRecord/OutboundRecord linkage;
- duplicate suppression and zero Zalo provider calls;
- Batch 4.5 semantic response/input validation regressions.

Completion requires fresh focused tests, the full monorepo test suite, typecheck, build,
strict config positive/negative cases, schema/migration guard, isolated backend startup,
isolated structured E2E, Browser QA, unchanged runtime DB hash, and cleanup of only
goal-created temporary artifacts.

## Rejected alternatives

- A separate `AgentJsonTransport` interface is unnecessary while HTTP is the only
  structured transport and would make the adapter a shallow pass-through module.
- Extending the legacy `HermesAgentBridge` stub would duplicate neutral contracts and
  mix Hermes-specific envelope concerns with core orchestration.
- Reusing the current text-only adapter cannot prove a prior-tool-results second round
  and would leave the enabled structured path misleadingly incomplete.
