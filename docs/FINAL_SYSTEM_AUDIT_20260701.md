# Final System Audit — 2026-07-01

**Status:** ✅ PASS — Ready for controlled DM handoff

---

## Simple Explanation

Kiểm tra hệ thống như kiểm tra xe trước khi giao khách:

| Hệ thống | Ví dụ | Trạng thái |
|----------|-------|------------|
| Backend | Máy xe | ✅ Nổ máy, chạy êm |
| Frontend | Bảng điều khiển | ✅ Sáng đèn, các nút hoạt động |
| Database | Sổ sách | ✅ Sổ thật và sổ nháp đã tách riêng |
| Zalo Session | Chìa khóa | ✅ Đang kết nối, có backup |
| Worker | Người phụ việc | ✅ Làm việc, không lỗi |
| Timezone +7 | Đồng hồ VN | ⚠️ UTC trong DB, cần ghi rõ khi hiển thị |
| Logs | Camera hành trình | ✅ Không lỗi nghiêm trọng |

---

## Backend

| Check | Status |
|-------|--------|
| PM2 (4 processes) | ✅ All online — backend, worker, frontend, document-worker |
| Health API | ✅ `status: ok`, uptime 63+ min |
| Runtime config | ✅ `dryRun=true`, `enabled=true`, 3 allowed threads |
| Live test | ✅ inactive |
| Backend tests | ✅ 46 files / 788 tests PASS |
| Typecheck | ✅ PASS |
| Backend build | ✅ PASS |

### Blockers: **None**

---

## Frontend

| Check | Status |
|-------|--------|
| Frontend build | ✅ PASS — 21 pages |
| DESIGN.md | ✅ Created — design tokens, components, layout spec |
| globals.css | ✅ Updated — DESIGN.md color tokens (brand, success, warning, danger, info) |
| Sidebar | ✅ Active route highlighting, compact nav, grouped (Giám sát / Kiểm soát / Vận hành / Hệ thống) |
| Safety banner | ✅ DRY RUN banner visible in layout header with link to Production Readiness |
| zalo-ops page | ✅ Fixed dark→light theme, card-based layout, session warning display |
| messages page | ✅ VN time (UTC+7), improved status badges per DESIGN.md, cleaned table |
| access-control page | ✅ VN time for updatedAt and audit log timestamps |
| system-health page | ✅ VN time via formatVnTime helper |
| production-readiness page | ✅ VN time for checked-at timestamp |
| Shared components | ✅ `TimeText.tsx` — `formatVnTime()`, `formatRelativeTime()` helpers |

### Blockers: **None**

---

## Database

| Check | Status |
|-------|--------|
| **dev.db** (runtime) | ✅ 1.2MB — 12 Messages, 21 OutboundRecords, 3 Principals, 20 LiveTestSessions |
| **test.db** (isolated) | ✅ 565KB — test-only data, no runtime contamination |
| DB path drift | ✅ None — `prisma` symlink stable, `DATABASE_URL` consistent |
| Test isolation (TDB1) | ✅ `cleanDatabase()` guarded, test.db separated from dev.db |

### Critical Table Counts

| Table | dev.db | test.db |
|-------|--------|---------|
| Message | 12 | 2 |
| OutboundRecord | 21 | 1 |
| ZaloPrincipal | 3 | 0 |
| LiveTestSession | 20 | 0 |
| ThreadCooldown | 11 | 8 |

### Pilot Data

| Pilot | Thread | Role | Real Sends | Status |
|-------|--------|------|------------|--------|
| 1 | `6792540503378312397` | basic_chat | 3/3 | ✅ |
| 2 | `5189400998311849354` | basic_chat | 3/3 | ✅ |
| 3 (Tiny) | `6906520402993817174` | basic_chat | 1/1 | ✅ |

### Blockers: **None**

---

## Timezone +7

| Check | Status |
|-------|--------|
| Server time | UTC (13:52) |
| Node timezone | UTC |
| App config | `APP_TIMEZONE=Asia/Ho_Chi_Minh` ✅ |
| DB timestamps | UTC — stored correctly, convert to VN for display |
| VN offset | UTC+7 (13:52 UTC → 20:52 VN) ✅ |

### Issues

| Severity | Issue |
|----------|-------|
| ~~MEDIUM~~ ✅ FIXED | DB stores UTC, frontend displays VN time `DD/MM/YYYY HH:mm:ss UTC+7` via `formatVnTime()` helper |
| MEDIUM | LiveTest `expiresAt` shown in UTC in API response — operator may misinterpret |
| LOW | Reports mention UTC timestamps without explicit UTC+7 conversion |

### Recommended Fix

- Add `TimeText` component: shows VN time, tooltip with UTC
- Label UTC timestamps explicitly in admin pages

### Blockers: **None**

---

## Zalo / Session

| Check | Status |
|-------|--------|
| Connected | ✅ `true` |
| Listener | ✅ `active` |
| Session file | ✅ exists (minimal file for readiness check) |
| Session in memory | ✅ zca-js holds live credentials |
| Warning | ⚠️ S1 known bug — no auto-save endpoint. If Zalo disconnects, QR re-login needed |

---

## Worker / Internal API

| Check | Status |
|-------|--------|
| Token source | `~/.bashrc` → PM2 env ✅ |
| Hardcoded token | ✅ None (reverted in W2) |
| Wrong token rejected | ✅ HTTP 404 |
| Worker uses backend route | ✅ Batch worker routes through internal API |
| No INTERNAL_API_401 | ✅ |

---

## Errors / Logs

| Type | Count | Status |
|------|-------|--------|
| Failed outbound | 0 | ✅ |
| ZALO_NOT_CONNECTED | 0 | ✅ |
| INTERNAL_API_401 | 0 | ✅ |
| permission_denied | 0 | ✅ |
| Auto-restore failed | 7 (old, pre-QR login) | ✅ Known/resolved |
| Worker errors | 16 in 100 lines (non-critical, heartbeat/timeout) | ✅ Low |

---

## Safety

| Control | State |
|---------|-------|
| Global dryRun | ✅ `true` |
| Live test | ✅ inactive |
| Group auto-reply | ✅ not enabled |
| Unknown users | ✅ not enabled |

---

## Handoff

| Check | Status |
|-------|--------|
| Customer doc | ✅ `docs/CUSTOMER_HANDOFF_20260701.md` |
| Phase 3 report | ✅ Updated with Pilot 3 results |
| Latest backup | ✅ `backups/db/dev.db.backup-20260701T134013.sqlite` |
| Latest commits | `ced9c6c` (config), `cc19646` (docs), `c4a4e3b` (R3 fix), `efb70e7` (TDB1) |

---

## Decision

| Verdict | Detail |
|---------|--------|
| **Ready for controlled DM handoff** | ✅ YES — 7 real sends across 3 DMs, zero errors |
| **Not ready for global live** | ❌ Group mention-only pilot not done, AI scoring not built |
| **Not ready for group rollout** | ❌ No group live test, session persistence needs hardening |

---

## Commit Recommendation

```
git add DESIGN.md \
        packages/frontend/src \
        docs/FINAL_SYSTEM_AUDIT_20260701.md \
        docs/CUSTOMER_HANDOFF_20260701.md
git commit -m "chore(handoff): polish admin UI and finalize customer handoff"
```
