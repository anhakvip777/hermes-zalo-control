# Legacy Memory Harvest (content-based)

Based on **actually reading file content** in `zalo-bot-2/workspace/memory` (not just inventory).
Names → role labels; phone/creds/keys → `[REDACTED_SECRET]`/`[num]`; IDs → last-4. No raw chat dumped.

## 0. What was actually read (evidence base)

| Folder | Files read | Records/lines read | Basis |
|---|---|---|---|
| `chat-log/` | all 23 `.jsonl` parsed | **4511 records** aggregated | **real content** (categorized, not dumped) + schema from 3 sample files |
| `outbound-audit/` | all 19 `.jsonl` parsed | **518 rows** by decision/source/reason/verifiedBy | **real content** |
| `raw-inbound/` | 2/2 files | ~17 records | **real content** (full read) |
| `outbound-dedupe/` | 1 sample of 104 | 1 record | **real content** (schema + preview) |
| `sent-context/` | 1 sample of 15 | 1 record | **real content** |
| `followup-archive/` | 1/1 | 7 follow-up records | **real content** (full read) |
| `.dreams/` | 2/2 (recall + events) | recall map + 40 recall events | **real content** |
| `threads/` | 5 of 18 (incl. 2 largest) | full | **real content** |
| `thu-ky/` | 4 of 5 | full | **real content** |
| `nhac-nho/`, business `.md` | all | full | **real content** |
| `conversation-audit/` | 1/1 | 3 rows | **real content — smoke only** |
| `runtime-errors/` | 1/1 | 1 row | **real content — smoke only** |
| `dropped-group-inbound/` | 1/1 | 1 row | **real content — smoke only** |
| daily `YYYY-MM-DD.md` | ~6 non-empty | full | **real content** |

Not fully read: 13 of 18 small `threads/*.md`, 103 of 104 `outbound-dedupe/*.json` (identical schema),
14 of 15 `sent-context/*.txt` (identical shape). Reason: representative sample sufficed; no content skipped for sensitivity except secret **values** (redacted).

## 1. Executive summary
The old bot ("**Tiny**", persona "Muội") is an AI **secretary** for a Buddhist guidance board
(**Ban Hướng Dẫn**) running **Vesak 2026**. Real content confirms it did: **per-user task
management** (capture tasks from DM, maintain checklists, create timed reminders, track status),
**group announcements/reminders** (checklist nudges with Google-Sheets links), **polls + attendance**,
**meeting notes**, **member/identity lookup**, and **daily broadcasts**. Traffic was **group-heavy**
and high-volume, peaking around the 28–31 May event.

**Confirmed top risks (from real content):** it **captured/stored secrets in cleartext** (user pasted
`sk-…` API keys into a DM → saved in `raw-inbound`; CRM password in `ctn-crm-login.md`); **inbound had
`threadId: null`** (identity derived from `to`/`groupId`) → 128 `unknown-thread-type` send blocks +
571 blank-senderId records; **no dry-run** (all live); **62 login/session send failures**; and a
**relentless no-reply follow-up** loop.

## 2. What the old bot did (real content)
- **Personal task secretary (DM):** e.g. `threads/user:…3918.md` (Tỷ Đoàn Phương) — user dictates tasks;
  bot builds a checklist (grew to 12+ items in one morning), creates timers ("timer 09:00 with 10 việc"),
  tracks done/pending, and honors **user-defined conventions**: "all my messages = reminders", "`.` =
  report the task list once", "never auto-delete done tasks unless told".
- **Group secretary:** scheduled/announcement reminders (followup-archive: checklist nudges to
  `VESAK26_BHD_TKV` with Sheets links, `repeatEveryMinutes:1440`, `maxAttempts:60`).
- **Polls + attendance:** create poll, tag members, check voters, nudge non-voters (`checkpoint`).
- **Meeting notes / timelines:** `threads/hop-dong-ca-2205.md`, `dai-le-hoi-*`, per-KV schedules.
- **Identity lookup:** `.dreams` recall queries are dominated by "find userId/threadId for <person>".
- **Daily devotional broadcast** + rich-card messages (`sent-context` shows a formatted board announcement).

## 3. Real workflows (evidence)
- **DM task capture → timer/reminder → status tracking → report-on-command** (`threads/user:…3918.md`).
- **Follow-up engine** with `expectedAckSenderId`, `ackKeywords`, `repeatEveryMinutes`, `maxAttempts`,
  `status` (expired/cancelled), `lastError:"stale:23m"` (followup-archive) — real ack/expiry/repeat logic.
- **Group announcement** broadcasts (timer-fire 179, dm-broadcast 9 in outbound-audit).
- **Recipient verification** against friends/groups cache before send (`verifiedBy` field).

## 4. Conversation patterns (real content)
- **Group-dominant:** 3431 group vs 1080 DM records. Groups need @mention to be handled
  (`dropped-group-inbound` reason `missing_mention`); un-mentioned group chatter is dropped.
- **DM:** 1:1 task/secretary dialogs; also lots of short greetings/acks ("Hi", "Xin chào", "dạ", "ạ").
  Example real inbound: one user sent "Hi/Xin chào" ~10× in an hour (noise) — auto-replying to all is unsafe.
- **Media:** 323 records with media (voice/mp4/pdf/images) inbound.
- **Control:** `/new` and `@Tiny …` commands; group mention required.

## 5. Thread/group/user patterns
- Core secretaries (a few DMs) drive proactive task/reminder flows.
- A long tail of one-off senders → most need **no reply**.
- Groups (board/KV) are high-blast-radius announcement targets → explicit-allow + mention only.
- `threads/*.md` distinguish DM (`user:<id>`) vs group; useful metadata for AllowThreads.

## 6. Features present in old bot (confirmed)
- **Task manager** (per-user checklist, NL capture, status). **Reminder/timer engine** (one-shot +
  recurring, ack detection, expiry). **Follow-up with no-reply re-nudge.** **Polls + vote tracking +
  attendance.** **Group announcement broadcasts.** **Rich-card/template messages.** **Recipient
  verification cache.** **Per-signature dedupe.** **Memory recall (identity + notes).** **Meeting notes.**

## 7. Features missing in Hermes Bridge (evidence-backed)
- **Task/checklist manager + reminder/timer engine + no-reply → human escalation** (biggest gap; core of what the bot did).
- **Poll create + vote tracking + non-voter nudge**; **attendance/điểm danh**; **meeting-notes** helper.
- **Identity resolution** (name/pháp-danh ↔ userId/threadId) — PII-safe, since the bot leaned on it constantly.
- **Robust threadId/threadType derivation** from `to`/`groupId` when `threadId` is null.
- **Group @mention gate** + governed group announcement/broadcast with human approval.
- **Inbound secret redaction** (see BLOCKER below).

## 8. Errors that occurred (real data)
- Outbound (518 rows): **sent 309 / blocked 144 / failed 65**.
- **`unknown-thread-type` = 128** blocked — root cause visible in `raw-inbound`: `threadId: null`, type from `to`/`isGroup`.
- **login/session failed = 62** — send during session drop.
- **`dm-not-verified` = 15** — recipient not in cache.
- **blank senderId = 571** chat-log records (12.7%).
- **1310 chat-log records with blank `direction`** — logging inconsistency.
- chat-log only logged **206 "sent"** vs outbound-audit **309 sent** — **incomplete outbound logging**.
- `dryRun` = **0 occurrences** — always live.
- Follow-ups expiring `stale:Nm` (ack never detected) in followup-archive.

## 9. Fixes attempted in old bot & lessons
- **Secret handling attempted but inconsistent:** `threads/user:…3918.md` explicitly saved CRM login to a
  600-perm `secrets/*.txt` and noted "không ghi mật khẩu vào memory thread" — yet `ctn-crm-login.md` still
  holds the plaintext password, and `raw-inbound` captured `sk-…` keys. → Bridge must redact **inbound**
  content + never persist secrets anywhere in cleartext, uniformly.
- **Dedupe** (per-signature file + preview) — worked but in-memory/file, not restart-proof.
- **Recipient verification cache** — good; formalized as bridge allowlist.
- **Follow-up ack/expiry** — solid engine to carry over, but add **no-reply cap → human handoff**.
- **Audit retrofit** — `conversation-audit`/`runtime-errors`/`dropped-group-inbound` stayed **smoke-only**;
  real errors were only inferable from `outbound-audit`. → Bridge’s first-class evidence + trace is the fix.

## 10. Open risks still present
Secret-in-inbound capture (BLOCKER). threadId-null/identity resolution (HIGH). Session/login drops (HIGH).
No dry-run (legacy). No-reply nagging (HIGH). Group broadcast blast radius. Incomplete/inconsistent logging.

## 11. Covered by the new bridge
Dry-run default + OutboundDispatcher single door; allowlist gate (threadType-scoped) + default-deny;
governed reaction/poll + evidence (ToolCall/ZaloAction/OutboundRecord) + Decision Trace; **redaction layer**
(masks phones/JWT/long-hex/bearer — would mask `sk-…` hex body); unsupported-claim guard; memory thread-scope.

## 12. Not covered by the bridge
Task/checklist + reminder/timer + no-reply escalation engine; poll vote-tracking; attendance/notes; robust
identity + threadId-null resolution (128 unknown-thread-type, 571 blank sender); **inbound-content secret
redaction on the Message-save path** (not just tool args); persistent dedupe/idempotency consumption;
session/listener auto-recovery + alerting; group @mention gate + approved broadcast.

## 13. Regression candidates
See `packages/backend/src/__tests__/fixtures/legacy-memory-cases.json` (updated with real-content cases:
inbound `sk-…` secret → redacted on save; group not-mentioned/not-allowed → no reply; `threadId:null` →
resolve type, don’t mis-send; noise "Hi"×N → no auto-reply; task-capture/reminder → schedule tool +
no-reply→human; CRM-credential request → redact + block-persist).

## 14. Readiness assessment
**READY_FOR_DRYRUN_ONLY.** Real content raises one **new BLOCKER** that must be closed before *any* live
handling of real inbound: **secret redaction on the inbound Message-save path** (users demonstrably paste
API keys/passwords). BLOCKER for expanded/group live also needs identity/threadId robustness (KI-H1) and
session auto-recovery (KI-H2).

## 15. Recommendation before live
1. **Redact inbound content before persistence** (Message.content) — mask `sk-…`, JWT, long-hex, phones; never store user-sent credentials in cleartext.
2. Harden **threadId/threadType + identity** resolution (fix null-threadId, blank senderId → form_only).
3. Add **session/listener auto-recovery + alerting**.
4. Build a **task/reminder/follow-up engine with no-reply → human escalation** (never endless nudging).
5. Persist **dedupe/idempotency** across restart.
6. Keep dry-run default; only then a single-DM LiveTestSession (quota/TTL/trace/kill-switch).
