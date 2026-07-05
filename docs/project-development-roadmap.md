# Hermes Zalo Bridge — Development Roadmap

Derived from the legacy `zalo-bot-2` audit + current bridge state. Ordered by milestone.
Guiding rule: **stay dry-run/idle by default; each live step is explicit, quota/TTL-bounded,
trace-required, with a kill switch.**

Legend: status = ✅ done · 🟡 partial · ⬜ todo.

---

## M0 — Safety baseline ✅ (mostly done)
- **Goal:** no unintended live send; single outbound door; evidence for everything.
- Work: dryRun default; OutboundDispatcher sole door; allowlist gate; ToolGateway governance;
  reaction/poll governed; Decision Trace; unsupported-claim guard; admin auth on routes.
- Files: `services/tool-gateway/*`, `services/zalo-provider/*`, `services/allowlist.service.ts`,
  `services/incoming-dispatcher.service.ts`, `routes/trace.ts`, `app.ts`.
- Tests: tool-gateway, governed-action, trace-service, app-auth, legacy-regression. ✅
- Acceptance: all sends dryRun by default; no direct zca-js in agent/tools; trace present.
- Risk: stale Prisma migrations (deploy only). Status: ✅ (migration created; keep dry-run).

## M1 — AllowThreads + Access Control 🟡
- **Goal:** admin explicitly allows each thread; UI reliable; principal roles clear.
- Work: AllowThreads discover/allow (done); **finish UI initial-load reliability** (per-tab state
  done); document Access-Control vs AllowThreads relationship; surface friends/groups verification.
- Files: `routes/access.ts`, `services/threads-access.service.ts`, `services/allowlist.service.ts`,
  `frontend/app/allow-threads/page.tsx`.
- Tests: `access-threads.test.ts` ✅; add UI state test (todo).
- Acceptance: Friends/Groups show on first load; toggle persists; gate uses same source. 🟡
- Risk: dashboard 429 (M5).

## M2 — Memory correctness ⬜
- **Goal:** correct identity + thread-scoped, bounded, redacted context.
- Work: robust **threadType/senderId resolution** (close legacy 128 `unknown-thread-type` + blank
  senderId); recent-N (≈200) + deep-search older; **no cross-thread leak**; context budget; PII-safe
  roster mapping (pháp danh ↔ id) with redaction.
- Files: `services/tools/memory/*`, `incoming-dispatcher` normalize, `services/trace.service.ts`.
- Tests: memory-tools (scope) ✅; add identity-resolution + context-budget tests. ⬜
- Acceptance: blank/unknown sender never elevated; cross-thread read blocked; context bounded.
- Risk: identity mapping errors cause mis-permission → keep default form_only.

## M3 — Agent Bridge (dry-run) 🟡
- **Goal:** structured agent loop, safe, off by default.
- Work: bounded tool loop; unsupported-claim guard; provider/AI fallback; tool permission by role.
- Files: `services/agent-bridge/*`, `unsupported-claim-guard.service.ts`.
- Tests: `agent-bridge.test.ts` ✅.
- Acceptance: flag OFF default; error/timeout/too-many-rounds → text-only fallback; no fabricated claims.
- Risk: needs AI key to exercise real replies (currently canned fail-safe).

## M4 — Zalo tools expansion 🟡
- **Goal:** parity with legacy capabilities, all governed.
- Work: list friends/groups (done), get thread info, send text/media/voice via dispatcher,
  **governed reaction/poll** (done); add **poll create + vote tracking**, rich-card/template,
  attendance helper; attachment handling.
- Files: `services/tools/zalo/*`, `services/zalo-provider/*`.
- Tests: zalo-tools ✅, governed-action ✅; add poll/vote-tracking + media tests. ⬜
- Acceptance: every write action produces evidence; dryRun simulates; no CLI bypass.

## M5 — Admin UI / Decision Trace / LiveTestSession 🟡
- **Goal:** operate safely from the dashboard.
- Work: AllowThreads (done), Decision Trace page (done), **LiveTestSession panel** (create/cancel,
  quota/TTL), status + reconnect button, logs/errors view; **fix dashboard 429** (relax limiter for
  polling endpoints or separate limiter).
- Files: `frontend/app/*`, `routes/zalo.ts`, `middleware/rate-limit.ts`.
- Tests: trace-service ✅; add UI smoke where possible. ⬜
- Acceptance: admin can allow a thread, open a live-test session, watch trace, kill instantly.

## M6 — Ops hardening ⬜
- **Goal:** survive the failures the legacy bot hit (62 login-fail, silent listener drop).
- Work: **listener auto-recovery** + heartbeat alerting; reconnect strategy on WS drop;
  **persistent dedupe/idempotency consumption** (survive restart); queue health; backup/session SOP.
- Files: `services/zalo-gateway.service.ts`, `services/heartbeat.service.ts`, evidence/idempotency.
- Tests: reconnect/dedupe unit tests (stubbed). ⬜
- Acceptance: listener recovers automatically; no duplicate send after restart; alert on drop.

## M7 — Limited live (1 DM) ⬜
- **Goal:** first real send, tightly bounded.
- Work: single allowed DM; LiveTestSession TTL 5m, quota 1; trace required; kill switch = cancel/dryRun.
- Acceptance: exactly ≤1 live message; evidence + trace; group blocked; auto-reply otherwise off.
- Risk: only after M2/M6 identity + session hardening.

## M8 — Expanded live (multiple DMs) ⬜
- **Goal:** several allowed DMs, still bounded.
- Work: per-thread quota/cooldown; follow-up engine with **no-reply → human escalation** (never nag);
  monitoring dashboard.
- Acceptance: no unattended repeat-nagging; cooldown enforced; all traced.

## M9 — Selected group live (with approval) ⬜
- **Goal:** governed group announcements/polls.
- Work: group allow + `requireMention`; **human approval** for group sends/broadcasts; poll governance.
- Acceptance: no group send without explicit allow + human approval; blast radius controlled.

## M10 — Production hardening ⬜
- **Goal:** durable production operation.
- Work: **Prisma migration reconciliation** (stale-migration task); secret management (no plaintext);
  backup/restore SOP; rollback; observability/alerting; load/perf.
- Acceptance: `migrate deploy` safe; secrets never plaintext; documented rollback.

---

## Sequencing note
Do **M2 (identity) + M6 (ops)** before **M7 (live)** — the legacy failures (128 unknown-thread-type,
62 login-fail, silent listener drop, restart duplicates) map directly to these. Do **M9 (group)**
last and only with human approval.


---

## Addendum — evidence-backed additions (after reading real memory content)

These update the milestones above with concrete evidence from `zalo-bot-2/workspace/memory`.

### M0+ — Inbound secret redaction (promote to BLOCKER, do now)
- **Evidence:** `raw-inbound/2026-05-21.jsonl` (user pasted 3 `sk-…` keys), `ctn-crm-login.md` (plaintext password).
- **Why:** users demonstrably paste secrets into DMs; storing them cleartext is a leak.
- **Work:** apply `redact()` to `Message.content` on the inbound save path; never persist user credentials cleartext.
- **Acceptance:** a saved inbound containing `sk-…`/JWT/long-hex shows `[REDACTED]`; no plaintext secret in DB/trace.
- **Test:** inbound-redaction regression. **Risk if skipped:** credential/API-key leakage.

### M2+ — Identity & threadId resolution (raise priority)
- **Evidence:** 128 `unknown-thread-type` blocks; `raw-inbound` `threadId:null`; 571 blank senderId; `.dreams` identity lookups.
- **Work:** derive threadId/threadType from `to`/`groupId`/`isGroup`; name/pháp-danh↔id identity map (PII-safe); blank → form_only.
- **Acceptance:** no `unknown-thread-type`; blank sender never elevated; group vs DM always resolved.

### M2b — Task / Reminder / Follow-up engine (NEW milestone; the core legacy feature)
- **Evidence:** `threads/user:…3918.md` (NL task capture, timers, status, report-on-`.`), `followup-archive`
  (ack detection, `repeatEveryMinutes`, `maxAttempts:60`, `stale` expiry), `nhac-nho/`, `thu-ky/`.
- **Goal:** per-user task/checklist + scheduled/recurring reminders + follow-up with **no-reply → human escalation**.
- **Work:** schedule/reminder store; ack detection; cap re-nudges + escalate; all sends via OutboundDispatcher + dryRun.
- **Files:** new `services/reminder-*`, integrate with allowlist gate + trace.
- **Acceptance:** reminders only to allow-listed threads; capped no-reply nudges; every fire traced; dryRun by default.
- **Risk if skipped:** cannot replace the old bot’s primary function; or (if naively ported) resurrects the nagging loop.

### M4+ — Poll vote-tracking + attendance + rich-card/notes helpers
- **Evidence:** `checkpoint` (poll_id + non-voter nudge), `thu-ky/…/mau-tin-nhan.md` (templates), meeting-notes threads.
- **Work:** governed poll create + vote tracking + non-voter nudge; attendance/điểm danh; meeting-notes; rich-card send.

### M9+ — Group governance (raise emphasis)
- **Evidence:** group-dominant traffic (3431 vs 1080), `dropped-group-inbound` `missing_mention` gate.
- **Work:** group @mention gate + explicit group allow + **human approval** for group announcements/broadcasts.
