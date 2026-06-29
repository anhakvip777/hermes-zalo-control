# Feature Matrix

| Feature | Batch | Status | UI | API | Safety | Test Status |
|---------|-------|--------|----|-----|--------|-------------|
| **Core** | | | | | | |
| Zalo message receive | 1-3 | ✅ Stable | `/messages` | `/api/messages` | allowlist + self-guard | 586/586 PASS |
| Zalo message send (dryRun) | 1 | ✅ Stable | — | `/api/zalo/send` | dryRun enforced | ✅ |
| Zalo message send (live) | 1 | ✅ Stable | `/safety-mode` | `/api/zalo/send` | quota + TTL + fallback | ✅ |
| dryRun/live safety toggle | 1 | ✅ Stable | `/safety-mode` | runtime config | double confirm | ✅ |
| **Scheduling** | | | | | | |
| Schedule CRUD | 2-3 | ✅ Stable | `/schedules` | REST API | version guard + atomic claim | ✅ |
| Schedule execution | 2-3 | ✅ Stable | `/schedules/[id]` | worker polling | dryRun-respecting | ✅ |
| Reminder from natural language | 3 | ✅ Stable | — | `/api/agent/parse` | unsupported claim guard | ✅ |
| **Rule Engine** | | | | | | |
| Keyword/regex triggers | 4-6 | ✅ Stable | `/rules` | REST API | priority-based | ✅ |
| fixed_reply action | 4-6 | ✅ Stable | `/rules` | REST API | cooldown per rule | ✅ |
| Route to Hermes action | 4-6 | ✅ Stable | `/rules` | REST API | — | ✅ |
| Rule versioning + audit | 4-6 | ✅ Stable | `/rules` | REST API | full audit trail | ✅ |
| **Outbound Safety** | | | | | | |
| Deduplication | 4 | ✅ Stable | — | gate check | 60s window | ✅ |
| Rate limiting | 4 | ✅ Stable | — | gate check | per-thread + global | ✅ |
| Content sanitization | 4 | ✅ Stable | — | gate check | smart quotes, length | ✅ |
| **AI Integration** | | | | | | |
| Image/OCR understanding | 7 | ✅ Stable | — | Hermes CLI | vision API | ✅ |
| Document/PDF ingestion | 12-13 | ✅ Stable | `/documents` | `/api/documents` | Docling spawn | ✅ |
| Document Q&A | 12-13 | ✅ Stable | — | Hermes CLI | chunk-based | ✅ |
| **Performance** | | | | | | |
| Message batching | 14 | ✅ Stable | — | batch worker | maxMessages + maxChars | ✅ |
| Debounce window | 14 | ✅ Stable | `/runtime-settings` | config | configurable 4-10s | ✅ |
| **Operations** | | | | | | |
| Runtime settings (hot) | 15 | ✅ Stable | `/runtime-settings` | REST + audit | safe validation | ✅ |
| Secret audit | 15 | ✅ Stable | CLI | `npm run secret:audit` | HIGH/MEDIUM/LOW | ✅ |
| Backup/restore | 15 | ✅ Stable | CLI | `npm run backup:*` | verified restore | ✅ |
| DB guard | 15 | ✅ Stable | CLI | `npm run db:guard` | pre-start check | ✅ |
| Zalo Ops dashboard | 16 | ✅ Stable | `/zalo-ops` | `/api/zalo/*` | connection health | ✅ |
| Production readiness gate | 17 | ✅ Stable | `/production-readiness` | REST | 12-point check | ✅ |
| Process lock | 17 | ✅ Stable | — | lock file | single instance | ✅ |
| **Live Pilot** | | | | | | |
| Controlled live test | 18 | ✅ Stable | `/safety-mode` | `/api/system/live-test/*` | quota + TTL + auto-complete | ✅ |
| Live quota completion | 20 | ✅ PASS | — | live test session | sentCount ≤ maxMessages | ✅ |
| Post-quota dryRun fallback | 20 | ✅ PASS | — | auto-detect | effective dryRun=true | ✅ |
| Unsupported claim guard | 14 | ✅ Stable | — | dispatcher | blocks fabricated claims | ✅ |
| **Monitoring** | | | | | | |
| System health dashboard | 10 | ✅ Stable | `/system-health` | heartbeat service | stale detection | ✅ |
| Error dashboard | 10 | ✅ Stable | `/errors` | AgentTask tracking | alert summary | ✅ |
| Thread review | 3 | ✅ Stable | `/thread-review` | REST | per-thread config | ✅ |
| **Release** | | | | | | |
| Release package / docs | 21 | ✅ PASS | — | — | — | ✅ |

## Legend

- ✅ Stable — production-ready, fully tested
- ✅ PASS — tested and verified in controlled pilot
- 🚧 Beta — functional but needs more testing
- ❌ Not supported — known limitation (see KNOWN_LIMITATIONS.md)
