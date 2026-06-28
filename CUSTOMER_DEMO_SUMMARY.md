     1|# Customer Demo Summary — Hermes Zalo Control Center
     2|
     3|> **Date:** 2026-06-27 (updated Batch 8)
     4|> **Readiness:** ✅ Customer demo READY | ✅ Controlled pilot READY | ❌ Full production NOT YET
     5|> **Scope:** Single allowed thread (6792540503378312397)
     6|> **Last verified:** Batch 8.1 Context-aware Reminder — live dry-run ALL PASS
     7|     7|     7|
     8|     8|     8|## Current State
     9|     9|     9|
    10|    10|    10|A full pipeline is running: **Zalo user → Hermes AI (DeepSeek v4 Pro) → auto-reply back to Zalo**.
    11|    11|    11|
    12|### What Works
    13|
    14|- Zalo auto-restore on startup (no QR re-scan)
    15|- Incoming message listener via zca-js
    16|- **Create-Reminder pipeline** — natural language → parsed + schedule created → confirmation sent → worker sends reminder at due time
    17|- Real Hermes AI chat via CLI (spawn shell=false, 8-15s latency)
    18|- **Conversation Memory** — every message saved with role=user/assistant, context loaded from DB before Hermes reply
    19|- **Image OCR / Understanding** — OCR text + image description via ChiaseGPU vision API
    20|- **ThreadConversationState** — multi-turn pending intent tracking (weather_location, clarification)
    21|- Auto-reply dispatches to allowed threads only
    22|- Cooldown (10s per thread)
    23|- Full AgentTask audit trail (every action logged)
    24|- Safety gates: enabled switch, dry-run switch, allowlist, cooldown, anti-loop, dedup
    25|- Worker / schedule system unaffected by chat pipeline
    26|    23|    23|
    27|    24|    24|### Live Test Confirmed
    28|    25|    25|
    29|    26|    26|| Task ID | User Message | Hermes Reply |
    30|    27|    27||---------|-------------|--------------|
    31|    28|    28|| `cmqtna0hr` | "Trả lời tui đi" | "Chào bạn! 👋 Mình đây, sẵn sàng trả lời nè..." |
    32|    29|    29|| `cmqtnayp0` | "Bạn có biết link để kiểm soát bằng ui không" | "Dạ có ạ! Admin Center chạy ở: http://localhost:3001..." |
    33|    30|    30|| `cmqw40v29` | "Nhắc mình 2p nữa học bài" | "✅ Đã đặt lịch nhắc: \"học bài\" sau 2 p nữa. Lịch ID: cmqw40v2..." |
    34|    31|    31|
    35|    32|    32|First two: AI chat replies. Third: **Create-Reminder** — confirmation sent (`sent-1782549627573`), reminder sent at due time (`sent-1782549748329`), dryRun=false, execution status=success.
    36|    33|    33|
    37|    34|    34|Both AI chat and Create-Reminder: `dryRun=false`, `sentMessageId` confirmed.
    38|    35|
    39|### Batch 4: Outbound Guardrails (2026-06-27)
    40|
    41|| Guardrail | Status | Detail |
    42||-----------|--------|--------|
    43|| Split-send (>1800 chars) | ✅ PASS | Safe Unicode/emoji/surrogate split, (X/Y) prefix, max 5 parts |
    44|| Unicode sanitizer | ✅ PASS | NFC normalize, smart quotes, zero-width, NBSP, control chars removed |
    45|| Outbound dedup | ✅ PASS | SHA-256 hash, 60s same-content TTL, 5s adapter double-send TTL |
    46|| Sent-context memory | ✅ PASS | OutboundRecord DB table, save/get for Hermes context |
    47|| Outbound audit | ✅ PASS | Standardized JSON log: decision, reason, source, contentHash |
    48|| Rate limit (per-thread) | ✅ PASS | Integrated with guardrails, RATE_LIMITED errorCode |
    49|
    50|**All 6 guardrails active.** Dedup in-memory + DB-backed sent-context. Outbound audit logs to console for grep/aggregation.
    51|
    52|### Batch 5: Reaction + Auto-React (2026-06-27)
    53|
    54|| Test | Result | Detail |
    55||------|--------|--------|
    56|| Inbound reaction detection | ✅ PASS | zca-js listener.on("reaction") |
    57|| Auto-react to eligible messages | ✅ PASS | ❤️ heart reaction, dry-run aware |
    58|| Reaction safety gates | ✅ PASS | Self, disabled, allowlist, mention, cooldown |
    59|| DM reaction inside TTL | ✅ PASS | Audit: allow, reason=reply_window_open |
    60|| 17 tests | ✅ PASS | zalo-reaction.test.ts |
    61|
    62|### Batch 6: Voice/TTS (2026-06-27)
    63|
    64|| Component | Status | Detail |
    65||-----------|--------|--------|
    66|| TTS generation (edge-tts) | ✅ PASS | Text → MP3, validates length/empty/failure |
    67|| M4A conversion (FFmpeg) | ✅ PASS | AAC 44100Hz 64k mono +faststart |
    68|| DM voice send via API | ✅ PASS | TTS → M4A → uploadAttachment → sendVoice |
    69|| Group voice inside TTL | ✅ PASS | Reply window gate: allow |
    70|| Group voice outside TTL | ✅ PASS | Reply window gate: block (GROUP_REPLY_WINDOW_CLOSED) |
    71|| **Native Zalo voice playback** | ❌ UNSTABLE | Voice bubble shows `--:--` duration, cannot play |
    72|| **Feature flag** | `ZALO_VOICE_ENABLED=false` (default) | API returns VOICE_NOT_SUPPORTED when disabled |
    73|| **Future plan** | Fallback to file attachment | Send audio as downloadable file instead of voice bubble |
    74|
    75|**Voice note:** TTS file generation and API pipeline work correctly, but native Zalo voice playback via zca-js `sendVoice()` is unreliable (duration shows `--:--`, audio not audible). Feature disabled by default. Future: send audio as file attachment for reliable delivery.
    76|
    77|### Batch 7: Image OCR / Understanding (2026-06-27)
    78|
    79|| Component | Status | Detail |
    80||-----------|--------|--------|
    81|| Image download (safe dir) | ✅ PASS | `/tmp/hermes-media/inbound-images/`, size <10MB, MIME whitelist |
    82|| Vision API (ChiaseGPU gpt-5.5) | ✅ PASS | OCR + description, Vietnamese-capable |
    83|| OCR text extraction | ✅ PASS | `📷 Mô tả ảnh` + `📝 Chữ trong ảnh` separated |
    84|| Vision metadata saved to Message | ✅ PASS | `metadata.vision.{ocrText,description,confidence,analyzed}` |
    85|| Thread allowImageUnderstanding gate | ✅ PASS | Per-thread setting, default false |
    86|| Group @mention required + TTL | ✅ PASS | Image only processed on mention, within reply window |
    87|| Dry-run aware | ✅ PASS | `dryRun=true` skips real send, AgentTask audit preserved |
    88|| **Live dry-run test** | ✅ **PASS** | OCR "TEST OCR HERMES\nHôm nay đi lễ Phật lúc 19h" → correct |
    89|
    90|**OCR pipeline:** Zalo photo → download (safe dir) → ChiaseGPU vision API → reply with description + OCR → metadata saved to DB Message for future context.
    91|
    92|### Batch 8: Conversation Memory / Context State (2026-06-27)
    93|
    94|| Component | Status | Detail |
    95||-----------|--------|--------|
    96|| Inbound Message.role=user | ✅ PASS | Every inbound saved with role, threadId, senderId |
    97|| Outbound Message.role=assistant | ✅ PASS | Every reply saved with relatedMessageId backlink |
    98|| ConversationContextBuilder | ✅ PASS | Load recent 100-200 messages, sort ascending, build prompt |
    99|| ThreadConversationState | ✅ PASS | pendingIntent, missingSlots, collectedSlots, expiresAt (5 min TTL) |
   100|| Context injected into Hermes prompt | ✅ PASS | Recent messages + state context → Hermes CLI |
   101|| OCR metadata reuse (no rerun) | ✅ PASS | Follow-up "Ảnh vừa rồi ghi gì?" reads from assistant reply |
   102|| Context-aware multi-turn | ✅ PASS | "Vậy nhắc mình việc đó lúc 19h" → understood "đi lễ Phật" |
   103|| State priority over keyword rules | ✅ PASS | `activeConvState` loaded before create-reminder detection |
   104|| Conversation state detection | ✅ PASS | weather_location, awaiting_clarification auto-detected |
   105|| Search (keyword) | ✅ PASS | `searchConversationHistory` for messages beyond context window |
   106|| **Live dry-run context test** | ✅ **PASS** | 3-step: OCR → follow-up → context reminder — ALL PASS |
   107|
   108|**Conversation architecture:** Inbound (role=user) → DB → Context Builder (100 msgs) → Hermes CLI prompt → Reply (role=assistant saved with relatedMessageId). OCR metadata flows through Message table. ThreadConversationState tracks pending multi-turn intents with 5-min TTL.
   109|
   110|**Gap backlogged:** Context-aware create-reminder parser (Batch 8.1) — "việc đó / cái đó" pronoun resolution for schedule creation.
   111|
   112|### Batch 8.1: Context-aware Reminder Parser (2026-06-28)
   113|
   114|| Component | Status | Detail |
   115||-----------|--------|--------|
   116|| Pronoun detection | ✅ PASS | "việc đó", "cái đó", "chuyện đó", "nội dung đó", "việc ấy", "cái ấy", "chuyện ấy" |
   117|| Time parsing | ✅ PASS | "lúc 19h", "7h tối", "X phút nữa" |
   118|| Context resolution | ✅ PASS | OCR text → assistant reply → user message (3-tier priority) |
   119|| Schedule creation from context | ✅ PASS | Schedule + Job created, content from OCR/context |
   120|| No-context fallback | ✅ PASS | Ask clarification instead of guessing |
   121|| Dry-run aware | ✅ PASS | `dryRun=true` skips real send |
   122|| **Live dry-run test** | ✅ **PASS** | "Vậy nhắc mình việc đó lúc 19h" → schedule "đi lễ Phật" at 19h |
   123|| Create-reminder regression | ✅ PASS | Classic pattern still works, no interference |
   124|
   125|**Context flow:** OCR image → metadata.vision.ocrText → user says "nhắc mình việc đó lúc X" → detect pronoun → resolve from DB (OCR > assistant > user) → create schedule with correct content.
   126|
   127|**Cleanup backlogged:** Content trimming — raw OCR may include header lines ("TEST OCR HERMES"). Production should extract the actionable item ("đi lễ Phật").
   128|
   129|### Batch 2: Zalo Media Send (Live Test 2026-06-27)
   130|    36|
   131|    37|| Test | Result | Detail |
   132|    38||------|--------|--------|
   133|    39|| DM image `.jpg` + caption | ✅ PASS | `sent-1782561754021` |
   134|    40|| DM file `.pdf` + caption | ✅ PASS | `sent-1782561769809` |
   135|    41|| Group image inside reply window | ✅ PASS | `sent-1782565068701`, audit=allow, reason=reply_window_open |
   136|    42|| Group image outside TTL blocked | ✅ PASS | `GROUP_REPLY_WINDOW_CLOSED`, audit=skip |
   137|    43|
   138|    44|**Media guardrails active:**
   139|    45|- `FILE_NOT_FOUND`, `MEDIA_TYPE_NOT_ALLOWED`, `MEDIA_TOO_LARGE`
   140|    46|- `DRY_RUN`, `GROUP_REPLY_WINDOW_CLOSED`, `RATE_LIMITED`
   141|    47|- `ZALO_NOT_CONNECTED` with auto-restore fallback
   142|    48|- `imageMetadataGetter` fixed (JPEG/PNG/GIF header reader, no deps)
   143|    49|- Audit log: allow/skip with structured reason per request
   144|    50|- Duplicate send: NO
   145|    51|
   146|    52|    35|
   147|    53|    36|## How to Demo Zalo Chat
   148|    54|    37|
   149|    55|    38|1. **Confirm system is running:**
   150|    56|    39|   ```bash
   151|    57|    40|   curl -s -u admin:<password> http://127.0.0.1:3002/api/zalo/status
   152|    58|    41|   # → {"connected":true, ...}
   153|    59|    42|   ```
   154|    60|    43|
   155|    61|    44|2. **Send a Zalo message** to the bot from the allowed thread (6792540503378312397)
   156|    62|    45|
   157|    63|    46|3. **Wait 8-15s** — Hermes AI generates reply and sends back to Zalo
   158|    64|    47|
   159|    65|    48|4. **Verify in DB:**
   160|    66|    49|   ```bash
   161|    67|    50|   sqlite3 packages/backend/prisma/dev.db "SELECT id, status, json_extract(result, '$.reply') FROM AgentTask ORDER BY createdAt DESC LIMIT 3;"
   162|    68|    51|   ```
   163|    69|    52|
   164|    70|    53|## Health Checks
   165|    71|    54|
   166|    72|    55|```bash
   167|    73|    56|ADMIN_PASS=$(grep ADMIN_PASSWORD packages/backend/.env | cut -d= -f2)
   168|    74|    57|
   169|    75|    58|# Overall health
   170|    76|    59|curl -s -u "admin:${ADMIN_PASS}" http://127.0.0.1:3002/api/health
   171|    77|    60|
   172|    78|    61|# Zalo connection
   173|    79|    62|curl -s -u "admin:${ADMIN_PASS}" http://127.0.0.1:3002/api/zalo/status
   174|    80|    63|
   175|    81|    64|# Worker status
   176|    82|    65|curl -s -u "admin:${ADMIN_PASS}" http://127.0.0.1:3002/api/worker/status
   177|    83|    66|
   178|    84|    67|# Auto-reply pipeline (enabled, dryRun, allowedThreads, activeCooldowns)
   179|    85|    68|curl -s -u "admin:${ADMIN_PASS}" http://127.0.0.1:3002/api/agent/auto-reply/status
   180|    86|    69|```
   181|    87|    70|
   182|    88|    71|## How to Enable / Disable Auto-Reply
   183|    89|    72|
   184|    90|    73|### Enable (live mode)
   185|    91|    74|```bash
   186|    92|    75|# Edit packages/backend/.env:
   187|    93|    76|ZALO_AUTO_REPLY_ENABLED=true
   188|    94|    77|ZALO_AUTO_REPLY_DRY_RUN=false
   189|    95|    78|HERMES_CHAT_ADAPTER=real
   190|    96|    79|HERMES_CHAT_MODE=cli
   191|    97|    80|
   192|    98|    81|# Restart
   193|    99|    82|pkill -f "tsx.*src/index.ts"
   194|   100|    83|pkill -f "tsx.*src/workers/index.ts"
   195|   101|    84|sleep 2
   196|   102|    85|cd packages/backend
   197|   103|    86|npx tsx src/workers/index.ts &
   198|   104|    87|npx tsx src/index.ts &
   199|   105|    88|```
   200|   106|    89|
   201|   107|    90|### Disable (safe mode)
   202|   108|    91|```bash
   203|   109|    92|# Edit packages/backend/.env:
   204|   110|    93|ZALO_AUTO_REPLY_ENABLED=false
   205|   111|    94|```
   206|   112|    95|
   207|   113|    96|No restart needed — dispatcher reads config on each message.
   208|   114|    97|
   209|   115|    98|## Rollback to Mock / Dry-Run
   210|   116|    99|
   211|   117|   100|```bash
   212|   118|   101|# Edit packages/backend/.env:
   213|   119|   102|HERMES_CHAT_ADAPTER=mock        # Echo replies instead of AI
   214|   120|   103|ZALO_AUTO_REPLY_DRY_RUN=true    # Process but don't send to Zalo
   215|   121|   104|
   216|   122|   105|# Restart (see above)
   217|   123|   106|```
   218|   124|   107|
   219|   125|   108|## Safety Limits (DO NOT REMOVE)
   220|   126|   109|
   221|   127|   110|| Limit | Value | Reason |
   222|   128|   111||-------|-------|--------|
   223|   129|   112|| Allowlist | Only thread 6792540503378312397 | Prevents mass auto-reply |
   224|   130|   113|| Cooldown | 10s per thread | Prevents spam |
   225|   131|   114|| Dry-run switch | `ZALO_AUTO_REPLY_DRY_RUN` | Instant rollback to safe mode |
   226|   132|   115|| Group auto-reply | NOT enabled | Requires owner approval |
   227|   133|   116|| Adapter default | Mock (echo) | Safe fallback if endpoint down |
   228|   134|   117|
   229|   135|   118|## Demo Conditions (MANDATORY)
   230|   136|   119|
   231|   137|   120|- ⚠️ Chỉ dùng allowed thread `6792540503378312397`
   232|   138|   121|- ⚠️ Không bật group thật
   233|   139|   122|- ⚠️ Không bỏ allowlist
   234|   140|   123|- ⚠️ Không mở public API (port 3002 bound to 127.0.0.1)
   235|   141|   124|- ⚠️ Không gửi hàng loạt
   236|   142|   125|- ⚠️ Rollback khẩn cấp: `ZALO_AUTO_REPLY_DRY_RUN=true` hoặc `HERMES_CHAT_ADAPTER=mock`
   237|   143|   126|
   238|   144|   127|## Readiness Tiers
   239|   145|   128|
   240|   146|   129|| Tier | Status |
   241|   147|   130||------|--------|
   242|   148|   131|| Customer demo | ✅ READY |
   243|   149|   132|| Controlled pilot | ✅ READY |
   244|   150|   133|| Full production public | ❌ NOT YET — pending security/recovery backlog |
   245|   151|   134|
   246|   152|   135|## Architecture (Simplified)
   247|   153|   136|
   248|   154|   137|```
   249|   155|   138|Zalo App
   250|   156|   139|  ↓ message
   251|   157|   140|zca-js Listener
   252|   158|   141|  ↓
   253|   159|   142|saveIncomingMessage (DB)
   254|   160|   143|  ↓
   255|   161|   144|IncomingDispatcher
   256|   162|   145|  ├─ enabled? allowlist? cooldown? content?
   257|   163|   146|  ↓
   258|   164|   147|RealHermesChatAdapter (CLI)
   259|   165|   148|  ├─ spawn hermes chat -q "<prompt>" -Q
   260|   166|   149|  ↓
   261|   167|   150|Hermes Agent (DeepSeek v4 Pro)
   262|   168|   151|  ↓ reply
   263|   169|   152|ZaloMessageSender
   264|   170|   153|  ↓
   265|   171|   154|AgentTask: completed (audit)
   266|   172|   155|  ↓
   267|   173|   156|Reply arrives on Zalo App
   268|   174|   157|```
   269|   175|   158|
   270|   176|   159|## Production Backlog (post-demo)
   271|   177|   160|
   272|   178|   161|| Item | Priority | Note |
   273|   179|   162||------|----------|------|
   274|   180|   163|| API authentication | **High** | agent/zalo routes unauthenticated (localhost-only for now) |
   275|   181|   164|| Clean up backup secrets | **High** | 6 backup files/dirs with plaintext passwords |
   276|   182|   165|| Dispatcher isSelf guard | **High** | Defense-in-depth (gateway handles it upstream) |
   277|   183|   166|| Stuck "active" job recovery | Medium | Add `startedAt` + recovery scan |
   278|   184|   167|| Old job staleness ceiling | Medium | Prevent ancient jobs firing on restart |
   279|   185|   168|| Emoji-only content bypass | Medium | Unicode-aware check for empty-content gate |
   280|   186|   169|| Git version control | Medium | VPS has no `.git/` — plain filesystem |
   281|   187|   170|| `node dist` instead of `tsx watch` | Medium | For production stability |
   282|   188|   171|| PM2 / systemd | Medium | Auto-restart, `pm2 save`, reboot survival |
   283|   189|   172|| Cooldown → DB/Redis | Low | In-memory resets on restart |
   284|   190|   173|| Multi-thread allowlist | Low | Currently single thread only |
   285|   191|   174|| Backup automation | Low | DB + zalo-session + .env |
   286|   192|   175|| Monitoring / alerts | Low | Uptime, Zalo disconnect, Hermes errors |
   287|   193|   176|
   288|   194|   177|## Known Issues (Non-blocking)
   289|   195|   178|
   290|   196|   179|5 pre-existing test failures (143/148 pass, 95.8% critical path pass rate). All non-blocking:
   291|   197|   180|- 3× `ZALO_DRY_RUN=true` mismatch (tests written for dev, VPS runs `dryRun=false` production)
   292|   198|   181|- 2× Vietnamese diacritic normalization gap (cosmetic — does not affect schedule creation)
   293|   199|   182|- See `CUSTOMER_READINESS_AUDIT.md` for full details.
   294|   200|   183|
   295|   201|   184|## Contact / Admin
   296|   202|   185|
   297|   203|   186|- **Web UI:** https://<domain-cua-ban> (Cloudflare Tunnel)
   298|   204|   187|- **Admin UI (local):** http://localhost:3001
   299|   205|   188|- **Login:** admin / (see `.env` ADMIN_PASSWORD)
   300|   206|   189|- **Backend port:** 3002
   301|   207|   190|- **Worker:** db-polling every 10s
   302|   208|   191|- **Hermes CLI:** `~/ai-agents/hermes-agent/venv/bin/hermes`
   303|   209|   192|
   304|   210|   193|### Cloudflare Tunnel (2026-06-25)
   305|   211|   194|
   306|   212|   195|| Item | Value |
   307|   213|   196||------|-------|
   308|   214|   197|| Public URL | `https://<domain-cua-ban>` |
   309|   215|   198|| Tunnel | Cloudflare Named Tunnel (cloudflared) |
   310|   216|   199|| Frontend target | `http://127.0.0.1:3001` |
   311|   217|   200|| Backend API | `http://127.0.0.1:3002` (not exposed — /api/* via Next.js rewrite) |
   312|   218|   201|| Ports 3001/3002 | Private localhost only |
   313|   219|   202|| Status | ✅ Active |
   314|   220|   203|
   315|---
   316|
   317|### Batch 11 — Rule Engine UI (2026-06-28)
   318|- ✅ Rule Engine CRUD UI at /rules
   319|- ✅ 10 API endpoints (CRUD, enable/disable, versioning, test)
   320|- ✅ Pipeline integration: runs after safety gates, before Hermes fallback
   321|- ✅ 34 tests PASS
   322|
   323|### Batch 11.1 — Live-safe Rule Engine Test (2026-06-28)
   324|- ✅ Full test suite 464/464 PASS, backend/frontend build PASS
   325|
   326|### Cooldown Live Dry-Run Test (2026-06-28)
   327|- ✅ Messages received: 2 (delta ~2.97s within 10s cooldown)
   328|- ✅ Message 1 processed, Message 2 skipped by cooldown
   329|- ✅ AgentTasks: 1, Hermes calls: 1, Real Zalo send: NO, Duplicate: NO
   330|
   331|### Cooldown Skip Audit Mini-fix (2026-06-28)
   332|- ✅ OutboundRecord decision=block, reason=cooldown on skip
   333|- ✅ No schema change (reused existing OutboundRecord)
   334|- ✅ 5 new tests, full suite: 469/469 PASS
   335|
   336|### Batch 12 — Docling Document Understanding (2026-06-28)
   337|- ✅ Document ingestion API + UI at /documents
   338|- ⚠️ Docling OOM: isolated to docling binary, skip by default (DOC_TEST=1)
   339|

---

### Batch 11 — Rule Engine UI (2026-06-28)
- ✅ Rule Engine CRUD UI at /rules
- ✅ 10 API endpoints (CRUD, enable/disable, versioning, test)
- ✅ Pipeline integration: runs after safety gates, before Hermes fallback
- ✅ 34 tests PASS

### Batch 11.1 — Live-safe Rule Engine Test (2026-06-28)
- ✅ Full test suite 464/464 PASS, backend/frontend build PASS

### Cooldown Live Dry-Run Test (2026-06-28)
- ✅ Messages received: 2 (delta ~2.97s within 10s cooldown)
- ✅ Message 1 processed, Message 2 skipped by cooldown
- ✅ AgentTasks: 1, Hermes calls: 1, Real Zalo send: NO, Duplicate: NO

### Cooldown Skip Audit Mini-fix (2026-06-28)
- ✅ OutboundRecord decision=block, reason=cooldown on skip
- ✅ No schema change (reused existing OutboundRecord)
- ✅ 5 new tests, full suite: 469/469 PASS

### Batch 12 — Docling Document Understanding (2026-06-28)
- ✅ Document ingestion API + UI at /documents
- ⚠️ Docling OOM: isolated to docling binary, skip by default (DOC_TEST=1)
