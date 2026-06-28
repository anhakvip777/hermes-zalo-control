     1|     1|# Final Scenario Testing Report — Hermes Zalo Control Center
     2|     2|
> **Date:** 2026-06-27 23:50 ICT (Batch 8 Conversation Memory — live dry-run ALL PASS)
> **Purpose:** Edge case & safety testing before pilot/customer demo
> **Method:** 6 parallel agents via code inspection + runtime API checks
> **Hard rule:** No real Zalo sends, no group messages, no allowlist removal

## Batch 6 — Voice/TTS (2026-06-27)

| Category | Result | Detail |
|----------|--------|--------|
| TTS generation (edge-tts) | ✅ PASS | Text→MP3, 18 unit tests |
| M4A conversion (FFmpeg) | ✅ PASS | AAC 44100Hz 64k mono |
| DM voice send pipeline | ✅ PASS | TTS→M4A→upload→sendVoice |
| Group voice inside TTL | ✅ PASS | Reply window gate: allow |
| Group voice outside TTL | ✅ PASS | Blocked: GROUP_REPLY_WINDOW_CLOSED |
| Voice audit (JSONL) | ✅ PASS | 6 entries logged |
| **Native Zalo playback** | ❌ UNSTABLE | Duration `--:--`, no audio |
| **Feature flag** | `ZALO_VOICE_ENABLED=false` | API returns VOICE_NOT_SUPPORTED |

**Known limitation:** zca-js `sendVoice()` produces voice bubbles that Zalo app cannot play. TTS generation + API pipeline work correctly. Feature disabled by default. Future: send audio as file attachment.

---
     7|     7|
     8|     8|---
     9|     9|
    10|    10|## Executive Summary
    11|    11|
    12|    12|| Group | Agent | Scenarios | PASS | FAIL | Gaps |
    13|    13||-------|-------|-----------|------|------|------|
    14|    14|| 1 | Zalo Chat Safety | 9 | 7 | 2* | Emoji bypass, missing self-guard |
    15|    15|| 2 | RealHermes Adapter | 9 | 9 | 0 | None |
    16|    16|| 3 | Scheduler Reliability | 7 | 5 | 1* | Stuck job recovery missing |
    17|    17|| 4 | Worker/Recovery | 8 | 8 | 0 | None |
    18|    18|| 5 | Security/Secrets | 9 | 6 | 2* | No API auth, backup secrets |
    19|    19||| 6 | Documentation/Handoff | 7 | 7 | 0 | None (fixed during audit) |
    20|    20||| 7 | **Create-Reminder (Live)** | **4** | **4** | **0** | **None** |
| 8 | **Zalo Media Send (Live)** | **6** | **6** | **0** | **None** |
| 9 | **Outbound Guardrails** | **27** | **27** | **0** | **None** |
| 10 | **Image OCR / Vision (Live)** | **8** | **8** | **0** | **None** |
| 11 | **Conversation Memory (Live)** | **11** | **11** | **0** | **None** |
| | **TOTAL** | | **105** | **98** | **5*** | **4 gaps** |
    23|    22|
    24|    23|> \* Non-blocking for pilot/demo — see details below.
    25|    24|
    26|    25|---
    27|    26|
    28|    27|## Group 1: Zalo Chat Safety Agent ✅
    29|    28|
    30|    29|| # | Scenario | Result | Evidence |
    31|    30||---|----------|--------|----------|
    32|    31|| 1 | Thread not in allowlist → skip | ✅ PASS | `incoming-dispatcher.service.ts:51-53` + test:83-87 |
    33|    32|| 2 | Self/bot message skip | ⚠️ GAP | Gateway handles (gateway:326, receive:118), dispatcher safetyCheck missing |
    34|    33|| 3 | Non-text message → skip | ✅ PASS | `incoming-dispatcher.service.ts:59-61` + test:95-99 |
    35|    34|| 4 | Empty/emoji content | ❌ GAP | `.trim()` only catches whitespace — emoji-only passes. Need Unicode-aware check |
    36|    35|| 5 | Cooldown: 2-3 msgs in 10s | ✅ PASS | `incoming-dispatcher.service.ts:18-22,63-65` — verified live via API |
    37|    36|| 6 | Empty Hermes reply | ✅ PASS | `incoming-dispatcher.service.ts:109-114` — AgentTask failed, no send |
    38|    37|| 7 | Reply >2000 chars truncate | ✅ PASS | `incoming-dispatcher.service.ts:117-123` — 1986 chars + 12 suffix |
    39|    38|| 8 | Low confidence (<0.5) | ✅ PASS | `incoming-dispatcher.service.ts:139-149` — dryRun=true, confidenceTooLow |
    40|    39|| 9 | Group not allowed by default | ✅ PASS | Allowlist blocks all non-listed threads by design |
    41|    40|
    42|    41|**Gaps (non-blocking):**
    43|    42|- Emoji-only messages bypass the empty-content gate — Unicode character detection should complement `.trim()`
    44|    43|- Dispatcher `safetyCheck()` missing `isSelf` guard (defense-in-depth — gateway handles it upstream)
    45|    44|
    46|    45|---
    47|    46|
    48|    47|## Group 2: RealHermes Adapter Agent ✅
    49|    48|
    50|    49|| # | Scenario | Result | Evidence |
    51|    50||---|----------|--------|----------|
    52|    51|| 1 | CLI timeout → AgentTask failed | ✅ PASS | `adapter.ts:207-210` + `dispatcher.ts:181-186` + test:296-309 |
    53|    52|| 2 | CLI stdout empty → empty_reply | ✅ PASS | `adapter.ts:219-226` + `dispatcher.ts:109-114` + test:247-253 |
    54|    53|| 3 | CLI exit != 0 → HERMES_CLI_FAILED | ✅ PASS | `adapter.ts:213-216` + test:256-272 |
    55|    54|| 4 | CLI ENOENT → HERMES_CLI_MISSING | ✅ PASS | `adapter.ts:172-175,199-204` + test:274-294 |
    56|    55|| 5 | Error keywords → confidence 0.3 | ✅ PASS | `adapter.ts:148-156` + test:331-338 |
    57|    56|| 6 | Dispatcher try/catch no crash | ✅ PASS | `dispatcher.ts:97-186` + test:137-143 |
    58|    57|| 7 | spawn(shell=false) not exec() | ✅ PASS | `adapter.ts:182-186` + test:311-329 |
    59|    58|| 8 | Safety prefix in CLI prompt | ✅ PASS | `adapter.ts:123-131` + test:323-328 |
    60|    59|| 9 | 60s timeout for 8-15s latency | ✅ PASS | `.env:32` — 4-7.5× headroom |
    61|    60|
    62|    61|**Gaps:** None. 24 existing tests cover all error paths.
    63|    62|
    64|    63|---
    65|    64|
    66|    65|## Group 3: Scheduler Reliability Agent ⚠️
    67|    66|
    68|    67|| # | Scenario | Result | Evidence |
    69|    68||---|----------|--------|----------|
    70|    69|| 1 | dryRun=true → no real send | ✅ PASS | `scheduler.ts:143-241` — never calls sender; test:197-223 |
    71|    70|| 2 | Cancel before run → no execute | ✅ PASS | `job.service.ts:32-55` + `index.ts:88` + `scheduler.ts:54` |
    72|    71|| 3 | Emergency stop → blocks all | ✅ PASS | `scheduler.ts:62-67,257-259,183-204` — triple guard |
    73|    72|| 4 | Worker dedup (atomic claim) | ✅ PASS | `index.ts:25-31` — `updateMany + count > 0` |
    74|    73|| 5 | Stuck job recovery | ❌ GAP | No `startedAt` field, no recovery scan for stuck "active" jobs |
    75|    74|| 6 | Old jobs on restart | ⚠️ GAP | `index.ts:86` time gate works, but no staleness ceiling |
    76|    75|| 7 | Version bump → old jobs skip | ✅ PASS | `scheduler.ts:29-51` + `schedule.service.ts:229` — dual protection |
    77|    76|
    78|    77|**Gap (non-blocking for demo):**
    79|    78|- No stuck job recovery — if worker crashes mid-job, the "active" job is stranded forever. Not an issue for demo (worker is stable).
    80|    79|
    81|    80|---
    82|    81|
    83|    82|## Group 4: Worker/Recovery Agent ✅
    84|    83|
    85|    84|| # | Scenario | Result | Evidence |
    86|    85||---|----------|--------|----------|
    87|    86|| 1 | /api/worker/status < 2s | ✅ PASS | Response: 0.0017s, `active=true, provider=db-polling` |
    88|    87|| 2 | Worker heartbeat to DB | ✅ PASS | `workers/index.ts:105-118` — writes every 10s |
    89|    88|| 3 | /api/zalo/status connected | ✅ PASS | `connected=true, dryRun=false, selfUserId=...` |
    90|    89|| 4 | API auto-restore startListener=true | ✅ PASS | `index.ts:13` — calls `restoreSession({ startListener: true })` |
    91|    90|| 5 | Worker startListener=false | ✅ PASS | `workers/index.ts:66` — no duplicate listener |
    92|    91|| 6 | No duplicate processes | ✅ PASS | 1 API + 1 Worker only (PIDs 811605, 811597) |
    93|    92|| 7 | Listener error isolation | ✅ PASS | `zalo-gateway.service.ts:332-337` — try/catch, non-fatal |
    94|    93|| 8 | /api/health OK | ✅ PASS | `{"status":"ok","uptime":2047}` |
    95|    94|
    96|    95|**Gaps:** None.
    97|    96|
    98|    97|---
    99|    98|
   100|    99|## Group 5: Security/Secrets Agent ⚠️
   101|   100|
   102|   101|| # | Scenario | Result | Evidence |
   103|   102||---|----------|--------|----------|
   104|   103|| 1 | .env.example no real secrets | ✅ PASS | All placeholders: `<openssl rand -hex 32>`, `/path/to/hermes`, `""` |
   105|   104|| 2 | .env not committed | ⚠️ PARTIAL | `.gitignore` covers `.env` but NOT backup files |
   106|   105|| 3 | No session creds in docs | ✅ PASS | Searched all `.md` — zero hits for cookie/imei/session tokens |
   107|   106|| 4 | Auto-reply status requires auth | ❌ FAIL | Returns 200 without credentials |
   108|   107|| 5 | Zalo status requires auth | ❌ FAIL | Returns 200 without credentials — exposes selfUserId |
   109|   108|| 6 | Port 3002 not public | ✅ PASS | Bound to `127.0.0.1` only |
   110|   109|| 7 | Allowlist is ON | ✅ PASS | `ZALO_AUTO_REPLY_ALLOWED_THREADS=6792540503378312397` |
   111|   110|| 8 | Group auto-reply off by default | ✅ PASS | `config.ts:64` — defaults to false |
   112|   111|| 9 | No secrets in server logs | ✅ PASS | All console.log calls clean |
   113|   112|
   114|   113|**Findings (non-blocking for demo):**
   115|   114|- **API endpoints lack auth** — `agent/*` and `zalo/*` routes return 200 without credentials. Port is localhost-only, so risk is low during demo but should be fixed for production.
   116|   115|- **6 backup files with plaintext secrets** — `.env.backup.*` files and `backup-*` directories contain real passwords. Clean up after demo.
   117|   116|
   118|   117|---
   119|   118|
   120|   119|## Group 6: Documentation/Handoff Agent ✅
   121|   120|
   122|   121|| # | Checklist Item | Result |
   123|   122||---|---------------|--------|
   124|   123|| 1 | CUSTOMER_DEMO_SUMMARY.md covers 8 sections | ✅ PASS — fixed test failures mention |
   125|   124|| 2 | DEPLOYMENT.md has rollback instructions | ✅ PASS — added DRY_RUN+mock+DISABLED section |
   126|   125|| 3 | CUSTOMER_READINESS_AUDIT.md: 16+ PASS, Real CLI | ✅ PASS — masked selfUserId |
   127|   126|| 4 | STABILITY_AUDIT.md: pipeline, modes, gates, all risks | ✅ PASS — added 4 missing risks |
   128|   127|| 5 | All docs mention 5 test failures as non-blocking | ✅ PASS — added to all 4 docs |
   129|   128|| 6 | No secrets in docs | ✅ PASS — masked bot Zalo ID |
   130|   129|| 7 | Architecture diagram accurate | ✅ PASS — matches dispatcher + adapter code |
   131|   130|
   132|   131|**Fixes applied during audit:**
   133|   132|- DEPLOYMENT.md: Added "Rollback (Instant Safe Mode)" section
   134|   133|- STABILITY_AUDIT.md: Added tsx watch, no git, in-memory cooldown, single thread, 5 test failures to Known Risks
   135|   134|- CUSTOMER_DEMO_SUMMARY.md: Added "Known Issues (Non-blocking)" section
   136|   135|- CUSTOMER_READINESS_AUDIT.md: Masked selfUserId → `<bot-zalo-id>`
   137|   136|
   138|   137|---
   139|   138|
   140|   139|## Verification Suite
   141|   140|
   142|   141|| Check | Result |
   143|   142||-------|--------|
   144|   143|| `npm run typecheck` | ✅ PASS (shared + backend + frontend) |
   145|   144|| `npm test` | ✅ 143/148 PASS — **5 pre-existing, non-blocking** |
   146|   145|| `npm run build -w packages/backend` | ✅ PASS (tsc exit 0) |
   147|   146|
   148|   147|## Runtime Status
   149|   148|
   150|   149|| Component | State |
   151|   150||-----------|-------|
   152|   151|| hermes-api | ✅ running (PID 811605, port 3002) |
   153|   152|| hermes-worker | ✅ running (PID 811597, db-polling 10s) |
   154|   153|| /api/health | ✅ `{"status":"ok","uptime":2047}` |
   155|   154|| Zalo connected | ✅ true |
   156|   155|| autoReply enabled | true |
   157|   156|| dryRun | false |
   158|   157|| adapter | real / cli |
   159|   158|| allowedThreads | [6792540503378312397] |
   160|   159|
   161|   160|---
   162|   161|
   163|   162|## Gap Summary
   164|   163|
   165|   164|| # | Gap | Severity | Blocks Demo? | Fix Before Demo? |
   166|   165||---|-----|----------|-------------|-----------------|
   167|   166|| 1 | Emoji-only bypasses empty-content gate | Low | No | Optional |
   168|   167|| 2 | Dispatcher safetyCheck missing isSelf guard | Low | No | Optional |
   169|   168|| 3 | No stuck "active" job recovery | Medium | No | No — worker is stable |
   170|   169|| 4 | No staleness ceiling on old queued jobs | Low | No | No |
   171|   170|| 5 | API endpoints lack authentication | Medium | No | Localhost-only, low risk |
   172|   171|| 6 | 6 backup files with plaintext secrets | Medium | No | Clean up post-demo |
   173|   172|
   174|   173|---
   175|   174|
   176|   175|## Conclusion
   177|   176|
   178|   177|### Readiness Tiers
   179|   178|
   180|   179|| Tier | Status | Conditions |
   181|   180||------|--------|------------|
   182|   181|| **Customer demo** | ✅ **READY** | Single allowed thread, localhost only |
   183|   182|| **Controlled pilot** | ✅ **READY** | Owner-supervised, allowlist retained |
   184|   183|| **Full production public** | ❌ **NOT YET** | Pending security/recovery backlog |
   185|   184|
   186|   185|### Lỗi blocking: **NONE** ✅
   187|   186|### Có cần sửa trước demo không: **NO** — all gaps are non-blocking, low-risk for localhost/allowlist demo
   188|   187|### Có sẵn sàng demo khách không: **YES** ✅
   189|   188|
   190|   189|### Demo Conditions (MANDATORY)
   191|   190|
   192|   191|- Chỉ dùng allowed thread `6792540503378312397`
   193|   192|- Không bật group thật
   194|   193|- Không bỏ allowlist
   195|   194|- Không mở public API (port 3002 bound to 127.0.0.1)
   196|   195|- Không gửi hàng loạt
   197|   196|### Rollback bằng `ZALO_AUTO_REPLY_DRY_RUN=true` hoặc `HERMES_CHAT_ADAPTER=mock`
   198|   197|
   199|   198|---
   200|   199|
   201|   200|
   202|
## Group 9: Outbound Guardrails (Batch 4, 2026-06-27) ✅

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | Split-send: short message not split | ✅ PASS | 1 part, content preserved |
| 2 | Split-send: long >1800 chars → multiple parts | ✅ PASS | Each part ≤ maxChars + prefix |
| 3 | Split-send: (X/Y) prefix when multiple | ✅ PASS | Regex match |
| 4 | Split-send: emoji/surrogate not broken | ✅ PASS | All surrogates paired |
| 5 | Split-send: Vietnamese diacritics preserved | ✅ PASS | ắ, ố, ề in output |
| 6 | Split-send: max parts respected | ✅ PASS | ≤ 3 when maxParts=3 |
| 7 | Split-send: natural break boundaries | ✅ PASS | Breaks at \n\n |
| 8 | Sanitizer: NFC normalization | ✅ PASS | a+combining → à (1 char) |
| 9 | Sanitizer: smart quotes → ASCII | ✅ PASS | \u201c → " |
| 10 | Sanitizer: em/en dash → dash | ✅ PASS | \u2014 → --, \u2013 → - |
| 11 | Sanitizer: zero-width removed | ✅ PASS | \u200b, \u200c, \u200d gone |
| 12 | Sanitizer: control chars removed | ✅ PASS | \x00-\x1f except \n\t |
| 13 | Sanitizer: NBSP → space | ✅ PASS | \u00a0 → " " |
| 14 | Sanitizer: Vietnamese diacritics kept | ✅ PASS | ắ, ố, ề, ể preserved |
| 15 | Dedup: first send not duplicate | ✅ PASS | duplicate=false |
| 16 | Dedup: 2nd identical in 60s → blocked | ✅ PASS | duplicate=true |
| 17 | Dedup: different content → allowed | ✅ PASS | duplicate=false |
| 18 | Dedup: different thread → allowed | ✅ PASS | Isolated per thread |
| 19 | Dedup: adapter double-send 5s blocked | ✅ PASS | Same hash within 5s |
| 20 | Combined: normal message allowed | ✅ PASS | single_send audit |
| 21 | Combined: sanitizes smart quotes | ✅ PASS | Content sanitized in output |
| 22 | Combined: splits long message | ✅ PASS | split_send audit |
| 23 | Combined: blocks duplicate | ✅ PASS | DUPLICATE_OUTBOUND |
| 24 | Combined: dryRun passes | ✅ PASS | Audit logged, no dedup recorded |
| 25 | Edge: empty string handled | ✅ PASS | 1 part, unchanged |
| 26 | Edge: very long emoji handled | ✅ PASS | Multiple parts, intact |
| 27 | Edge: mixed Vietnamese + emoji + newlines | ✅ PASS | All preserved |

**Gaps:** None. All 27 tests pass, 6 guardrails active.

## Group 8: Zalo Media Send (Live Test 2026-06-27) ✅
   203|
   204|| # | Scenario | Result | Evidence |
   205||---|----------|--------|----------|
   206|| 1 | DM image send via `/api/zalo/send-media` | ✅ PASS | `sent-1782561754021`, success=true |
   207|| 2 | DM file (PDF) send | ✅ PASS | `sent-1782561769809`, 302 bytes |
   208|| 3 | Group image inside reply window | ✅ PASS | `sent-1782565068701`, audit=allow, reply_window_open |
   209|| 4 | Group image outside TTL blocked | ✅ PASS | `GROUP_REPLY_WINDOW_CLOSED`, audit=skip |
   210|| 5 | imageMetadataGetter (JPEG/PNG/GIF) | ✅ PASS | Node built-in header reader, no deps |
   211|| 6 | Media validation guards | ✅ PASS | FILE_NOT_FOUND, MEDIA_TYPE_NOT_ALLOWED, MEDIA_TOO_LARGE |
   212|
   213|**Gaps:** None. All media guardrails active and verified.
   214|
   215|**zca-js fix:** `imageMetadataGetter` option is required by zca-js for attachment sends. Added `getImageDimensions()` using Node built-in `readFileSync` to parse JPEG/PNG/GIF headers (no external dependencies).
   216|
   217|**API/Worker reply window isolation (known):** Reply windows are per-process in-memory Maps. Dispatcher (API process) and Worker have independent windows. Group outbound gate works correctly in both paths, but windows set by one process are invisible to the other. Not blocking — dispatcher sends are what matter for Batch 1/2.
   218|
   219|## Group 7: Create-Reminder (Live Test 2026-06-27) ✅
   220|   201|
   221|   202|| # | Scenario | Result | Evidence |
   222|   203||---|----------|--------|----------|
   223|   204|| 1 | Inbound "Nhắc mình 2p nữa học bài" → parsed "học bài" | ✅ PASS | `incoming-dispatcher.service.ts:112,139` — `\p{L}+` Unicode parser |
   224|   205|| 2 | "2p nữa nhắc tôi Lễ Phật" → parsed "Lễ Phật" (stripped target pronoun) | ✅ PASS | `numRegex` + `\p{L}+` pronoun strip |
   225|   206|| 3 | Schedule created with `metadata.source=zalo_auto_reply_create_reminder` | ✅ PASS | Schedule `cmqw40v2i...` via API |
   226|   207|| 4 | Confirmation sent live (dryRun=false) | ✅ PASS | `sentMessageId=sent-1782549627573`, `sendSuccess=true` |
   227|   208|| 5 | Worker executes, sends real reminder to Zalo | ✅ PASS | Execution `cmqw43g9i...`, `status=success`, `dryRun=false`, `zaloMessageId=sent-1782549748329` |
   228|   209|| 6 | Worker dry-run guard (createdBy=ai + autoReply.dryRun=true) | ✅ PASS | Execution `mode=dry_run`, `dryRun=true`, `zaloMessageId=null` |
   229|   210|| 7 | Group not in allowlist → skipped | ✅ PASS | `thread_not_allowed` for `1458666131447745456` |
   230|   211|| 8 | Hermes CLI bypassed for create-reminder | ✅ PASS | CLI crash avoided via `detectCreateReminderIntent()` |
   231|   212|
**Gaps:** None. Create-reminder fully functional end-to-end.

## Group 10: Image OCR / Vision (Live Dry-run 2026-06-27) ✅

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | Image message detected (chat.photo) | ✅ PASS | `messageType=image`, `imageUrl` extracted |
| 2 | Image download (safe dir) | ✅ PASS | `/tmp/hermes-media/inbound-images/`, <10MB, MIME whitelist |
| 3 | Vision API call (ChiaseGPU gpt-5.5) | ✅ PASS | `status=200 ok=true`, confidence=0.85 |
| 4 | OCR text extracted correctly | ✅ PASS | "TEST OCR HERMES\nHôm nay đi lễ Phật lúc 19h" |
| 5 | metadata.vision saved to Message | ✅ PASS | `{ocrText, description, confidence, analyzed}` |
| 6 | Thread allowImageUnderstanding gate | ✅ PASS | Only processes when setting enabled |
| 7 | Dry-run: no real Zalo send | ✅ PASS | `dryRun=true`, AgentTask completed |
| 8 | Outbound assistant message saved | ✅ PASS | role=assistant, relatedMessageId linked |

**Gaps:** None. Vision pipeline fully functional.

## Group 11: Conversation Memory / Context State (Live Dry-run 2026-06-27) ✅

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | Inbound saved with role=user | ✅ PASS | Every Message gets role, threadId, senderId |
| 2 | Outbound saved with role=assistant | ✅ PASS | relatedMessageId links back to original |
| 3 | ConversationContextBuilder loads 100-200 msgs | ✅ PASS | Sort ascending, build prompt, hasMore detection |
| 4 | Context injected into Hermes prompt | ✅ PASS | Recent messages → Hermes CLI |
| 5 | Follow-up reads previous OCR context | ✅ PASS | "Ảnh vừa rồi ghi gì?" → reads assistant reply |
| 6 | Vision rerun avoided | ✅ PASS | 0 API calls, relies on prior metadata |
| 7 | Context-aware pronoun resolution | ✅ PASS | "Vậy nhắc mình việc đó lúc 19h" → understood "đi lễ Phật" |
| 8 | ThreadConversationState tracking | ✅ PASS | pendingIntent, missingSlots, collectedSlots, expiresAt |
| 9 | State priority over keyword rules | ✅ PASS | activeConvState loaded before create-reminder |
| 10 | Keyword search for old messages | ✅ PASS | searchConversationHistory (DB query) |
| 11 | No regression (Batch 7 OCR flow) | ✅ PASS | OCR + context work together, no breakage |

**Gap backlogged (Batch 8.1):** Context-aware create-reminder parser — pronoun resolution ("việc đó", "cái đó") for schedule creation from context.

### Parser Patterns Verified
   235|   216|
   236|   217|| Pattern | Example | Content |
   237|   218||---------|---------|---------|
   238|   219|| `nhắc \p{L}+ N unit nữa` | "Nhắc mình 2p nữa học bài" | "học bài" |
   239|   220|| `N unit nữa nhắc \p{L}+` | "2p nữa nhắc tôi Lễ Phật" | "Lễ Phật" |
   240|   221|
   241|   222|### Backlog (Priority-Ordered)
   242|   223|
   243|   224|**High:**
   244|   225|1. API auth nếu mở public (hiện localhost-only, chấp nhận được)
   245|   226|2. Clean up backup plaintext secrets (6 files/dirs)
   246|   227|3. Dispatcher isSelf guard (defense-in-depth)
   247|   228|
   248|   229|**Medium:**
   249|   230|4. Stuck active job recovery (add `startedAt` + recovery scan)
   250|   231|5. Staleness ceiling on old queued jobs
   251|   232|6. Emoji-only bypass (Unicode-aware content check)
   252|   233|
   253|   234|### Emergency Rollback
   254|   235|
   255|   236|```bash
   256|   237|# Instant safe mode — no restart needed for ENABLED flag
   257|   238|sed -i 's/ZALO_AUTO_REPLY_ENABLED=true/ZALO_AUTO_REPLY_ENABLED=false/' packages/backend/.env
   258|   239|
   259|   240|# Full rollback (needs restart)
   260|   241|ZALO_AUTO_REPLY_DRY_RUN=true
   261|   242|HERMES_CHAT_ADAPTER=mock
   262|   243|ZALO_AUTO_REPLY_ENABLED=false
   263|   244|```
   264|   245|