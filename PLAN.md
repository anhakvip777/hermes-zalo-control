# PLAN.md — Zalo Bridge + Tool Gateway + Agent Adapter Layer

> Implementation plan to evolve the current **text-only** integration into an **agent-agnostic,
> tool-based Bridge** where **any AI agent** operates Zalo only through controlled, audited tools.
>
> Architecture in three layers: **Zalo Bridge** (owns `zca-js` I/O) → **Tool Gateway** (shared core:
> permissions, schema validation, audit/evidence, redaction, dryRun/live, outbound) → **Agent Adapter
> Layer** (pluggable adapters). **Hermes is the first adapter, not the core protocol.**
>
> Read `CLAUDE.md` first. Every phase must respect the Iron Laws: no global live, no destructive
> ops, no secret leakage, Bridge owns zca-js, one outbound door, evidence-or-it-didn't-happen,
> "no tool → say so".

## Guiding principles

- **Agent-agnostic core.** The core protocol/services use neutral names — `AgentBridge`, `AgentAdapter`,
  `AgentRequest`, `AgentResponse`, `AgentToolCall`, `AgentToolResult`. Hermes is only the first adapter
  (`HermesAdapter`). Later adapters can include `ClaudeAdapter`, `OpenAIAdapter`, `GeminiAdapter`,
  `McpAgentAdapter`, `CliAgentAdapter`, `HttpAgentAdapter`. New core code adopts the neutral names; the
  existing `Hermes*` runtime code is left as-is (docs set direction, not a rename).
- **One shared Tool Gateway for all agents.** Every adapter goes through the **same** permission matrix,
  schema validation, audit/evidence, redaction, dryRun/live gate, and `OutboundDispatcher`. Adapters get
  no special privileges and no direct `zca-js` access.
- **Additive & reversible.** New services/models; migrations, never `--force-reset`. Keep the existing
  text-only path working until the structured path is proven.
- **Bridge is the trust boundary.** The agent proposes; the Bridge decides, executes, and records.
- **Every tool call is evidence.** A tool that mutates or reports state must persist a trace row.
- **Don't guess zca-js.** Verify method existence against installed `zca-js@^2.1.2` before wiring a tool.
- **Verify before PASS.** typecheck + tests + build with real exit codes before marking a phase done.

---

## Cross-cutting safety guards (mandatory for every tool phase)

These apply to **all** tools built in Phases 1–7. A tool is not "done" until it satisfies these.

1. **Tool schema validation.** Every tool declares a **zod schema for args and for result**. The Bridge
   validates args before execution and validates/normalizes the result before returning. The agent may
   **not** pass an arbitrary object that the Bridge executes blindly — invalid args → structured
   `blocked`/`failed` error, never a raw throw.
2. **Bridge-owned allowedTools.** The Bridge alone builds `allowedTools` from **role + thread + runtime**.
   The agent only receives the granted list; it can request a tool but can **never** expand its own
   permissions or force a tool that wasn't granted. This holds for **every** adapter equally.
3. **Redaction / masking layer.** Every tool result passes through a mask before returning to the agent:
   no cookies, no tokens, no session data; phone numbers masked unless role permits; no full message
   history when a summary/window suffices. Masking is applied centrally in the gateway, not per-tool.
4. **Idempotency for action (write) tools.** Tools that send messages / create schedules / mutate state
   require an `idempotencyKey`. The Bridge dedupes on it so a repeated agent call does **not** send twice.
5. **Evidence split by kind.** `ToolEvidence` distinguishes:
   - **read** — data read/queried (no mutation);
   - **write** — created/updated/deleted (schedule, rule, setting, etc.);
   - **outbound** — actually sent / dryRun / blocked / cooldown (links to `OutboundRecord`).
6. **Admin / approval gate for sensitive tools.** Some tools are admin-only or require approval, e.g.
   `zalo.sendText`, `zalo.sendImage`, `zalo.sendFile`, global/cross-thread `memory.searchMessages`,
   `access.getUserRole`, `system.getRuntimeStatus`, and `web.fetchPage` (arbitrary-URL fetch).
7. **Data scope by role.** Read/memory tools are scoped: normal users only their own/allowed threads;
   `form_only` cannot call broad memory/search; group members cannot read private DMs; global/cross-thread
   is admin-only. See Phase 4.

---

## Phase 0 — Audit current runtime (no code changes)

Goal: write down ground truth so later phases don't build on assumptions.

- [ ] Trace the live inbound→outbound path and confirm the runtime uses `HermesChatAdapter`
      (text-only) in `incoming-dispatcher.service.ts`, and that `HermesAgentBridge.run()` is **not**
      called anywhere outside tests (confirmed via grep at time of writing).
- [ ] Confirm `OutboundDispatcher.sendOutbound()` is the only path that reaches `ZaloMessageSender`.
      Grep for any direct `sender.sendMessage(` / `api.sendMessage(` calls that bypass it.
- [ ] Confirm rule/access/runtime UI actually affects runtime:
  - `runtime-config.service.ts` → `getCurrentEffectiveDryRun()` used by dispatcher/outbound.
  - `principal.service.ts` permission gate is applied in the dispatcher (`__principalRole`).
  - `rule-engine.service.ts` executions are persisted (`RuleExecution`).
- [ ] **Verify zca-js capabilities against the installed package** (`node_modules/zca-js`, v2.1.2).
      Confirmed used today: `getAllGroups`, `getGroupInfo`, `sendMessage`, `sendVoice`,
      `uploadAttachment`, `addReaction`, `createPoll`, `getOwnId`, `getOwnName`, `loginQR`, `login`,
      `listener.*`. **Verify (do not assume)**: `listFriends`/`getAllFriends`, `getUserInfo`/`findUser`,
      `getThreadInfo`, native `sendImage`/`sendFile`. Record the exact method names + signatures.

**Deliverable:** short audit note (in `docs/`) listing verified methods, the real runtime path, and any
bypasses found. No production behavior changes.

### Phase 0 findings (recorded)

- **Text/media/voice messages have a single door.** `new ZaloMessageSender` is instantiated only inside
  `sendOutbound`; the worker/schedule path reaches it via `POST /api/internal/outbound/send` →
  `sendOutbound`. `ZaloMessageSender` also independently re-checks dryRun/liveTest (defense-in-depth).
- **`HermesAgentBridge.run()` is never called in runtime** — only its own file + `config.ts` (and tests).
  The live path uses the text-only `HermesChatAdapter`.
- **Two write-action bypasses (known gap):** `zalo-reaction.service.ts` (`api.addReaction`) and
  `zalo-poll.service.ts` (`api.createPoll`) call zca-js **directly**, bypassing `sendOutbound`. Both are
  dryRun-gated but write **no `OutboundRecord`/DB evidence** (console/return-value audit only). Closing
  this is scheduled in Phase 2.
- **Prisma has no `@relation`/FKs** — models are linked by convention via string IDs
  (`threadId`, `relatedMessageId`, `ruleId`, `scheduleId`, …). Phase 7's trace UI must join manually.

---

## Phase 1 — Tool Gateway foundation (shared core for all agents)

Goal: a single, permissioned, audited entry point for **every agent's** tool calls. This layer is
agent-agnostic — adapters call it, never `zca-js`.

- [ ] `ToolGateway` interface: `execute(ctx, toolName, args) → ToolResult`.
- [ ] Types with **neutral core names**: `AgentToolCall`, `AgentToolResult`, `ToolEvidence`
      (the existing `HermesAgentToolCall` / `HermesAgentToolResult` in `types/hermes-agent-protocol.ts`
      are the first adapter's shape; new core types use the neutral names and adapters map to/from them).
- [ ] **Per-tool zod schemas** for `args` and `result`. The gateway validates args before execution and
      validates/masks the result after. A tool without both schemas cannot be registered.
- [ ] **Tool registry** where each tool declares: name, `argsSchema`, `resultSchema`, min role, kind
      (`read | write | outbound`), sensitivity (normal | admin | approval-required), and whether it needs
      an `idempotencyKey`.
- [ ] **Bridge-owned `allowedTools` builder**: derive the granted tool list from role + thread + runtime.
      The agent (any adapter) never sets this itself.
- [ ] Prisma model to persist the trace (new migration): e.g. `ToolCallRecord`
      (`id`, `threadId`, `principalId`, `role`, `toolName`, `kind` `read|write|outbound`,
      `idempotencyKey?`, `argsRedacted` JSON, `status` `requested|success|failed|unavailable|blocked`,
      `resultRedacted` JSON, `evidence` JSON, `relatedMessageId`, `agentTaskId?`, timestamps).
      Index by `threadId`, `toolName`, `status`; unique on `idempotencyKey` for write/outbound tools.
- [ ] **Permission matrix by role** (`form_only | basic_chat | advanced | admin`): map each tool to the
      minimum role. Resolve role via `principal.service.ts`.
- [ ] **Idempotency**: write/outbound tools require `idempotencyKey`; a repeated key returns the prior
      recorded result instead of re-executing.
- [ ] **Central redaction**: results pass through the masking layer (no cookie/token/session; phone masked
      by role) before persistence and before returning to the agent. Persist only the redacted forms.
- [ ] **Evidence split** (`read | write | outbound`) recorded on every call.
- [ ] Disallowed tool / bad args → **structured error** (`status: "blocked"`, `code`, `message`),
      persisted, never a throw. Unknown/unimplemented tool → `status: "unavailable"` (feeds the
      "chưa được cấp tool" behavior).

**Acceptance:** unit tests prove (a) allow/deny per role, (b) invalid args are rejected by schema before
execution, (c) a duplicate `idempotencyKey` does not re-execute, (d) results are redacted, and
(e) every call (allowed or denied) writes exactly one trace row with the correct `kind`.

---

## Phase 2 — ZaloProvider abstraction

Goal: isolate zca-js behind an interface so tools never touch raw session/token/cookie.

- [ ] `ZaloProvider` interface exposing only safe, verified operations (status, groups, thread info,
      send-via-dispatcher, etc.).
- [ ] `ZcaJsProvider` adapter wrapping `ZaloGatewayService` / `zca-js`. The Bridge keeps sole ownership
      of the session; the provider **never returns** raw cookies/tokens/session JSON.
- [ ] Tools call the provider; agents call tools via the gateway. No direct zca-js access from any agent.
- [ ] Outbound provider methods must route through `OutboundDispatcher.sendOutbound()` (no direct send).

### Close the Phase 0 write-action bypasses (reaction / poll)

- [ ] Bring `zalo-reaction.service.ts` (`api.addReaction`) and `zalo-poll.service.ts` (`api.createPoll`)
      under the **same action governance** as messages: permission check + dryRun/live gate + DB evidence.
      They must go through the `ZaloProvider` (and, once available, the Tool Gateway) — no direct
      `getApi()` calls from these services.
- [ ] **Add DB evidence for `addReaction` and `createPoll`** (today they only console-log / return a value).
- [ ] **Decide the evidence representation:** `ToolCallRecord` (if invoked as a tool), `OutboundRecord`
      (extend its `source`/kind to cover non-message write actions), or a **new generic `ZaloActionRecord`**
      for all non-message Zalo write ops. Record the decision in the audit note; keep it consistent with
      the `read | write | outbound` evidence split.
- [ ] These write actions **must appear in the Phase 7 decision-trace UI** alongside message outbounds.

**Acceptance:** grep shows tools depend on `ZaloProvider`, not on `zca-js` or `getApi()`; no secret fields
in any tool result; reactions and polls are permission-checked, dryRun/live-gated, and write a DB evidence
row that the Phase 7 trace can surface.

---

## Phase 3 — Internal Zalo tools

Design (implement only what zca-js verifiably supports — Phase 0):

- [ ] `zalo.getRuntimeStatus` — connected, listenerActive, dryRun, selfUserId (no secrets).
- [ ] `zalo.listGroups` — from `getAllGroups` + `getGroupInfo` (already proven in `routes/zalo.ts`).
- [ ] `zalo.getThreadInfo` — thread metadata (verify zca-js support; else DB `ZaloThread`/`ThreadProfile`).
- [ ] `zalo.listFriends` — **only if** zca-js supports it; otherwise `unavailable`.
- [ ] `zalo.getFriendInfo` — **only if** supported; otherwise `unavailable`.
- [ ] `zalo.sendText` — **must** go through `OutboundDispatcher` (respects dryRun/live/cooldown/evidence).
- [ ] `zalo.sendImage` / `zalo.sendFile` — only if provider/zca-js supports; via dispatcher media intents.

**Acceptance:** "bot đang ở group nào" → `zalo.listGroups` returns real provider data (if role permits);
if the tool isn't granted, bot says "chưa được cấp tool".

---

## Phase 4 — Memory tools

> Note: messages stored in the DB do **not** mean the agent knows them. An agent only knows what the
> Bridge injects into context **or** what it fetches via a memory tool.

Design:

- [ ] `memory.getRecentMessages` — recent `Message` rows for a thread.
- [ ] `memory.searchMessages` — text search over `Message` (scoped by thread/role).
- [ ] `memory.getThreadHistory` — ordered history window for a thread.
- [ ] `memory.getOutboundRecords` — `OutboundRecord` history (what was actually sent/blocked/dry-run).
- [ ] `memory.getAgentTasks` — `AgentTask` history.
- [ ] `rules.explainForMessage` — which `Rule`(s) matched a given message (`RuleExecution`).
- [ ] `access.getUserRole` — resolved role/status for a sender (via `principal.service.ts`).
- [ ] `system.getRuntimeStatus` — dryRun, cooldown, batching, heartbeats. **Admin-only.**

### Data scope by role (mandatory)

> **Memory tools must be scoped by role and thread. Normal users may only retrieve messages from threads
> they are allowed to access. Cross-thread or global search is admin-only and must return redacted results.**

- `form_only` → cannot call memory/search tools at all.
- normal user (`basic_chat`) → only threads they participate in / are allowed to access.
- group member → cannot read private DMs (or other groups' history).
- `admin` → may do cross-thread / global search, results still redacted.
- Every memory result passes the redaction layer (no session/token; phone masked unless role permits;
  return a bounded window, not full history, unless justified).

**Acceptance:** "hôm qua tôi nhắn gì" → the agent calls `memory.searchMessages` (or the Bridge supplies
the matching context), the answer is backed by real rows, and a normal user cannot retrieve another
thread's or another user's DMs.

---

## Phase 5 — Agent-agnostic Bridge protocol

Goal: replace the text-only flow with a **neutral, structured** request/response protocol that **any**
agent adapter can speak. Hermes becomes the first adapter on this protocol, not the protocol itself.

- [ ] Define the **agent-agnostic core protocol** with neutral names: `AgentRequest`, `AgentResponse`,
      `AgentToolCall`, `AgentToolResult` (generalize the existing `Hermes*` types in
      `types/hermes-agent-protocol.ts`; keep `Hermes*` as the first adapter's mapping — do not delete
      runtime code as part of docs work).
- [ ] Define the **`AgentAdapter` interface** (`run(AgentRequest) → AgentResponse`) and the
      **`AgentBridge`** orchestrator that drives the tool loop and safety.
- [ ] First adapter = **`HermesAdapter`** (real HTTP/MCP) behind a bridge-enabled flag (default **off** —
      keep the text-only path as fallback until proven). Later adapters (`ClaudeAdapter`, `OpenAIAdapter`,
      `GeminiAdapter`, `McpAgentAdapter`, `CliAgentAdapter`, `HttpAgentAdapter`) plug into the same
      `AgentBridge` + Tool Gateway with **no** extra privileges.
- [ ] Request: `AgentRequest` (permissions, capabilities, allowedTools, runtime dryRun/live).
- [ ] Response: `AgentResponse` may contain `toolCalls` / `actions` / `media` / `safety`.
- [ ] `AgentBridge` **executes tool calls via the Tool Gateway** (Phase 1), collects `toolResults`, and
      returns them to the agent for a final answer (tool loop). The Gateway (permissions, schema,
      audit/evidence, redaction, dryRun/live, outbound) is **identical for every adapter**.
- [ ] **Bounded tool loop** (hard limits, enforced by the Bridge):
  - **max tool rounds** = 3 (configurable, cap 5);
  - **per-tool timeout** (e.g. 10–30s);
  - **total request timeout** (e.g. 60s) covering the whole loop;
  - **schema validation** on every tool call (args + result);
  - **redacted tool results only** returned to the agent;
  - a tool error returns a **structured error** — **no infinite retry**; exceeding rounds/timeout ends
    the loop with a safe fallback answer.
- [ ] Bridge enforces safety/evidence/dryRun/live, then sends the final message **only** through
      `OutboundDispatcher`.
- [ ] Keep the **Unsupported System Claim Guard**: a claim of action requires a real evidence row.

> **The tool loop must be bounded: max rounds, per-tool timeout, total request timeout, schema validation
> for every tool call, and redacted tool results only. The agent may request tools, but the Bridge alone
> decides whether the tool is allowed, executable, and what redacted result is returned.**

**Acceptance:** the structured path is agent-agnostic (Hermes is just the first adapter); it produces
same-or-better safety than the text path; the loop cannot exceed its round/timeout limits; a failing tool
never triggers unbounded retries; disabling the flag falls back cleanly to `HermesChatAdapter`.

---

## Phase 6 — Web search gateway

Design web tools as a permissioned group:

- [ ] `web.search` — general search.
- [ ] `web.fetchPage` — fetch a specific page.
- [ ] `web.getNews`, `web.getWeather`, `web.getPrice` — optional, only if a provider exists.
- [ ] Bridge checks permission (role/capability `canUseWeb`) **before** searching.
- [ ] If no provider (Tavily/Firecrawl/Gemini grounding) is configured → structured error
      `web.search unavailable` (never fabricate results).
- [ ] **`web.fetchPage` is sensitive (admin/approval).** Arbitrary-URL fetch must have an **SSRF guard**
      that blocks:
  - `localhost` / loopback (`127.0.0.0/8`, `::1`);
  - private IP ranges (`10/8`, `172.16/12`, `192.168/16`, link-local `169.254/16`, `fc00::/7`);
  - cloud metadata IP (`169.254.169.254`);
  - `file://` and other non-`http(s)` schemes;
  - internal service hostnames.
  Enforce on the **resolved IP after DNS** (block DNS-rebinding), disallow redirects to blocked targets,
  set a fetch timeout + max response size, and return redacted content.

**Acceptance:** "giá Bitcoin hiện tại" → `web.search` runs if role + provider allow; otherwise a clear
"chưa được cấp tool" / "unavailable". `web.fetchPage` refuses localhost/private/metadata/file URLs even
when the hostname resolves to a blocked IP.

---

## Phase 7 — Message decision trace UI

Goal: open one message and see the full decision path.

- [ ] Debug/trace view showing, for a message:
  inbound message → identity resolved → role/permission → group gate / mention gate →
  matched rules → agent request → tool calls → tool results → evidence records →
  outbound decision → dryRun/live → final `sentMessageId` **or** blocked reason.
- [ ] Include **non-message Zalo write-actions** (reactions, polls) in the trace — each with its
  permission check, dryRun/live decision, and DB evidence row (`ToolCallRecord`/`OutboundRecord`/
  `ZaloActionRecord`, per the Phase 2 decision), not just text/media/voice sends.
- [ ] Backed by existing evidence tables + the new `ToolCallRecord`; add a read-only API endpoint that
      joins them by `relatedMessageId`/`threadId`.
- [ ] Frontend page (extend the existing `messages` page under `packages/frontend/src/app/`).
- [ ] **Redacted-only display.** The trace shows the **masked** agent request/response and masked tool
      args/results — **never** raw prompts, session, tokens, cookies, or tool secrets. The UI reads the
      already-redacted `argsRedacted`/`resultRedacted` fields; it must not fetch raw payloads.

**Acceptance:** any recent message can be inspected end-to-end without reading logs, and no raw
prompt/session/secret is ever shown in the trace UI.

---

## Acceptance criteria (whole effort)

- [ ] "bot đang ở group nào" → real list from provider via `zalo.listGroups` when the tool is granted.
- [ ] No tool granted → bot says clearly **"chưa được cấp tool"** (no fake "để mình kiểm tra").
- [ ] "hôm qua tôi nhắn gì" → the agent uses `memory.searchMessages` or Bridge-supplied context.
- [ ] "giá Bitcoin hiện tại" → the agent uses `web.search` when role + provider allow.
- [ ] No tool/evidence → no "đã kiểm tra / đã làm" claims.
- [ ] **All** text/media/voice outbound goes through `OutboundDispatcher`.
- [ ] **No Zalo write action may execute without a permission check, a dryRun/live decision, and a DB
      evidence row.** "Write actions" explicitly include **reactions and polls**, not only text messages.
- [ ] `zalo-reaction.service.ts` and `zalo-poll.service.ts` no longer call `getApi()` directly — they go
      through the governed path and write DB evidence surfaced by the Phase 7 trace.
- [ ] Every important tool/action writes an evidence row (`ToolCallRecord`/`AgentTask`/`Schedule`/`OutboundRecord`/`ZaloActionRecord`),
      tagged `read | write | outbound`.
- [ ] Every tool call is **schema-validated** (args + result); invalid args are rejected before execution.
- [ ] Tool results are **redacted** (no cookie/token/session; phone masked by role) before reaching the agent or the UI.
- [ ] `allowedTools` is built by the **Bridge** from role/thread/runtime; no agent can expand it.
- [ ] The agent tool loop is **bounded** (max rounds, per-tool + total timeout) with no infinite retry.
- [ ] Write/outbound tools are **idempotent** via `idempotencyKey` (no double-send).
- [ ] `web.fetchPage` (if built) has an **SSRF guard** blocking localhost/private/metadata/file/internal URLs.
- [ ] `typecheck` + `test` + `build` pass with real exit codes before any phase is marked complete.

## Constraints (never violate)

- No global live. Only `LiveTestSession` (quota + TTL, single thread) may bypass dryRun.
- No deleting/resetting DB, `zalo-session/`, or `backups/`.
- No committing tokens/cookies/session/`.env`.
- No agent (any adapter) calls zca-js directly; the Bridge owns the session.
- Tool results never expose raw session/token/cookie.
- No agent decides its own `allowedTools`; the Bridge grants tools by role/thread/runtime.
- Adapters are agent-agnostic peers: the Tool Gateway (permissions, schema, audit/evidence, redaction,
  dryRun/live, outbound) is identical for Hermes and every future adapter.
- No unbounded tool loops and no infinite retries; always bounded rounds + timeouts.
- Sensitive tools (send*, global/cross-thread memory search, `access.getUserRole`,
  `system.getRuntimeStatus`, `web.fetchPage`) are admin/approval-gated.
