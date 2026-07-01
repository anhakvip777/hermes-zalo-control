# Hermes Zalo Admin Center — Customer Handoff

**Date:** 2026-07-01  
**Status:** Controlled DM pilot ready

---

## Ready

- Zalo connected through backend
- Backend is the only Zalo sender
- Worker sends through backend internal API
- Access Control UI ready
- Permission roles ready: `form_only`, `basic_chat`, `advanced`, `admin`
- Message status UI ready: SENT, DRY RUN, FAILED, BLOCKED, PERM DENIED, COOLDOWN
- Controlled Live Test ready
- Global dryRun safety remains enabled
- Test DB isolation fixed (TDB1)
- UI polished — DESIGN.md created, sidebar grouped, VN time (UTC+7) on all pages, zalo-ops light theme
- Status badges follow DESIGN.md color system (SENT=green, DRY RUN=info, FAILED=danger, etc.)

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
|---------|-------|
| Global dryRun | `true` |
| Global live | disabled |
| Group auto-reply | not enabled |
| Unknown users | not enabled |
| Controlled live only | by thread + quota |

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

---

## Admin Pages

| Page | Path |
|------|------|
| Messages | `/messages` |
| Access Control | `/access-control` |
| Zalo Ops | `/zalo-ops` |
| Runtime Settings | `/runtime-settings` |
| Production Readiness | `/production-readiness` |
| System Health | `/system-health` |

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

Ready for controlled DM handoff.  
Not ready for global live or group rollout.
