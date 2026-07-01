# Final Post-R5 Stabilization Snapshot

**Date:** 2026-06-30 02:20 ICT  
**Status:** ✅ STABLE — Pilot verified, dryRun=true, ready for next feature batch

---

## 1. Executive Summary

The outbound architecture refactor (R1 → R5) and stabilization fixes (D1, S1.1, R3.2) have been implemented, tested, and verified through controlled live pilot.

| Area | Status |
|------|--------|
| Core outbound refactor (R1→R5) | ✅ PASS |
| Backend sole Zalo sender (R3.1) | ✅ PASS |
| Worker no Zalo session (R3.1+R3.2) | ✅ PASS |
| Internal API protected (R3+R3.2) | ✅ PASS |
| DB path unified (D1) | ✅ PASS |
| Cooldown DB-backed (R5) | ✅ PASS |
| Session non-destructive quarantine (S1.1) | ✅ PASS |
| Controlled live test (1 thread) | ✅ PASS |
| Phase 2 trusted DM pilot | ✅ PASS |
| Global dryRun | **true** |
| Test suite | **41 files / 674 PASS** |
| Build | clean |
| PM2 | 4/4 online |

---

## 2. Commits

| Commit | Description |
|--------|-------------|
| `79c3cd0` | R1.1+R1.2 — Unified Outbound Dispatcher (11 paths migrated) |
| `54cdcde` | R2.1 — Worker runtime dryRun per job (frozen sender removed) |
| `8c29d59` | R4A — Send-test route migration |
| `a9e77c4` | R3.1 — Worker outbound via backend internal API; backend sole Zalo owner |
| `a996066` | R4C — ThreadId defensive normalization (5 boundaries) |
| `e4f9d22` | R4B — Media/Voice through outbound dispatcher (discriminated union) |
| `283c312` | R5 — Cooldown single-store: DB-backed ThreadCooldown, dispatcher sole authority |
| `abd9c3f` | S1.1 — Non-destructive session quarantine (rename, never delete) |
| `8d2b621` | R3.2 — Batch worker routes outbound via backend internal API (no ZALO_NOT_CONNECTED) |

**Working tree:** clean (untracked docs/backups only)

---

## 3. Architecture Final State

### Inbound → Outbound Flow

```
Zalo message received
  → Backend listener (owns Zalo WebSocket session)
  → Incoming dispatcher
    → Safety gates (allowlist, self-guard, group mention gate)
    → Batching interceptor (DM text only)
      → collecting → ready (limits/timeout)
    → Rule engine (fixed_reply, ignore, route_to_hermes)
    → Reminder parser (Batch 14.1: "nhắc ... lúc ...")
    → Hermes fallback (AI reply generation)
  → Unified Outbound Dispatcher (R1.1 — sole entry)
    → Decision: dryRun / liveTest / cooldown / rateLimit
    → OutboundRecord created (decision + reason + dryRun status)
    → ZaloMessageSender.sendMessage() (sole Zalo owner)
  → Zalo
```

**Worker flow (schedules + batch):**

```
Worker process (NO Zalo session)
  → Schedule: calls backend internal API for outbound (R3.1)
  → Batch: calls POST /api/internal/messages/handle-batch (R3.2)
  → Worker NEVER imports:
    - ZaloMessageSender
    - zalo-gateway
    - handleIncomingMessage
  → Backend process (owns Zalo session) handles all outbound
```

### Internal API

| Endpoint | Auth | Consumer |
|----------|------|----------|
| `POST /api/internal/outbound/send` | Bearer token + localhost | Scheduler worker |
| `POST /api/internal/messages/handle-batch` | Bearer token + localhost | Batch worker |

**Security:** localhost-only + constant-time token compare. Fail-closed (returns 401 if token missing/invalid).

---

## 4. Safety Final State

| Mechanism | Status |
|-----------|--------|
| Global dryRun | **true** (env `ZALO_AUTO_REPLY_DRY_RUN=true`) |
| Controlled live | Only via LiveTestSession (per-thread, quota + TTL) |
| Internal API | localhost-only + Bearer token |
| Worker Zalo isolation | Worker cannot send Zalo directly (no session, no sender import) |
| Session quarantine | Invalid/expired session renamed (`.expired-TIMESTAMP`), never deleted |
| Cooldown | DB-backed `ThreadCooldown` (survives restart), dispatcher sole authority |
| Unsupported System Claim Guard | Blocks Hermes hallucinated confirmations ("đã ghi nhận/đã lưu/đã tạo lịch") |
| Outbound guardrails | 5 guardrails in split-send.py (Unicode, rich, dedup, context, audit) |
| Send dedup | Adapter-level 5s hash dedup |
| Group gate | Mention-required, TTL 600s |
| Dry-run source | `getCurrentEffectiveDryRun()` single source of truth |

---

## 5. Pilot Results

### Controlled Live Test (1 thread, maxMessages=1)

| Test | Result |
|------|--------|
| Live send | ✅ dryRun=0, sentMessageId real |
| Post-quota fallback | ✅ dryRun=1, sentCount unchanged |
| No ZALO_NOT_CONNECTED | ✅ |
| No duplicate | ✅ |

### Phase 2 — Trusted DM Pilot (5 quota, 1hr TTL)

| Test | Result | sentCount |
|------|--------|-----------|
| Test 1 — Normal chat | ✅ PASS | 1/5 |
| Test 2 — Cooldown (2 rapid msgs) | ✅ PASS | 2/5 |
| Test 3 — Reminder intent | ✅ PASS (schedule+job+confirm) | 3/5 |
| Test 4 — Batch (2 rapid msgs) | ✅ PASS (path) / Guard blocked | 3/5 |
| **Total** | **4/4 path PASS** | **3/5 used, stopped safely** |

**Key confirmations:**
- `ZALO_NOT_CONNECTED` completely eliminated (R3.2 fix verified)
- Worker → internal API → backend path confirmed in all scenarios
- sentCount never incremented on blocked/error
- Global dryRun remained true throughout

---

## 6. Known Non-blocking Issues

| Issue | Severity | Status |
|-------|----------|--------|
| Session directory disappears on PM2 restart | Medium | Mitigation: keep backup. S1.1 protects file, not directory |
| Heartbeats not recorded on fresh backend start | Low | Manual injection workaround. Static import fix in source, but may not fire |
| Unsupported System Claim Guard blocks some benign replies | Low | Correct safety behavior. Review guard patterns in future batch |
| UI status clarity gaps | Low | Message timeline, batch status, cooldown visibility could improve |
| Thread display name not implemented | Low | Only thread IDs shown, no friendly names |
| Zalo RBAC not implemented | Medium | Required before any group live testing |
| RAG/Context evaluation suite | Low | Not started |

---

## 7. Recommended Next Roadmap

Ordered by priority:

| ID | Item | Priority | Rationale |
|----|------|----------|-----------|
| **T1** | **Thread Display Name / ThreadProfile** | High | UX foundation — show names not IDs everywhere |
| **P1** | **Zalo User Permission / RBAC** | High | Required before group testing or multi-user |
| **U1** | **Message UI Status Clarity** | Medium | Better visibility into pipeline decisions |
| **H1** | **Heartbeat/Session persistence polish** | Medium | Fix heartbeat recording + session directory persistence |
| **E1** | **RAG/Context Evaluation Suite** | Low | Measure reply quality, context accuracy |
| **DASH** | **UI/UX Dashboard Polish** | Low | Overall admin experience improvements |

---

## 8. Operational Rules Going Forward

| Rule | Detail |
|------|--------|
| 🔴 Never set `dryRun=false` globally | Without explicit approval. Use Controlled Live Test for any live testing |
| 🔴 Live only via LiveTestSession | Per-thread, quota-limited, TTL-gated |
| 🔴 Pre-restart backup | Backup session file (`zalo-session.json`) before any PM2 restart |
| 🔴 Post-restart verify | Check Zalo connected + listener active after every restart |
| 🔴 Never delete session | Only quarantine (rename). Recovery from quarantine is possible |
| 🔴 Worker never sends Zalo directly | All outbound goes through backend internal API |
| 🔴 Use IDs, not displayNames | Authorization, routing, and thread targeting must use IDs only |
| 🔴 No group live before RBAC | Group live requires mention-only gate + user RBAC in place |
| 🔴 Internal API fail-closed | Token validation + localhost check. Never expose internal API publicly |
| 🟡 Cooldown persists in DB | Restart-safe. Use `acquireCooldown()` — never in-memory Maps |
| 🟡 Unsupported System Claim Guard active | Blocks hallucinated confirmations. Expect occasional false positives |

---

## Appendix: Key Files

| File | Purpose |
|------|---------|
| `packages/backend/prisma/schema.prisma` | DB schema (27+ tables, ThreadCooldown, LiveTestSession) |
| `packages/backend/src/services/outbound-dispatcher.service.ts` | Unified outbound dispatcher (sole entry) |
| `packages/backend/src/services/cooldown.service.ts` | DB-backed cooldown |
| `packages/backend/src/services/zalo-message-sender.ts` | Sole Zalo sender |
| `packages/backend/src/services/zalo-gateway.service.ts` | Zalo WebSocket + session (quarantine in S1.1) |
| `packages/backend/src/workers/message-batch-worker.ts` | Batch worker (calls internal API) |
| `packages/backend/src/routes/internal.ts` | Internal API endpoints |
| `packages/backend/src/services/live-test.service.ts` | Controlled live test service |
| `docs/POST_R5_CONTROLLED_LIVE_TEST_REPORT.md` | Full pilot report (R3.2 + Phase 2) |
| `docs/S1_SESSION_RESTART_INVESTIGATION_REPORT.md` | Session loss root cause analysis |
| `docs/D1_DATABASE_PATH_UNIFICATION_REPORT.md` | DB path drift resolution |
| `docs/OPERATIONS_RUNBOOK.md` | Safe restart SOP, session restore |
| `docs/ROLLBACK_GUIDE.md` | Emergency rollback procedures |
| `backups/` | DB + session backups |
