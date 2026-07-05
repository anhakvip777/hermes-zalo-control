# Legacy Bot Casebook (zalo-bot-2 → Hermes Bridge)

Read-only audit of the legacy `openclaw/openzalo` bot at `e:\BridgeZalo\zalo-bot-2`,
mapping its behaviors/risks to the new bridge (`e:\BridgeZalo\repo`) coverage.

**Method:** metadata inventory + targeted read-only grep on code files only
(`config/extensions/openzalo/src/**`, `workspace/*.js`). Session/credential/QR/
memory/media data dirs were **not** read. No secrets printed. CodeGraph (global
v0.9.7) used on the new repo only (indexing the legacy tree would ingest secrets).

## Legacy inventory (summary)
- 2970 files (excl node_modules/.git). 474 `*.jsonl` agent session/trajectory logs,
  `config/memory/zalo-2.sqlite` (40 MB), inbound media (mp3/mp4/pdf), 99 QR pngs.
- Core code: `config/extensions/openzalo/src/` (send/inbound/monitor/policy/
  normalize/outbound-dedupe/reply-session-recovery) + `workspace/*.js` action scripts.
- Last active ~2026-06-06. Agent = openclaw ACP; delivery via `openzca` CLI.

---

## Legacy architecture facts (evidence)
- **Send path:** `send.ts:sendTextOpenzalo()` → `runOpenzcaCommand(...)` → real Zalo send.
  **No dry-run in the send path** — any reply that reaches delivery is a LIVE send.
- **Gating (`inbound.ts` + `policy.ts`):** `dmPolicy` (open|disabled), `groupPolicy`
  (allowlist|open|disabled), `allowFrom`/`groupAllowFrom` with **`"*"` wildcard = allow-all**,
  `requireMention`, per-group sender allowlist, control-command auth. Config-file driven
  (`openclaw.json`, `outbound-policy.json`, `phan-quyen.json` — many `.bak` whitelist revisions).
- **Dedupe:** `outbound-dedupe.ts` — in-memory `Map` (5000 recent signatures). Lost on restart.
- **Self id:** `monitor.ts` resolves `selfId` **asynchronously after connect**; messages can
  arrive before it's known.
- **Evidence:** structured `logOutbound`/`trace` logging; audit was **retrofitted** later
  (`workspace/tmp_patch_*_audit.py`). No governance DB / no per-action evidence records.
- **Reactions/polls:** `workspace/react.js`, `tao-bang-vote.js`, `gui-anh-bang-vote.js` —
  direct action scripts, no governance/evidence.

---

## Casebook

Coverage legend: **covered** / **partial** / **not covered** (by the new bridge).

### A. Safety

**LEGACY-A1 — No dry-run: every generated reply is a live send** · Severity: BLOCKER
- Evidence: `openzalo/src/send.ts` (`sendTextOpenzalo` → `runOpenzcaCommand`, no dryRun branch).
- Expected (bridge): all sends flow through `OutboundDispatcher.sendOutbound()` gated by
  `getCurrentEffectiveDryRun()`; dryRun → synthetic id, no live send.
- Coverage: **covered** (dispatcher dryRun default true; live only via LiveTestSession).
- Test: `legacy-001` (dryRun creates synthetic id, no live).

**LEGACY-A2 — `"*"` allow-all wildcard / `dmPolicy=open` replies to everyone** · Severity: HIGH
- Evidence: `policy.ts:allowlistHasEntry()` (`if (allowFrom.includes("*")) return true`),
  `onboarding.ts` adds `"*"` for `dmPolicy=open`.
- Expected (bridge): per-thread allowlist with explicit threadType; no global wildcard.
- Coverage: **covered** (allowlist.service; gate `isThreadAllowedCached`; UI is explicit per-thread).
- Test: `legacy-002` (thread not allowed → no reply), `legacy-005`.

**LEGACY-A3 — Reply to a group that isn't allow-listed (if groupPolicy=open)** · Severity: BLOCKER
- Evidence: `policy.ts:resolveOpenzaloGroupAccessGate()` (`policy==="open"` → allow all groups).
- Expected (bridge): group must be explicitly allowed (threadType=group); default deny.
- Coverage: **covered** (gate blocks `thread_not_allowed`; group ≠ user scope).
- Test: `legacy-003` (group not allowed → no reply), `legacy-006`.

**LEGACY-A4 — Duplicate / re-send after restart (dedupe is in-memory)** · Severity: HIGH
- Evidence: `outbound-dedupe.ts` (in-memory `Map`, lost on process restart).
- Expected (bridge): OutboundRecord + contentHash persisted in DB; ToolGateway idempotencyKey.
- Coverage: **partial** — persistent OutboundRecord + idempotency exist, but the bridge's
  dedupe consumption is not fully wired (documented limitation). Flag.
- Test: `legacy-004` (dry-run outbound recorded; idempotency key present).

**LEGACY-A5 — Self-reply/loop window before `selfId` resolves at startup** · Severity: MEDIUM
- Evidence: `monitor.ts` (`if (!selfId) resolve...` after connect).
- Expected (bridge): self/bot filtering in `safetyCheck` (`isFromBot`, self senderId).
- Coverage: **covered** (dispatcher `safetyCheck` self_message guard; auto-reply default OFF).
- Test: covered indirectly by gate tests.

### B. Context / memory
**LEGACY-B1 — Cross-thread context leak / thread mixing** · Severity: HIGH
- Expected (bridge): memory tools scoped per thread; non-admin cannot read other threads.
- Coverage: **covered** (`memory/scope.ts` `resolveThreadScope`; tested in memory-tools).
- Test: `legacy-007` (non-admin other-thread read → blocked).

**LEGACY-B2 — `senderId` blank / identity mapping** · Severity: HIGH
- Evidence: legacy `normalize.ts:resolveOpenzaloDirectPeerId` falls back across several ids;
  new bridge messages listing showed blank `senderId` (observed in Step 5).
- Expected (bridge): permission keyed on principalId (senderId); blank → default form_only, never elevated.
- Coverage: **partial** — gate/permission default-safe on blank, but blank senderId reduces
  per-user RBAC accuracy. Flag (frontend display + principal mapping follow-up).
- Test: `legacy-008` (unknown/blank sender role → not elevated).

### C. Tool / write
**LEGACY-C1 — Actions bypass a single outbound door (direct CLI send)** · Severity: HIGH
- Evidence: `workspace/*.js` (`gui-tin.js`, `safe-send.js`, `react.js`, `tao-bang-vote.js`)
  call send/react/poll directly.
- Expected (bridge): text/media/voice only via OutboundDispatcher; reaction/poll only via
  governed action path (ZaloProvider + ZaloActionRecord); agent never calls zca-js.
- Coverage: **covered** (codegraph: `getApi` callers = routes/sender/provider only; no
  agent/tool path; reaction/poll via `performGovernedZaloAction`).
- Test: `legacy-009` (governed reaction dryRun → no live, evidence written).

**LEGACY-C2 — Missing evidence/audit for actions** · Severity: HIGH
- Evidence: legacy audit retrofitted via `tmp_patch_*_audit.py`.
- Expected (bridge): ToolCallRecord + ZaloActionRecord + OutboundRecord; Decision Trace.
- Coverage: **covered** (evidence sinks + trace).
- Test: `legacy-010` (trace exists; blocked reason recorded).

### D. Agent behavior
**LEGACY-D1 — Agent claims "đã gửi/đã kiểm tra" without evidence** · Severity: HIGH
- Expected (bridge): unsupported-claim guard neutralizes claims lacking evidence.
- Coverage: **covered** (`unsupported-claim-guard.service.ts`; both dispatcher + bridge paths).
- Test: existing `agent-bridge.test.ts`.

**LEGACY-D2 — AI provider unavailable → no fail-safe** · Severity: MEDIUM
- Expected (bridge): AI unavailable → safe fallback / text-only, no fabricated result.
- Coverage: **covered** (Step 5C observed canned fail-safe reply, no crash; bridge fallback).
- Test: existing `agent-bridge.test.ts` (adapter throw/timeout fallback).

### E. Operations
**LEGACY-E1 — Session drop / reconnect / listener inactive** · Severity: HIGH
- Evidence: `reply-session-recovery.ts`; observed in bridge Step 5 (listener stopped ~20 min).
- Expected (bridge): gateway WS disconnect handlers + scheduleReconnect + `/ops/reconnect`.
- Coverage: **partial** — reconnect exists but startup auto-connect only when autoReply enabled,
  and listener can drop silently. Flag (ops runbook / heartbeat alerting).
- Test: n/a (runtime/ops; not unit-testable here).

**LEGACY-E2 — Dashboard polling 429 after auth tightening** · Severity: MEDIUM
- Evidence: bridge `/api/zalo/login/status` 429 under strictRateLimit.
- Coverage: **partial** — known, deferred follow-up (relax limiter for polling endpoints).

---

## Gap summary
- **Covered:** A1, A2, A3, A5, B1, C1, C2, D1, D2.
- **Partial (flag):** A4 (dedupe consumption), B2 (blank senderId RBAC accuracy),
  E1 (listener auto-recovery/alerting), E2 (dashboard 429).
- **Not covered:** none blocking.

No new BLOCKER gap requiring an immediate code change was found — the new bridge's
dryRun-default + allowlist gate + OutboundDispatcher + governed actions + evidence/trace +
claim guard already neutralize the legacy BLOCKER behaviors. Partials are HIGH/MEDIUM
follow-ups, not live-safety blockers (dryRun stays on).
