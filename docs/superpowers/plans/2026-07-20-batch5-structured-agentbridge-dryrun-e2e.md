# Batch 5 Structured AgentBridge Dry-Run E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Make the local structured AgentBridge path execute one bounded read-only tool round and a second agent round, then produce one fail-closed dry-run outbound with fresh end-to-end evidence.

**Architecture:** Preserve \`Zalo Bridge -> Tool Gateway -> Agent Adapter\`. The Bridge owns strict response validation, the exact read-only grant, loop limits, and terminal failure decisions. \`HermesAdapter\` is a structured JSON HTTP adapter behind the existing neutral \`AgentAdapter\` seam; the dispatcher never falls back to text-only when the structured flag is ON.

**Tech Stack:** TypeScript, Fastify, Prisma/SQLite (existing models only), Zod, Vitest, Next.js frontend validators, Node \`fetch\`.

**Safety:** No global live, real Zalo send, QR/login/reconnect/disconnect, schema/migration edit, runtime DB/session/backup/secret edit, commit/push/merge/deploy, or cleanup of pre-existing user artifacts. All smoke/E2E data uses temporary DB/session/env values. \`.claude/worktrees/**\` stays quarantined.

---

### Task 1: Establish fresh inventory and semantic fail-closed regression tests

**Files:**
- Modify: \`packages/frontend/src/lib/api-client.test.ts\`
- Modify: \`packages/backend/src/__tests__/batch18-live-test.test.ts\`
- Inspect/modify: \`packages/backend/src/routes/system.ts\`, \`packages/backend/src/services/live-test.service.ts\`
- Inspect/modify: \`packages/frontend/src/lib/api-client.ts\`

- [ ] **Step 1: Capture inventory before edits**

Run from \`E:\\BridgeZalo\\repo\`:

\`\`\`powershell
git status --short --branch
git diff --name-status
git diff --check
git diff --name-only -- packages/backend/prisma packages/backend/prisma/schema.prisma
\`\`\`

Expected: no staged files, no schema/migration path in the Batch 5 diff, and \`git diff --check\` exit 0. Save the exact output in the handover evidence notes without staging anything.

- [ ] **Step 2: Write failing frontend semantic-validator tests**

Extend the existing API-client fixtures/tests to assert \`getProductionReadiness()\` rejects: invalid timestamp, score below 0 or above 100, duplicate check IDs, summary counts that do not equal check counts, \`READY_FOR_LIVE\` with a fail/unknown check, and extra root/check keys. Add a health fixture where \`status: "healthy"\` conflicts with \`db.ok === false\`, an inactive worker, or a down critical heartbeat and assert \`getHealthDetail()\` rejects it.

- [ ] **Step 3: Run only those tests and verify RED**

\`\`\`powershell
npx vitest run --config ./vitest.config.ts packages/frontend/src/lib/api-client.test.ts
\`\`\`

Expected: the new contradiction cases fail because current validators are shape-only.

- [ ] **Step 4: Write failing controlled-live input tests**

Add cases for whitespace-only \`reason\`, non-string/empty \`threadId\`, and each of \`1.5\`, \`NaN\`, and \`Infinity\` for \`maxMessages\` and \`ttlSeconds\`. Assert the deterministic validation error and that no session/audit create is attempted. Add a route case proving fractional JSON receives canonical 400.

- [ ] **Step 5: Run the focused backend tests and verify RED**

\`\`\`powershell
npx vitest run --config ./vitest.config.ts packages/backend/src/__tests__/batch18-live-test.test.ts
\`\`\`

- [ ] **Step 6: Implement the minimum semantic validators**

Derive expected readiness summary/verdict from the checks; require a valid ISO timestamp, score \`null\` or \`[0,100]\`, unique non-empty IDs, and consistent \`dataQuality\`. Derive a conservative health status from critical nested evidence and reject contradictions. Validate live-test input before any DB lookup/create with trimmed non-empty strings and finite integers within the existing bounds. Keep all public error codes and existing safe defaults unchanged.

- [ ] **Step 7: Re-run focused tests and typecheck the touched packages**

\`\`\`powershell
npx vitest run --config ./vitest.config.ts packages/frontend/src/lib/api-client.test.ts packages/backend/src/__tests__/batch18-live-test.test.ts
npm run typecheck -w packages/backend
npm run typecheck -w packages/frontend
\`\`\`

Expected: PASS, exit 0.

---

### Task 2: Add strict neutral AgentResponse and structured Hermes adapter

**Files:**
- Create: \`packages/backend/src/services/agent-bridge/agent-response-schema.ts\`
- Create: \`packages/backend/src/__tests__/hermes-structured-adapter.test.ts\`
- Modify: \`packages/backend/src/services/agent-bridge/hermes-adapter.ts\`
- Modify: \`packages/backend/src/services/agent-bridge/types.ts\` only when a type is required by the existing neutral protocol.

- [ ] **Step 1: Write failing adapter transport tests**

Inject a fake \`fetch\` and assert one POST contains the protocol version, \`AgentRequest\`, and prior redacted tool results. Add tests for non-2xx, invalid JSON, response body over the configured limit, abort timeout, and missing endpoint. Assert no retry and no raw provider body in the thrown error/message.

- [ ] **Step 2: Run the adapter tests and verify RED**

\`\`\`powershell
npx vitest run --config ./vitest.config.ts packages/backend/src/__tests__/hermes-structured-adapter.test.ts
\`\`\`

- [ ] **Step 3: Implement the minimal HTTP adapter**

Add constructor options \`{ endpoint, protocolVersion, timeoutMs, maxResponseBytes, fetchImpl }\` with safe config defaults. POST JSON once with an \`AbortController\`; reject missing endpoint, non-2xx, invalid/oversized JSON, timeout, and transport failures using stable short error codes. Do not log payloads or provider response bodies. Return parsed unknown data to the Bridge for trust-boundary validation.

- [ ] **Step 4: Add strict response parsing tests at the Bridge seam**

In \`agent-bridge.test.ts\`, add RED cases for \`null\`, arrays, extra keys, invalid confidence, non-array calls, malformed call names/arguments, empty terminal text, and call overflow.

- [ ] **Step 5: Implement \`agent-response-schema.ts\`**

Use strict Zod objects: response object only; optional trimmed bounded text; confidence finite in \`[0,1]\`; \`toolCalls\` as an array of objects with a non-empty bounded name and JSON-object arguments; safety with only the documented keys. Parse every adapter result before loop decisions and map parse failure to \`malformed_response\`.

- [ ] **Step 6: Run adapter and Bridge focused tests and verify GREEN**

\`\`\`powershell
npx vitest run --config ./vitest.config.ts packages/backend/src/__tests__/hermes-structured-adapter.test.ts packages/backend/src/__tests__/agent-bridge.test.ts
\`\`\`

---

### Task 3: Enforce read-only grants and fail-closed bounded loop

**Files:**
- Modify: \`packages/backend/src/services/agent-bridge/agent-bridge.ts\`
- Modify: \`packages/backend/src/services/agent-bridge/index.ts\`
- Modify: \`packages/backend/src/services/tool-gateway/types.ts\`
- Modify: \`packages/backend/src/services/tool-gateway/gateway.ts\`
- Modify: \`packages/backend/src/services/tool-gateway/permissions.ts\`
- Modify: \`packages/backend/src/__tests__/agent-bridge.test.ts\`
- Modify: \`packages/backend/src/__tests__/tool-gateway.test.ts\`

- [ ] **Step 1: Write RED tests for exact grants and terminal failures**

Assert the Bridge advertises only \`memory.getRecentMessages\` (never \`zalo.sendText\`, web, or write tools), and the Gateway blocks a registered but omitted tool. Assert unknown/disallowed/invalid/failed/timeout tool results stop the loop before a second adapter call. Assert calls above \`maxCallsPerRound\` fail instead of being sliced, and a total timeout during sequential tool work returns \`total_timeout\`.

- [ ] **Step 2: Implement exact grant propagation**

Add an immutable \`allowedTools\` list to \`ToolContext\` and an optional \`allowedToolNames\` bridge option. Compute \`configured ∩ registered ∩ read-kind ∩ role/dataScope\`. \`getAgentBridge()\` passes the single approved read-tool list while retaining existing registration for unrelated tests. Gateway checks exact membership before execution and records a blocked evidence result for omitted tools.

- [ ] **Step 3: Implement terminal and deadline semantics**

Parse adapter output before use; hard-fail overflow; check deadline before and after each adapter/tool operation; pass only redacted successful results into the next adapter call; stop immediately on any non-success tool result; never accept a final text after a failed tool. Preserve existing unsupported-claim and empty-text guards.

- [ ] **Step 4: Run focused tests and verify GREEN**

\`\`\`powershell
npx vitest run --config ./vitest.config.ts packages/backend/src/__tests__/agent-bridge.test.ts packages/backend/src/__tests__/tool-gateway.test.ts
\`\`\`

---

### Task 4: Make evidence fail-closed and preserve internal IDs

**Files:**
- Modify: \`packages/backend/src/services/tool-gateway/evidence.ts\`
- Modify: \`packages/backend/src/services/tool-gateway/types.ts\`
- Modify: \`packages/backend/src/services/tool-gateway/gateway.ts\`
- Modify: \`packages/backend/src/services/zalo-receive.ts\`
- Modify: \`packages/backend/src/services/zalo-gateway.service.ts\`
- Modify: \`packages/backend/src/services/incoming-dispatcher.service.ts\`
- Modify: \`packages/backend/src/__tests__/tool-gateway.test.ts\`
- Modify: \`packages/backend/src/__tests__/incoming-dispatcher.test.ts\`

- [ ] **Step 1: Write RED evidence/linkage tests**

Use an evidence sink that throws and assert the gateway returns a failed terminal result rather than a synthetic \`unpersisted-*\` ID. Assert returned/persisted error messages/details are redacted. Assert \`agentTaskId\`, principal, role, thread, and internal \`relatedMessageId\` are written exactly.

- [ ] **Step 2: Implement fail-closed evidence writes**

Remove synthetic-success behavior for structured calls: evidence persistence errors become a stable provider/evidence failure and are surfaced to the Bridge as terminal. Redact error message and detail before both return and persistence; never include raw provider text.

- [ ] **Step 3: Propagate internal message identity**

Extend \`NormalizedMessage\` with an optional transient \`dbMessageId\`; make \`saveIncomingMessage()\` return it for both new and deduplicated rows; assign it in the Zalo listener before dispatch. Use it for \`AgentTask.messageId\`, bridge context, trace/evidence, and outbound linkage. Do not modify Prisma schema or migrations.

- [ ] **Step 4: Run focused gateway/dispatcher tests and verify GREEN**

\`\`\`powershell
npx vitest run --config ./vitest.config.ts packages/backend/src/__tests__/tool-gateway.test.ts packages/backend/src/__tests__/incoming-dispatcher.test.ts
\`\`\`

---

### Task 5: Wire flag semantics and forced dry-run outbound

**Files:**
- Modify: \`packages/backend/src/services/incoming-dispatcher.service.ts\`
- Modify: \`packages/backend/src/services/outbound-dispatcher.service.ts\`
- Modify: \`packages/backend/src/services/agent-bridge/index.ts\`
- Modify: \`packages/backend/src/__tests__/incoming-dispatcher.test.ts\`
- Create/modify: one focused outbound idempotency test file under \`packages/backend/src/__tests__/\`.

- [ ] **Step 1: Write RED flag/outbound tests**

Assert flag OFF never constructs/calls AgentBridge and keeps text-only behavior. Assert flag ON success never calls \`HermesChatAdapter\`; malformed/timeout/blocked structured results mark the task and return \`dispatched:false\` without text fallback or outbound. Assert a \`dry_run_only\` intent remains dry-run even when runtime/live-test hooks report live and never constructs/calls \`ZaloMessageSender\`.

- [ ] **Step 2: Implement explicit structured branch**

Separate disabled from failed outcomes. On enabled structured failure, record a redacted task failure and return without outbound. On success, preserve confidence/round/evidence metadata and call only \`sendOutbound()\`.

- [ ] **Step 3: Implement \`deliveryPolicy: "dry_run_only"\`**

Add the optional policy to the outbound intent and make \`sendOutbound()\` skip live-test override when it is set. Keep all existing callers on the default runtime policy. Structured success uses source \`agent_tool\`, internal inbound ID, task ID, and tool evidence IDs.

- [ ] **Step 4: Run focused tests and verify GREEN**

\`\`\`powershell
npx vitest run --config ./vitest.config.ts packages/backend/src/__tests__/incoming-dispatcher.test.ts packages/backend/src/__tests__/batch-audit-echo-guard.test.ts
\`\`\`

---

### Task 6: Add isolated structured dry-run E2E

**Files:**
- Create: \`packages/backend/src/__tests__/batch5-structured-agentbridge-dryrun-e2e.test.ts\`
- Modify only test helpers if required: \`packages/backend/src/__tests__/shared-setup.ts\`

- [ ] **Step 1: Write the isolated E2E harness**

Use a temporary Prisma DB/session/env, a synthetic persisted inbound \`Message\`, a fake structured provider response (round one read call, round two final text), actual registry/Gateway/Bridge/dispatcher code, and a stub Zalo provider that records any attempted send.

- [ ] **Step 2: Run the new E2E and verify RED**

\`\`\`powershell
npx vitest run --config ./vitest.config.ts packages/backend/src/__tests__/batch5-structured-agentbridge-dryrun-e2e.test.ts
\`\`\`

- [ ] **Step 3: Complete assertions and implementation fixes**

Assert the second provider request contains only redacted prior results; \`AgentTask.messageId\`, \`ToolCallRecord.relatedMessageId\`, \`ToolCallRecord.agentTaskId\`, assistant message linkage, and \`OutboundRecord.inboundMessageId\` all equal internal IDs; outbound is dry-run; replay is idempotently skipped; and zero provider send calls occur.

- [ ] **Step 4: Run the E2E again and verify GREEN**

Expected: one successful read ToolCallRecord, one dry-run OutboundRecord, no live/provider call, duplicate replay suppressed.

---

### Task 7: Full verification and checkpoint documentation

**Files:**
- Modify: \`HANDOVER.md\` current authoritative section
- Modify: \`CLAUDE.md\` current pointer/checkpoint only, with shown diff
- Create: \`docs/batch5-checkpoint-manifest-2026-07-20.md\`

- [ ] **Step 1: Run all fresh gates from \`E:\\BridgeZalo\\repo\`**

\`\`\`powershell
git diff --check
git diff --name-only -- packages/backend/prisma packages/backend/prisma/schema.prisma
npm test
npm run typecheck
npm run build
npm run config:check:strict -w packages/backend
npm run db:guard -w packages/backend
\`\`\`

Run positive and negative strict-config fixtures without touching \`.env\` or runtime DB. Run isolated backend-up startup and structured E2E against temporary DB/session; hash the real dev DB before/after.

- [ ] **Step 2: Run Browser QA in a fresh isolated profile**

Verify flag-off dashboard behavior, backend-down and malformed-response fail-closed states, no mutation/live controls or non-GET requests, and no secret/storage leakage. Keep all browser processes/ports/temp artifacts isolated and clean only artifacts created by this goal.

- [ ] **Step 3: Produce authoritative inventory/manifest**

Record exact tracked modified, staged, untracked, created/modified files, quarantine paths, command lines, exit codes, DB hash, and remaining blockers. Exclude \`.claude/worktrees/**\`, runtime DB/session/backups, secrets, and generated outputs from any checkpoint group.

- [ ] **Step 4: Self-review docs and diff**

Run:

\`\`\`powershell
rg -n \"TBD|TODO|implement later|fill in details\" docs/superpowers/plans/2026-07-20-batch5-structured-agentbridge-dryrun-e2e.md docs/2026-07-20-batch5-structured-agentbridge-dryrun-e2e-design.md
git diff --stat
git status --short --branch
\`\`\`

Expected: no placeholders, no staged files, no schema/migration diff, and only intentional goal files added/modified. Do not commit or push.
