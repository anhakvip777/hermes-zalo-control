# New Model Full Project Audit

**Auditor:** claude-sonnet-4-6 via chiasegpu (model mới)  
**Date:** 2026-07-02 UTC+7  
**Status:** ⚠️ PARTIAL PASS — 2 P0 blocker cần xử lý trước DM handoff

---

## Project Understanding

1. **Hermes Zalo Admin Center** — web dashboard điều khiển AI bot trả lời Zalo, gồm backend (Fastify :3002), frontend (Next.js :3001), worker batch, document worker.
2. **Luồng chính:** Zalo inbound → listener → dispatcher (permission + allowlist + cooldown) → batch worker → Hermes CLI → outbound-dispatcher (echo guard + dryRun gate) → ZaloGateway.
3. **Adapter AI:** `HERMES_CHAT_ADAPTER=real` → `RealHermesChatAdapter` (CLI mode, bin=/venv/bin/hermes). Default là `mock` nếu không set env var.
4. **dryRun** có 2 tầng: env `ZALO_AUTO_REPLY_DRY_RUN` (startup default) + DB RuntimeSetting override. DB ghi đè env.
5. **3-layer AI output safety:** Output guard (block echo markers) + History contamination filter (exclude contaminated msgs from context) + Content/context separation (content = raw user msg only).
6. **Test isolation:** dev.db ≠ test.db, cleanDatabase() guard active. npm test không wipe dev.db.
7. **Outbound path:** mọi send đều qua `outbound-dispatcher.service.ts` → dryRun gate → `ZaloMessageSender`. Không có bypass trực tiếp trong routes.
8. **Zalo session** hiện không tồn tại (NO_SESSION_FILE) → connected=false, listener=false. PM2 resurrect đã khôi phục processes.
9. **Backend tests:** 819/819 PASS (49 files). Typecheck PASS. Build PASS (backend + frontend).
10. **Public tunnel** hermes.nhachungkhudong.pro.vn: HTTP 200, tất cả 9 pages đều accessible.

---

## P0 Blockers (phải fix trước DM handoff)

### P0-A — MockAdapter đang dùng ở runtime (CRITICAL)

**Root cause:**
- `config.ts` line 96: `adapter: process.env.HERMES_CHAT_ADAPTER ?? "mock"` — default là `mock`
- `ecosystem.config.cjs` KHÔNG có `HERMES_CHAT_ADAPTER` trong PM2 env block
- `packages/backend/.env` CÓ `HERMES_CHAT_ADAPTER=real` nhưng PM2 resurrect KHÔNG load `.env`
- Process env của PID 104274 xác nhận: `HERMES_CHAT_ADAPTER` KHÔNG có trong runtime env
- **Kết quả:** Bot đang dùng `MockHermesChatAdapter` → echo "Xin chào! Tôi là trợ lý Zalo (chế độ test). Bạn đã nói: ..."

**Bằng chứng từ log (2026-07-01T18:39:51):**
```
[outbound] contentPreview: "Xin chào! Tôi là trợ lý Zalo (chế độ test). Bạn đã nói: \"Bạn có biết tôi là ai k"
dryRun: false → real send = YES (đã gửi thật ra Zalo!)
```

**Fix cần làm:**
Thêm vào `ecosystem.config.cjs` env block của `hermes-backend`:
```
HERMES_CHAT_ADAPTER: "real",
HERMES_CHAT_MODE: "cli",
HERMES_CHAT_CLI_BIN: "/home/anhakvip777/ai-agents/hermes-agent/venv/bin/hermes",
HERMES_CHAT_TIMEOUT_MS: "30000",
HERMES_CHAT_CLI_TIMEOUT_MS: "60000",
```
Sau đó: `pm2 start ecosystem.config.cjs` (NOT restart — cần pick up env mới).

### P0-B — dryRun=false trong runtime DB (CRITICAL)

**Root cause:**
- DB RuntimeSetting `autoReply.dryRun=false` được set lúc 2026-07-01T18:09:45 bởi `admin`
- Override này ghi đè `ZALO_AUTO_REPLY_DRY_RUN=true` từ env/ecosystem
- Runtime log: `[runtime-config] Initialized: dryRun=false (source: runtime)`
- `/api/zalo/ops/status` trả `dryRun: false`

**Nguy hiểm:** Khi Zalo reconnect (sau QR login), tất cả messages trong allowedThreads sẽ bị SEND THẬT với MockAdapter!

**Fix cần làm:**
```bash
ADMIN_PW=$(cat packages/backend/.env | grep "^ADMIN_PASSWORD=" | cut -d= -f2)
curl -s -X PATCH -u "admin:${ADMIN_PW}" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true, "confirmText": "ENABLE DRY RUN"}' \
  http://127.0.0.1:3002/api/system/runtime-config/auto-reply
```

---

## Real Provider Check

| Check | Status |
|---|---|
| `HERMES_CHAT_ADAPTER` in `.env` | `real` ✅ |
| `HERMES_CHAT_ADAPTER` in PM2 runtime env | **MISSING** ❌ |
| Adapter used at runtime | `MockHermesChatAdapter` ❌ P0 |
| Hermes CLI binary exists | ✅ `/venv/bin/hermes` v0.12.0 |
| `CHIASEGPU_API_KEY` configured | ✅ set (67 chars) |
| Mock echo in real sends | **YES** ❌ P0 |
| Mock/fallback trigger | `HERMES_CHAT_ADAPTER ?? "mock"` default |

---

## AI Output Safety

| Layer | Status |
|---|---|
| Output guard (`checkPromptEcho`) | ✅ Active — blocks [LỊCH SỬ], [TIN NHẮN HIỆN TẠI], etc. |
| History contamination filter | ✅ Active — skipped 6 contaminated msgs in last dispatch |
| Content/context separation | ✅ Fixed — `effectiveContent = msg.content` (no fullContext injection) |
| Old markers in runtime prompt | ✅ Only in `prompt-safety.service.ts` guard list |
| Anti-pattern (effectiveContent+fullContext) | ✅ Not found |
| dryRun chat-quality | ❌ NOT VERIFIED — Zalo not connected |
| Prompt leak | ✅ No leak detected (markers in guard only) |

---

## Backend Gates

| Gate | Result |
|---|---|
| `npm test -w packages/backend` | ✅ 819/819 PASS (49 files) |
| `npm run typecheck -w packages/backend` | ✅ PASS (exit 0) |
| `npm run build -w packages/backend` | ✅ PASS (exit 0) |
| `npm run build -w packages/frontend` | ✅ PASS (22 pages) |
| Working tree | `?? backups/` (untracked backup dir — safe) |

---

## Database

| Check | Status |
|---|---|
| dev.db (runtime) | ✅ 59 Messages, 76 OutboundRecords, 3 Principals |
| test.db (isolated) | ✅ minimal test data, 0 Principals |
| dev.db ≠ test.db | ✅ isolated paths |
| npm test wipes dev.db | ✅ No — cleanDatabase() guard only touches test.db |
| MessageBatch | dev.db: 17, test.db: 0 |
| ThreadProfile | dev.db: 3, test.db: 0 |

---

## Outbound Safety

| Check | Status |
|---|---|
| All send paths use `sendOutbound` | ✅ outbound-dispatcher.service.ts là single path |
| Routes bypass check | ✅ Không có bypass trong routes/ |
| dryRun gate | ✅ `getCurrentEffectiveDryRun()` kiểm trước mỗi send |
| dryRun runtime value | ❌ `false` (P0-B — phải reset về `true`) |
| live test | ✅ inactive (active=false) |
| permission gate | ✅ Principal role check active |
| group gate | ✅ group-safety.service.ts, groupMentionRequired |
| bypasses found | None |

---

## Zalo/Ops

| Check | Status |
|---|---|
| Zalo connected | ❌ NO_SESSION_FILE |
| Listener active | ❌ false (no session) |
| Session file | ❌ Not present — QR login needed |
| heartbeat zaloConnection | ⚠️ stale (25907s) |
| heartbeat messagePipeline | ⚠️ stale (23781s) |
| dryRun ops value | ❌ false (P0-B) |
| PM2 processes | ✅ All 5 online (backend, worker, document-worker, frontend, tunnel) |
| Tunnel | ✅ hermes.nhachungkhudong.pro.vn → 200 OK |

---

## Frontend/Timezone

| Check | Status |
|---|---|
| Build | ✅ PASS (22 pages) |
| Public pages (9/9) | ✅ All 200 |
| UTC+7 display | ✅ `formatVnTime()` helper, `TimeText.tsx` component |
| APP_TIMEZONE | `Asia/Ho_Chi_Minh` |
| DESIGN.md tokens | ✅ Applied — calm SaaS admin, không dark cyberpunk |

---

## Security

| Check | Status |
|---|---|
| CHIASEGPU_API_KEY in .env | ✅ (67 chars, not exposed) |
| Secrets in ecosystem.config.cjs | ✅ None hardcoded |
| INTERNAL_API_TOKEN | ✅ via `process.env.INTERNAL_API_TOKEN || "CHANGE_ME_..."` |
| ADMIN_PASSWORD | ✅ 32 chars |
| Backups directory | ⚠️ Untracked (`?? backups/`) — ensure gitignored |

---

## Remaining Blockers

**P0 (phải fix trước bất kỳ live test nào):**
- **P0-A:** `HERMES_CHAT_ADAPTER` missing từ PM2 env → MockAdapter dùng ở runtime → bot echo "Bạn đã nói..."
- **P0-B:** `dryRun=false` trong DB RuntimeSetting → sends real ngay khi Zalo reconnect với MockAdapter

**P1 (phải fix trước controlled DM handoff):**
- **P1-A:** Zalo session missing → NO_SESSION_FILE → cần QR login sau khi fix P0-A + P0-B
- **P1-B:** Verify Hermes CLI thật trả lời đúng (dryRun "Hi" + "bạn là ai") sau khi fix P0

**P2 (backlog, không block controlled DM):**
- Heartbeat stale (monitoring gap, không functional)
- Session auto-persist chưa hoàn thiện
- AI scoring chưa build

---

## Decision

| Scope | Status |
|---|---|
| **Controlled DM handoff** | ❌ **NOT READY** — P0-A (MockAdapter) + P0-B (dryRun=false) + P1-A (no Zalo session) |
| **Global live** | ❌ NOT READY |
| **Group rollout** | ❌ NOT READY |

**Lý do:** Bot đang dùng MockHermesChatAdapter với dryRun=false trong DB. Nếu Zalo reconnect ngay bây giờ, mọi tin nhắn từ 3 allowedThreads sẽ nhận echo mock thật sự, không phải AI.

---

## Action Plan (theo thứ tự)

```
Bước 1: Reset dryRun=true trong DB (P0-B) — an toàn nhất trước
Bước 2: Thêm HERMES_CHAT_ADAPTER=real vào ecosystem.config.cjs (P0-A)
Bước 3: pm2 start ecosystem.config.cjs (để pick up env mới)
Bước 4: QR login Zalo
Bước 5: Verify runtime adapter=real (check /proc/<pid>/environ)
Bước 6: dryRun chat test "Hi" + "bạn là ai" → expect real Hermes response
Bước 7: Commit ecosystem.config.cjs change + report
```

**Không được làm trước khi có approval từ user.**
