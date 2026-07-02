# Hermes Zalo Admin Center — Customer Handoff

**Date:** 2026-07-01
**Last Updated:** 2026-07-01 17:40 UTC+7 (after PT2 AI content/context separation fix)
**Status:** Controlled DM handoff READY — AI safety verified ✅

---

## Ready

- Zalo connected through backend ✅
- Backend is the only Zalo sender ✅
- Worker sends through backend internal API ✅
- Access Control UI ready ✅
- Permission roles: `form_only`, `basic_chat`, `advanced`, `admin` ✅
- Message status UI: SENT, DRY RUN, FAILED, BLOCKED, PERM DENIED, COOLDOWN ✅
- Controlled Live Test ready ✅
- Global dryRun safety remains enabled ✅
- Test DB isolation fixed (TDB1) ✅
- UI polished — DESIGN.md, sidebar grouped, VN time (UTC+7), zalo-ops light theme ✅
- Status badges follow DESIGN.md color system ✅

---

## AI Prompt Safety — 3-Layer Defense ✅

| Layer | What | Commit | Status |
|---|---|---|---|
| **Output Guard** | Block internal markers in outbound | `a24d84d` `f922e5d` | ✅ Active |
| **History Filter** | Exclude contaminated messages from AI context | `cfa61df` | ✅ Active |
| **Content/Context Separation** | User content never mixed with history | `cfa61df` | ✅ Active |

**DryRun "bạn là ai" verification (2026-07-01 17:39):**
- decision=allow, reason=dry_run, dryRun=true, real send=NO ✅
- Output: `"bạn là ai"` — CLEAN, no markers, no context, no history echo ✅

---

## Verified Live Pilots

### Pilot 1
- **Thread:** `6792540503378312397`
- **Role:** `basic_chat`
- **Result:** 3/3 real sends PASS

### Pilot 2
- **Thread:** `5189400998311849354`
- **Role:** `basic_chat`
- **Result:** 3/3 real sends PASS

### Pilot 3
- **Thread:** `6906520402993817174`
- **Name:** Tiny
- **Role:** `basic_chat`
- **Result:** 1/1 real send PASS
- **R3 DM fallback verified:** senderId null → threadId principal lookup

---

## Safety Status

| Control | State |
|---|---|
| Global dryRun | `true` ✅ |
| Global live | disabled ✅ |
| Group auto-reply | not enabled ✅ |
| Unknown users | not enabled ✅ |
| Controlled live only | by thread + quota ✅ |
| AI prompt echo guard | 3-layer active ✅ |

---

## Test Gates

| Gate | Result |
|---|---|
| Backend tests | **819 PASS** (49 files) ✅ |
| TypeScript typecheck | **PASS** (exit 0) ✅ |
| Backend build | **PASS** ✅ |
| Frontend build | **PASS** (21 static pages) ✅ |

---

## Do Not Enable Yet

- Global live
- Group auto-reply
- Unknown users
- Bulk user rollout
- Advanced/RAG tools for normal users

---

## Known Limitations

- Session persistence still needs final hardening
- If Zalo disconnects and session file is invalid/missing, QR login may be required
- INTERNAL_API_TOKEN should be moved to final secret management
- AI answer reliability scoring not fully built yet
- Group mention-only pilot not done yet
- zaloConnection heartbeat shows "stale" (2.5h) — monitoring gap, not functional

---

## Production Readiness Scope

**Current production-readiness page may show NOT_READY. This gates full global production, not controlled DM pilot.**

| Scope | Status |
|---|---|
| Controlled DM Pilot | ✅ READY — 3/3 pilots, 7 real sends, AI safety verified, zero prompt leaks |
| Global Production Live | ❌ NOT READY — session persistence + heartbeat monitoring needed |
| Group Rollout | ❌ NOT READY — no group mention pilot yet |

**Remaining readiness issues (do NOT block controlled DM):**

1. **backup.session (FAIL, high):** No session file persisted on disk. Zalo is connected via in-memory credentials. If disconnected, QR re-login required.
2. **errors.heartbeats (WARN, high):** zaloConnection heartbeat is stale — monitoring gap, not functional issue.

---

## Admin Pages

| Page | Path |
|---|---|
| Messages | `/messages` |
| Access Control | `/access-control` |
| Zalo Ops | `/zalo-ops` |
| Runtime Settings | `/runtime-settings` |
| Production Readiness | `/production-readiness` |
| System Health | `/system-health` |

---

## Cloudflare Tunnel / Public URL

**Public URL:** https://hermes.nhachungkhuduong.pro.vn

> Note: domain is `nhachungkhudong`, not `nhachungkhuduong`.

### Incident: Cloudflare 1033 (2026-07-01)

**Root cause:** Cloudflare tunnel PM2 process was missing.

**Fix:**
```bash
pm2 start cloudflared --name hermes-tunnel -- tunnel run --token <TOKEN>
pm2 save
```

**Verify:**
```bash
pm2 status
curl -I http://127.0.0.1:3000           # HTTP 200
curl -I http://127.0.0.1:3002/api/system/health  # HTTP 200
curl -I https://hermes.nhachungkhuduong.pro.vn   # HTTP 200
```

---

## Emergency Stop

1. Keep global `dryRun=true`
2. Stop active live test
3. Do not enable group/global live
4. Restart backend only if listener is stuck
5. QR login again if Zalo session expires
6. Restore latest DB/session backup if needed

---

## Final Recommendation

**Ready for controlled DM handoff.** AI prompt safety verified with 3-layer defense. Output clean on "bạn là ai" dryRun test.  

**Not ready for global live or group rollout.**

---

## SCHED1-LIVE: Schedule Execution Proof (2026-07-02)

**Result: ✅ PASS**

| Field | Value |
|---|---|
| Schedule ID | `cmr2xjj7u001hhmlskhutf10c` |
| dueAt | `2026-07-02T03:14:54Z` |
| ScheduleJob completed | `03:15:00Z` |
| dryRun (scheduled exec) | `0` — controlled live send |
| sentMessageId | `sent-1782962100086` |
| content | `"họp"` |
| duplicate | none |
| maxMessages | 1 |
| live auto-stopped | ✅ yes |
| final live active | `false` |
| final global dryRun | `true` |
| group | false |

**Decision (updated):**

| Scope | Status |
|---|---|
| Controlled DM handoff | ✅ **READY** |
| Global live | ❌ NOT READY |
| Group rollout | ❌ NOT READY |
