# Demo Script — Zalo Admin Center MVP

> **Audience:** Customer / stakeholder  
> **Duration:** ~15 minutes  
> **Mode:** dryRun=true (safe demo, no real Zalo sends)

---

## Demo 1: Zalo Connected + dryRun Safe

**Show:**
1. Open `/zalo-ops` → Zalo connection status: **connected** (green)
2. Open `/production-readiness` → all gates green, `READY_FOR_LIVE`
3. Open `/safety-mode` → dryRun = **true** (safe mode)
4. Send DM: `hello` → bot replies in dryRun (audited but not sent to Zalo)
5. Show `/messages` → message saved, AgentTask completed

**Key point:** System is fully operational but completely safe — no real Zalo messages are sent.

---

## Demo 2: OCR Image Understanding

**Show:**
1. Send an image (e.g., screenshot, document, photo with text)
2. Go to `/messages` → find the image message
3. Show AgentTask result → extracted text from image
4. Bot replies with a summary of what it sees in the image

**Key point:** AI can read and understand images (OCR + vision).

---

## Demo 3: Ask About Previous Image

**Show:**
1. After Demo 2, send: `ảnh vừa rồi ghi gì?`
2. Bot recalls context and describes the image content
3. Show multi-turn conversation context working

**Key point:** Conversation context is maintained — bot remembers what was discussed.

---

## Demo 4: Reminder from Context

**Show:**
1. Send: `nhắc mình đi họp lúc 15h`
2. Bot replies: `✅ Đã đặt lịch nhắc: "đi họp" lúc 15:00`
3. Go to `/schedules` → new schedule created
4. Show schedule details: status, scheduledAt, content

**Key point:** AI creates real schedules from natural language, with full audit trail.

---

## Demo 5: Message Batching

**Show:**
1. Go to `/runtime-settings` → `messageBatching.enabled = true`
2. Send 2 rapid DMs: `pilot batch 1` then `pilot batch 2`
3. Go to `/messages` → both saved, 1 MessageBatch created
4. Bot replies once (combining context from both messages)

**Key point:** Rapid messages are intelligently batched — single AI call, single reply.

---

## Demo 6: Rule Engine

**Show:**
1. Go to `/rules` → create a rule:
   - trigger: keyword `giá`
   - action: fixed_reply → `"Vui lòng liên hệ admin để biết giá chi tiết"`
2. Send DM: `cho mình hỏi giá dịch vụ`
3. Bot replies with the fixed reply (no AI call needed)

**Key point:** Rule engine enables instant, deterministic responses without AI cost.

---

## Demo 7: Document / PDF Ask

**Show:**
1. Go to `/documents` → upload a PDF (e.g., product spec)
2. Wait for processing → status `completed`
3. Send DM: `tài liệu vừa upload nói gì về bảo hành?`
4. Bot reads the document chunks and answers the question

**Key point:** AI can ingest and answer questions about uploaded documents.

---

## Demo 8: Controlled Live Test (1 real message)

**Show:**
1. Go to `/safety-mode` → Live Test → Start
2. Set: threadId = user's DM, maxMessages=1, ttlSeconds=300
3. Send DM: `live test hello`
4. Bot sends **1 real Zalo reply** (user sees it on Zalo app)
5. Session auto-completes → sentCount=1/1

**Key point:** Exact 1-message quota enforced. Cannot exceed. Full audit trail.

---

## Demo 9: Post-Quota dryRun Fallback

**Show:**
1. After Demo 8 (session completed), send: `another message`
2. **No real Zalo send** — effective dryRun=true
3. Show `/messages` → message saved, reply generated (dryRun)
4. Show `/zalo-ops` → no new outbound with dryRun=false

**Key point:** After live quota is exhausted, system auto-reverts to safe mode.

---

## Wrap-Up

- All demos can run in dryRun mode (no risk)
- Live test is controlled, quota-limited, auto-reverting
- Full audit trail for every action
- Secret audit: `npm run secret:audit` → clean
