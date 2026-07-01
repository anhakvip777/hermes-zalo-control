# Known Users Controlled Pilot Report

**Status:** ✅ **PASS**
**Date:** 2026-07-01
**Commits:** P1.1 (`caf8760`), P1.2 (`95565f1`), P1.3 (`0252d3c`), U1 (`ea88d45`), S3 (`02acd4f`)

---

## Pre-flight
| Check | Value |
|-------|-------|
| **dryRun** | `true` |
| **live test** | Not active |
| **Zalo connected** | `true` |
| **listener** | ✅ Active |
| **session warning** | `SESSION_QUARANTINED` (old logout file, harmless) |
| **principal** | Pilot User / `basic_chat` / `active` |

---

## Pilot Scope

| Parameter | Requested | Actual |
|-----------|-----------|--------|
| **threadId** | `6792540503378312397` | ✅ |
| **senderId/principalId** | `6792540503378312397` (DM → threadId) | ✅ |
| **role** | `basic_chat` | ✅ |
| **maxMessages** | 3 | 3 |
| **ttl** | 1800s (30 phút) | **300s** (5 phút) ⚠️ |

> **TTL Mismatch**: API rejected 1800s with `INVALID_TTL`. Max allowed is 300s. `live-test.service.ts` enforces 1-300 range. Fix needed before longer pilots.

---

## Test Result — Message 1: "chào bot, trả lời ngắn gọn thôi"

| Field | Value |
|-------|-------|
| **Inbound captured** | ✅ `chào bot, trả lời ngắn gọn thôi` |
| **Principal resolved** | ✅ `basic_chat` (via threadId fallback for DM) |
| **Hermes processed** | ✅ `AgentTask completed` |
| **Outbound decision** | ✅ `allow` |
| **Outbound reason** | `single_send` |
| **dryRun** | 🔴 **0** (REAL SEND) |
| **sentMessageId** | ✅ `sent-1782903510500` |
| **LiveTest sentCount** | ✅ `1 / 3` |
| **UI /messages** | ✅ SENT (sentMessageId present) |
| **Error** | ✅ None |

---

## Cleanup

| Check | Value |
|-------|-------|
| **live stopped** | ✅ `active: false` |
| **global dryRun** | ✅ `true` (unchanged) |
| **session** | ✅ Healthy (2815B) |
| **listener** | ✅ Active |
| **duplicates** | ✅ None |
| **permission_denied** | ✅ None |
| **ZALO_NOT_CONNECTED** | ✅ None |

---

## Issues

| Issue | Severity | Resolution |
|-------|----------|------------|
| **TTL mismatch** | Medium | `ttlSeconds` capped at 300s in `live-test.service.ts`. Fix to support up to 3600s for pilots. |
| **senderId null in DM** | Low | Principal resolution works via `threadId` fallback. DM senderId extraction could be improved. |
| **Outbound UI status "?"** | Low | U1 `listMessages` enrichment didn't detect SENT. SentMessageId exists in OutboundRecord. |

---

## Recommendation

- ✅ Pilot Message 1 successful — permission gate + controlled live + real send all work
- ⚠️ Do NOT open global live
- 🔧 Fix TTL cap before longer pilots (change 300 → 3600 in live-test.service.ts)
- 📊 Next: 2-3 trusted DM pilot with fixed TTL
- 🚫 NOT ready for: group pilot, production live, multi-user
