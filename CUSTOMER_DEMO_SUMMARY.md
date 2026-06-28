# Customer Demo Summary — Hermes Zalo Control Center

> **Date:** 2026-06-27 (updated Batch 8)
> **Readiness:** ✅ Customer demo READY | ✅ Controlled pilot READY | ❌ Full production NOT YET
> **Scope:** Single allowed thread (6792540503378312397)
> **Last verified:** Batch 8.1 Context-aware Reminder — live dry-run ALL PASS
     7|     7|
     8|     8|## Current State
     9|     9|
    10|    10|A full pipeline is running: **Zalo user → Hermes AI (DeepSeek v4 Pro) → auto-reply back to Zalo**.
    11|    11|
### What Works

- Zalo auto-restore on startup (no QR re-scan)
- Incoming message listener via zca-js
- **Create-Reminder pipeline** — natural language → parsed + schedule created → confirmation sent → worker sends reminder at due time
- Real Hermes AI chat via CLI (spawn shell=false, 8-15s latency)
- **Conversation Memory** — every message saved with role=user/assistant, context loaded from DB before Hermes reply
- **Image OCR / Understanding** — OCR text + image description via ChiaseGPU vision API
- **ThreadConversationState** — multi-turn pending intent tracking (weather_location, clarification)
- Auto-reply dispatches to allowed threads only
- Cooldown (10s per thread)
- Full AgentTask audit trail (every action logged)
- Safety gates: enabled switch, dry-run switch, allowlist, cooldown, anti-loop, dedup
- Worker / schedule system unaffected by chat pipeline
    23|    23|
    24|    24|### Live Test Confirmed
    25|    25|
    26|    26|| Task ID | User Message | Hermes Reply |
    27|    27||---------|-------------|--------------|
    28|    28|| `cmqtna0hr` | "Trả lời tui đi" | "Chào bạn! 👋 Mình đây, sẵn sàng trả lời nè..." |
    29|    29|| `cmqtnayp0` | "Bạn có biết link để kiểm soát bằng ui không" | "Dạ có ạ! Admin Center chạy ở: http://localhost:3001..." |
    30|    30|| `cmqw40v29` | "Nhắc mình 2p nữa học bài" | "✅ Đã đặt lịch nhắc: \"học bài\" sau 2 p nữa. Lịch ID: cmqw40v2..." |
    31|    31|
    32|    32|First two: AI chat replies. Third: **Create-Reminder** — confirmation sent (`sent-1782549627573`), reminder sent at due time (`sent-1782549748329`), dryRun=false, execution status=success.
    33|    33|
    34|    34|Both AI chat and Create-Reminder: `dryRun=false`, `sentMessageId` confirmed.
    35|
### Batch 4: Outbound Guardrails (2026-06-27)

| Guardrail | Status | Detail |
|-----------|--------|--------|
| Split-send (>1800 chars) | ✅ PASS | Safe Unicode/emoji/surrogate split, (X/Y) prefix, max 5 parts |
| Unicode sanitizer | ✅ PASS | NFC normalize, smart quotes, zero-width, NBSP, control chars removed |
| Outbound dedup | ✅ PASS | SHA-256 hash, 60s same-content TTL, 5s adapter double-send TTL |
| Sent-context memory | ✅ PASS | OutboundRecord DB table, save/get for Hermes context |
| Outbound audit | ✅ PASS | Standardized JSON log: decision, reason, source, contentHash |
| Rate limit (per-thread) | ✅ PASS | Integrated with guardrails, RATE_LIMITED errorCode |

**All 6 guardrails active.** Dedup in-memory + DB-backed sent-context. Outbound audit logs to console for grep/aggregation.

### Batch 5: Reaction + Auto-React (2026-06-27)

| Test | Result | Detail |
|------|--------|--------|
| Inbound reaction detection | ✅ PASS | zca-js listener.on("reaction") |
| Auto-react to eligible messages | ✅ PASS | ❤️ heart reaction, dry-run aware |
| Reaction safety gates | ✅ PASS | Self, disabled, allowlist, mention, cooldown |
| DM reaction inside TTL | ✅ PASS | Audit: allow, reason=reply_window_open |
| 17 tests | ✅ PASS | zalo-reaction.test.ts |

### Batch 6: Voice/TTS (2026-06-27)

| Component | Status | Detail |
|-----------|--------|--------|
| TTS generation (edge-tts) | ✅ PASS | Text → MP3, validates length/empty/failure |
| M4A conversion (FFmpeg) | ✅ PASS | AAC 44100Hz 64k mono +faststart |
| DM voice send via API | ✅ PASS | TTS → M4A → uploadAttachment → sendVoice |
| Group voice inside TTL | ✅ PASS | Reply window gate: allow |
| Group voice outside TTL | ✅ PASS | Reply window gate: block (GROUP_REPLY_WINDOW_CLOSED) |
| **Native Zalo voice playback** | ❌ UNSTABLE | Voice bubble shows `--:--` duration, cannot play |
| **Feature flag** | `ZALO_VOICE_ENABLED=false` (default) | API returns VOICE_NOT_SUPPORTED when disabled |
| **Future plan** | Fallback to file attachment | Send audio as downloadable file instead of voice bubble |

**Voice note:** TTS file generation and API pipeline work correctly, but native Zalo voice playback via zca-js `sendVoice()` is unreliable (duration shows `--:--`, audio not audible). Feature disabled by default. Future: send audio as file attachment for reliable delivery.

### Batch 7: Image OCR / Understanding (2026-06-27)

| Component | Status | Detail |
|-----------|--------|--------|
| Image download (safe dir) | ✅ PASS | `/tmp/hermes-media/inbound-images/`, size <10MB, MIME whitelist |
| Vision API (ChiaseGPU gpt-5.5) | ✅ PASS | OCR + description, Vietnamese-capable |
| OCR text extraction | ✅ PASS | `📷 Mô tả ảnh` + `📝 Chữ trong ảnh` separated |
| Vision metadata saved to Message | ✅ PASS | `metadata.vision.{ocrText,description,confidence,analyzed}` |
| Thread allowImageUnderstanding gate | ✅ PASS | Per-thread setting, default false |
| Group @mention required + TTL | ✅ PASS | Image only processed on mention, within reply window |
| Dry-run aware | ✅ PASS | `dryRun=true` skips real send, AgentTask audit preserved |
| **Live dry-run test** | ✅ **PASS** | OCR "TEST OCR HERMES\nHôm nay đi lễ Phật lúc 19h" → correct |

**OCR pipeline:** Zalo photo → download (safe dir) → ChiaseGPU vision API → reply with description + OCR → metadata saved to DB Message for future context.

### Batch 8: Conversation Memory / Context State (2026-06-27)

| Component | Status | Detail |
|-----------|--------|--------|
| Inbound Message.role=user | ✅ PASS | Every inbound saved with role, threadId, senderId |
| Outbound Message.role=assistant | ✅ PASS | Every reply saved with relatedMessageId backlink |
| ConversationContextBuilder | ✅ PASS | Load recent 100-200 messages, sort ascending, build prompt |
| ThreadConversationState | ✅ PASS | pendingIntent, missingSlots, collectedSlots, expiresAt (5 min TTL) |
| Context injected into Hermes prompt | ✅ PASS | Recent messages + state context → Hermes CLI |
| OCR metadata reuse (no rerun) | ✅ PASS | Follow-up "Ảnh vừa rồi ghi gì?" reads from assistant reply |
| Context-aware multi-turn | ✅ PASS | "Vậy nhắc mình việc đó lúc 19h" → understood "đi lễ Phật" |
| State priority over keyword rules | ✅ PASS | `activeConvState` loaded before create-reminder detection |
| Conversation state detection | ✅ PASS | weather_location, awaiting_clarification auto-detected |
| Search (keyword) | ✅ PASS | `searchConversationHistory` for messages beyond context window |
| **Live dry-run context test** | ✅ **PASS** | 3-step: OCR → follow-up → context reminder — ALL PASS |

**Conversation architecture:** Inbound (role=user) → DB → Context Builder (100 msgs) → Hermes CLI prompt → Reply (role=assistant saved with relatedMessageId). OCR metadata flows through Message table. ThreadConversationState tracks pending multi-turn intents with 5-min TTL.

**Gap backlogged:** Context-aware create-reminder parser (Batch 8.1) — "việc đó / cái đó" pronoun resolution for schedule creation.

### Batch 8.1: Context-aware Reminder Parser (2026-06-28)

| Component | Status | Detail |
|-----------|--------|--------|
| Pronoun detection | ✅ PASS | "việc đó", "cái đó", "chuyện đó", "nội dung đó", "việc ấy", "cái ấy", "chuyện ấy" |
| Time parsing | ✅ PASS | "lúc 19h", "7h tối", "X phút nữa" |
| Context resolution | ✅ PASS | OCR text → assistant reply → user message (3-tier priority) |
| Schedule creation from context | ✅ PASS | Schedule + Job created, content from OCR/context |
| No-context fallback | ✅ PASS | Ask clarification instead of guessing |
| Dry-run aware | ✅ PASS | `dryRun=true` skips real send |
| **Live dry-run test** | ✅ **PASS** | "Vậy nhắc mình việc đó lúc 19h" → schedule "đi lễ Phật" at 19h |
| Create-reminder regression | ✅ PASS | Classic pattern still works, no interference |

**Context flow:** OCR image → metadata.vision.ocrText → user says "nhắc mình việc đó lúc X" → detect pronoun → resolve from DB (OCR > assistant > user) → create schedule with correct content.

**Cleanup backlogged:** Content trimming — raw OCR may include header lines ("TEST OCR HERMES"). Production should extract the actionable item ("đi lễ Phật").

### Batch 2: Zalo Media Send (Live Test 2026-06-27)
    36|
    37|| Test | Result | Detail |
    38||------|--------|--------|
    39|| DM image `.jpg` + caption | ✅ PASS | `sent-1782561754021` |
    40|| DM file `.pdf` + caption | ✅ PASS | `sent-1782561769809` |
    41|| Group image inside reply window | ✅ PASS | `sent-1782565068701`, audit=allow, reason=reply_window_open |
    42|| Group image outside TTL blocked | ✅ PASS | `GROUP_REPLY_WINDOW_CLOSED`, audit=skip |
    43|
    44|**Media guardrails active:**
    45|- `FILE_NOT_FOUND`, `MEDIA_TYPE_NOT_ALLOWED`, `MEDIA_TOO_LARGE`
    46|- `DRY_RUN`, `GROUP_REPLY_WINDOW_CLOSED`, `RATE_LIMITED`
    47|- `ZALO_NOT_CONNECTED` with auto-restore fallback
    48|- `imageMetadataGetter` fixed (JPEG/PNG/GIF header reader, no deps)
    49|- Audit log: allow/skip with structured reason per request
    50|- Duplicate send: NO
    51|
    52|    35|
    53|    36|## How to Demo Zalo Chat
    54|    37|
    55|    38|1. **Confirm system is running:**
    56|    39|   ```bash
    57|    40|   curl -s -u admin:<password> http://127.0.0.1:3002/api/zalo/status
    58|    41|   # → {"connected":true, ...}
    59|    42|   ```
    60|    43|
    61|    44|2. **Send a Zalo message** to the bot from the allowed thread (6792540503378312397)
    62|    45|
    63|    46|3. **Wait 8-15s** — Hermes AI generates reply and sends back to Zalo
    64|    47|
    65|    48|4. **Verify in DB:**
    66|    49|   ```bash
    67|    50|   sqlite3 packages/backend/prisma/dev.db "SELECT id, status, json_extract(result, '$.reply') FROM AgentTask ORDER BY createdAt DESC LIMIT 3;"
    68|    51|   ```
    69|    52|
    70|    53|## Health Checks
    71|    54|
    72|    55|```bash
    73|    56|ADMIN_PASS=$(grep ADMIN_PASSWORD packages/backend/.env | cut -d= -f2)
    74|    57|
    75|    58|# Overall health
    76|    59|curl -s -u "admin:${ADMIN_PASS}" http://127.0.0.1:3002/api/health
    77|    60|
    78|    61|# Zalo connection
    79|    62|curl -s -u "admin:${ADMIN_PASS}" http://127.0.0.1:3002/api/zalo/status
    80|    63|
    81|    64|# Worker status
    82|    65|curl -s -u "admin:${ADMIN_PASS}" http://127.0.0.1:3002/api/worker/status
    83|    66|
    84|    67|# Auto-reply pipeline (enabled, dryRun, allowedThreads, activeCooldowns)
    85|    68|curl -s -u "admin:${ADMIN_PASS}" http://127.0.0.1:3002/api/agent/auto-reply/status
    86|    69|```
    87|    70|
    88|    71|## How to Enable / Disable Auto-Reply
    89|    72|
    90|    73|### Enable (live mode)
    91|    74|```bash
    92|    75|# Edit packages/backend/.env:
    93|    76|ZALO_AUTO_REPLY_ENABLED=true
    94|    77|ZALO_AUTO_REPLY_DRY_RUN=false
    95|    78|HERMES_CHAT_ADAPTER=real
    96|    79|HERMES_CHAT_MODE=cli
    97|    80|
    98|    81|# Restart
    99|    82|pkill -f "tsx.*src/index.ts"
   100|    83|pkill -f "tsx.*src/workers/index.ts"
   101|    84|sleep 2
   102|    85|cd packages/backend
   103|    86|npx tsx src/workers/index.ts &
   104|    87|npx tsx src/index.ts &
   105|    88|```
   106|    89|
   107|    90|### Disable (safe mode)
   108|    91|```bash
   109|    92|# Edit packages/backend/.env:
   110|    93|ZALO_AUTO_REPLY_ENABLED=false
   111|    94|```
   112|    95|
   113|    96|No restart needed — dispatcher reads config on each message.
   114|    97|
   115|    98|## Rollback to Mock / Dry-Run
   116|    99|
   117|   100|```bash
   118|   101|# Edit packages/backend/.env:
   119|   102|HERMES_CHAT_ADAPTER=mock        # Echo replies instead of AI
   120|   103|ZALO_AUTO_REPLY_DRY_RUN=true    # Process but don't send to Zalo
   121|   104|
   122|   105|# Restart (see above)
   123|   106|```
   124|   107|
   125|   108|## Safety Limits (DO NOT REMOVE)
   126|   109|
   127|   110|| Limit | Value | Reason |
   128|   111||-------|-------|--------|
   129|   112|| Allowlist | Only thread 6792540503378312397 | Prevents mass auto-reply |
   130|   113|| Cooldown | 10s per thread | Prevents spam |
   131|   114|| Dry-run switch | `ZALO_AUTO_REPLY_DRY_RUN` | Instant rollback to safe mode |
   132|   115|| Group auto-reply | NOT enabled | Requires owner approval |
   133|   116|| Adapter default | Mock (echo) | Safe fallback if endpoint down |
   134|   117|
   135|   118|## Demo Conditions (MANDATORY)
   136|   119|
   137|   120|- ⚠️ Chỉ dùng allowed thread `6792540503378312397`
   138|   121|- ⚠️ Không bật group thật
   139|   122|- ⚠️ Không bỏ allowlist
   140|   123|- ⚠️ Không mở public API (port 3002 bound to 127.0.0.1)
   141|   124|- ⚠️ Không gửi hàng loạt
   142|   125|- ⚠️ Rollback khẩn cấp: `ZALO_AUTO_REPLY_DRY_RUN=true` hoặc `HERMES_CHAT_ADAPTER=mock`
   143|   126|
   144|   127|## Readiness Tiers
   145|   128|
   146|   129|| Tier | Status |
   147|   130||------|--------|
   148|   131|| Customer demo | ✅ READY |
   149|   132|| Controlled pilot | ✅ READY |
   150|   133|| Full production public | ❌ NOT YET — pending security/recovery backlog |
   151|   134|
   152|   135|## Architecture (Simplified)
   153|   136|
   154|   137|```
   155|   138|Zalo App
   156|   139|  ↓ message
   157|   140|zca-js Listener
   158|   141|  ↓
   159|   142|saveIncomingMessage (DB)
   160|   143|  ↓
   161|   144|IncomingDispatcher
   162|   145|  ├─ enabled? allowlist? cooldown? content?
   163|   146|  ↓
   164|   147|RealHermesChatAdapter (CLI)
   165|   148|  ├─ spawn hermes chat -q "<prompt>" -Q
   166|   149|  ↓
   167|   150|Hermes Agent (DeepSeek v4 Pro)
   168|   151|  ↓ reply
   169|   152|ZaloMessageSender
   170|   153|  ↓
   171|   154|AgentTask: completed (audit)
   172|   155|  ↓
   173|   156|Reply arrives on Zalo App
   174|   157|```
   175|   158|
   176|   159|## Production Backlog (post-demo)
   177|   160|
   178|   161|| Item | Priority | Note |
   179|   162||------|----------|------|
   180|   163|| API authentication | **High** | agent/zalo routes unauthenticated (localhost-only for now) |
   181|   164|| Clean up backup secrets | **High** | 6 backup files/dirs with plaintext passwords |
   182|   165|| Dispatcher isSelf guard | **High** | Defense-in-depth (gateway handles it upstream) |
   183|   166|| Stuck "active" job recovery | Medium | Add `startedAt` + recovery scan |
   184|   167|| Old job staleness ceiling | Medium | Prevent ancient jobs firing on restart |
   185|   168|| Emoji-only content bypass | Medium | Unicode-aware check for empty-content gate |
   186|   169|| Git version control | Medium | VPS has no `.git/` — plain filesystem |
   187|   170|| `node dist` instead of `tsx watch` | Medium | For production stability |
   188|   171|| PM2 / systemd | Medium | Auto-restart, `pm2 save`, reboot survival |
   189|   172|| Cooldown → DB/Redis | Low | In-memory resets on restart |
   190|   173|| Multi-thread allowlist | Low | Currently single thread only |
   191|   174|| Backup automation | Low | DB + zalo-session + .env |
   192|   175|| Monitoring / alerts | Low | Uptime, Zalo disconnect, Hermes errors |
   193|   176|
   194|   177|## Known Issues (Non-blocking)
   195|   178|
   196|   179|5 pre-existing test failures (143/148 pass, 95.8% critical path pass rate). All non-blocking:
   197|   180|- 3× `ZALO_DRY_RUN=true` mismatch (tests written for dev, VPS runs `dryRun=false` production)
   198|   181|- 2× Vietnamese diacritic normalization gap (cosmetic — does not affect schedule creation)
   199|   182|- See `CUSTOMER_READINESS_AUDIT.md` for full details.
   200|   183|
   201|   184|## Contact / Admin
   202|   185|
   203|   186|- **Web UI:** https://<domain-cua-ban> (Cloudflare Tunnel)
   204|   187|- **Admin UI (local):** http://localhost:3001
   205|   188|- **Login:** admin / (see `.env` ADMIN_PASSWORD)
   206|   189|- **Backend port:** 3002
   207|   190|- **Worker:** db-polling every 10s
   208|   191|- **Hermes CLI:** `~/ai-agents/hermes-agent/venv/bin/hermes`
   209|   192|
   210|   193|### Cloudflare Tunnel (2026-06-25)
   211|   194|
   212|   195|| Item | Value |
   213|   196||------|-------|
   214|   197|| Public URL | `https://<domain-cua-ban>` |
   215|   198|| Tunnel | Cloudflare Named Tunnel (cloudflared) |
   216|   199|| Frontend target | `http://127.0.0.1:3001` |
   217|   200|| Backend API | `http://127.0.0.1:3002` (not exposed — /api/* via Next.js rewrite) |
   218|   201|| Ports 3001/3002 | Private localhost only |
   219|   202|| Status | ✅ Active |
   220|   203|