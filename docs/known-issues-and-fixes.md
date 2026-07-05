# Known Issues and Fixes

Sources: legacy `zalo-bot-2` memory audit, current bridge code, observed runtime (Steps 5–…).
"Blocks live" = must be resolved before that scope of live sending.

---

## BLOCKER

### KI-B1 — Legacy had no dry-run (every reply live)
- Source: legacy `openzalo/src/send.ts`; outbound-audit `dryRun`=0 occurrences.
- Symptom: any generated reply was sent for real.
- Root cause: no dryRun gate in the send path.
- Status: **fixed in bridge** — OutboundDispatcher `getCurrentEffectiveDryRun()`; dryRun default true.
- Fix/Test: `zalo-provider-governed-action.test.ts`, `legacy-regression.test.ts`. Blocks live: resolved.

### KI-B2 — Plaintext secrets/PII persisted in memory
- Source: `ctn-crm-login.md` (email+password), `team-nhan-su-*`/daily logs (names+phones+ids).
- Symptom: credentials + PII stored in cleartext memory files.
- Root cause: agent “remember this” wrote raw text; no redaction.
- Status: **bridge has redaction layer**; must ensure memory tools/trace never persist raw secrets/PII.
- Fix/Test: `tool-gateway/redaction.ts`; add a memory-write redaction test. Blocks live: **yes** (until memory-write path is confirmed redacting).

### KI-B3 — Reply-to-anyone / group blast (legacy `"*"` allow-all, groupPolicy=open)
- Source: `policy.ts allowlistHasEntry('*')`.
- Symptom: could reply to all DMs / all groups if misconfigured.
- Root cause: wildcard allow + open policy.
- Status: **fixed in bridge** — explicit per-thread, threadType-scoped allowlist; default deny.
- Fix/Test: `access-threads.test.ts`, `legacy-regression.test.ts`. Blocks live: resolved.

### KI-B4 — Inbound secrets captured & stored in cleartext (from real content)
- Source: `raw-inbound/2026-05-21.jsonl` — a user pasted **3 `sk-…` API keys** into a DM, stored raw;
  `ctn-crm-login.md` holds a **plaintext CRM email+password**.
- Symptom: user-provided secrets persisted in memory/logs in cleartext.
- Root cause: inbound `content` saved verbatim; no redaction on the ingest/persist path.
- Old fix (partial): one thread saved a credential to a 600-perm file and avoided thread memory —
  but not applied uniformly (root `ctn-crm-login.md` + raw-inbound still leak).
- Status: **partial** — bridge has a `redact()` layer (masks phone/JWT/long-hex/bearer; would mask the
  `sk-…` hex body), but it is **not confirmed applied to `Message.content` on the inbound save path**.
- Proposed fix: redact inbound content before persistence + never store user-sent credentials cleartext.
- Test: `legacy-memory-regression` inbound-redaction test. **Blocks live: yes** (before handling real inbound).

---

## HIGH

### KI-H1 — threadType/identity resolution failure (`unknown-thread-type` / null threadId)
- Source: outbound-audit — **128 sends blocked** on `unknown-thread-type`; `raw-inbound` shows
  `threadId: null` (type derived from `to`/`groupId`/`isGroup`); chat-log **571 blank senderId** (12.7%);
  `.dreams` recall dominated by name→userId/threadId lookups (identity was central & fragile).
- Symptom: cannot reliably tell user vs group / who the sender is; sends blocked or mis-scoped.
- Root cause: inbound normalization leaves threadId null + senderId blank; identity mapping ad-hoc.
- Status: **partial** — bridge gate is threadType-scoped and default-safe on blank, but resolution accuracy is not hardened.
- Fix: derive threadId/threadType from `to`/`groupId`/`isGroup`; identity map (name/pháp-danh↔id); blank → form_only.
  Test: identity-resolution test (todo). Blocks live: **yes** (before expanded live).

### KI-H6 — No task/reminder/follow-up engine (biggest feature gap)
- Source: `threads/user:…3918.md` (per-user task capture + timers), `followup-archive` (ack/expiry/repeat).
- Symptom: the core of what the old bot did (secretary task/reminder management) has no bridge equivalent.
- Status: **not covered.**
- Fix: task/checklist + reminder/timer engine with **no-reply → human escalation** (never endless nudging),
  governed via OutboundDispatcher + dryRun. Test: engine unit tests. Blocks live: **yes** (before enabling reminders).

### KI-H2 — Session/login drops (`Đăng nhập thất bại`) + silent listener stop
- Source: outbound-audit — **62 send_failed** on login-failed; observed listener silent drop ~20 min (Step 5).
- Symptom: sends fail; inbound stops being received.
- Root cause: zca-js WS drop; startup auto-connect only when autoReply enabled; no auto-recovery/alert.
- Status: **partial** — WS handlers + scheduleReconnect + `/ops/reconnect` exist; not fully automatic.
- Fix: listener auto-recovery + heartbeat alerting. Test: reconnect unit test (todo). Blocks live: **yes**.

### KI-H3 — Duplicate send after restart (in-memory dedupe)
- Source: legacy `outbound-dedupe/` (in-memory/file, 218 dedupe hits); bridge idempotency not fully consumed.
- Symptom: same message could resend after a restart.
- Root cause: dedupe state not persisted/consumed across restart.
- Status: **partial** — bridge OutboundRecord + idempotencyKey exist; consumption not wired.
- Fix: consume idempotencyKey/contentHash on send. Test: duplicate-restart test. Blocks live: **yes** (before expanded live).

### KI-H4 — Unattended no-reply follow-up nagging
- Source: `threads/<id>.md` — 3×/day follow-ups for ~6 days to a non-responding user.
- Symptom: endless automated nudges with no human escalation.
- Root cause: follow-up engine had no no-reply cap / handoff.
- Status: **not covered** (bridge has no follow-up engine yet).
- Fix: reminder engine with no-reply cap → human escalation + cooldown. Blocks live: **yes** (before enabling reminders).

### KI-H5 — AllowThreads initial tab load intermittently empty
- Source: observed runtime (this project).
- Symptom: Friends tab empty on first load; appears after switching tabs.
- Root cause: shared state + dual-effect race, no `loaded` guard.
- Status: **fixed** — per-tab state + request-seq guard + explicit states.
- Fix/Test: `frontend/app/allow-threads/page.tsx` (rewritten); needs browser confirm. Blocks live: no.

---

## MEDIUM

### KI-M1 — Dashboard polling 429 after auth tightening
- Source: observed; `/api/zalo/login/status` polled faster than strictRateLimit (20/min).
- Status: open. Fix: relax/segregate limiter for polling endpoints. Blocks live: no.

### KI-M2 — Trace outbound link is best_effort
- Source: `trace.service.ts` (no `messageId` on OutboundRecord).
- Status: open (documented). Fix: add message↔outbound link or keep honest confidence. Blocks live: no.

### KI-M3 — Stale Prisma migrations
- Source: migrations folder not in sync; `db push` used for dev.
- Status: migration for evidence tables created; broader reconciliation pending.
- Fix: `migration-reconciliation` task before `migrate deploy`. Blocks live: no (blocks prod deploy).

### KI-M4 — Empty audit streams in legacy (lesson)
- Source: `conversation-audit/` smoke-only; `runtime-errors/`/`dropped-group-inbound/` empty.
- Status: **improved in bridge** (first-class evidence + trace). Blocks live: no.

---

## LOW

### KI-L1 — AI provider unavailable fallback
- Source: no `CHIASEGPU_API_KEY` locally → canned test-mode reply.
- Status: **covered** (fail-safe, no crash, no fabricated claim). Blocks live: no.

### KI-L2 — "đã gửi/đã kiểm tra" without evidence
- Source: agent hallucination risk (legacy pattern).
- Status: **covered** — unsupported-claim guard. Blocks live: no.

### KI-L3 — Media/voice/image unknown types
- Source: legacy inbound media handling.
- Status: partial — bridge send path gated by dryRun; inbound understanding optional/flagged.
  Fix: ensure unknown media never triggers unsafe live send. Blocks live: no (dryRun on).
