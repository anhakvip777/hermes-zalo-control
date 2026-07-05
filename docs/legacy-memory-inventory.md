# Legacy Memory Inventory (zalo-bot-2/workspace/memory)

Read-only inventory. No content dumped. PII/secrets redacted in all derived docs.
Source: `E:\BridgeZalo\zalo-bot-2\workspace\memory` · captured 2026-07-05.

## Totals
- **218 files, ~2.4 MB.**
- By extension: `.json` 106, `.jsonl` 48, `.md` 48, `.txt` 15.

## Top-level layout (files, size)
| Entry | Kind | Files | Size | Role |
|---|---|---|---|---|
| `chat-log/` | dir | 23 | ~2.0 MB | **daily conversation logs** (jsonl, 2026-05-15 → 06-06) |
| `outbound-audit/` | dir | 19 | 315 KB | **send audit** (decision/reason/verifiedBy per send) |
| `outbound-dedupe/` | dir | 104 | 50 KB | one json per send signature (**dedupe store**) |
| `threads/` | dir | 18 | 24 KB | per-thread context/follow-up notes |
| `sent-context/` | dir | 15 | 10 KB | per-thread last-sent context |
| `thu-ky/` | dir | 5 | 5 KB | **secretary workflow** per person (schedule/roster/templates) |
| `.dreams/` | dir | 2 | 25 KB | **agent memory recall** (short-term-recall.json, events.jsonl) |
| `raw-inbound/` | dir | 2 | 6 KB | raw inbound capture |
| `conversation-audit/` | dir | 1 | 1 KB | audit stream — **only smoke-test rows** |
| `runtime-errors/` | dir | 1 | 0 KB | **empty** (audit scaffolded, unused) |
| `dropped-group-inbound/` | dir | 1 | 0 KB | **empty** |
| `followup-archive/` | dir | 1 | 8 KB | archived follow-ups (json) |
| `nhac-nho/` | dir | 1 | 1 KB | reminder templates |
| daily `YYYY-MM-DD.md` | files | ~18 | small | per-day conversation tallies (per-user msg counts) |
| business `.md` | files | 5 | small | Vesak plan, team roster, CRM login, checkpoints, event memory |

## Largest files
`chat-log/2026-05-30.jsonl` 285 KB, `…05-27` 203 KB, `…05-29` 198 KB, `…05-28` 183 KB,
`…05-16` 178 KB; `outbound-audit/2026-05-22.jsonl` 51 KB; `.dreams/short-term-recall.json` 14 KB.

## Timeline
Oldest `2026-05-11.md`; active through **2026-06-06** (last chat-log + outbound-audit + threads).

## Folder classification
- **Chatlog:** `chat-log/`, `chat-log-archive-2026-05.md`, daily `*.md`.
- **Send/outbound:** `outbound-audit/`, `outbound-dedupe/`, `sent-context/`, `followup-archive/`.
- **Thread/context:** `threads/`, `sent-context/`, `.dreams/`.
- **Task/workflow (business):** `thu-ky/`, `nhac-nho/`, `ke-hoach-vesak-2026.md`, `team-nhan-su-vesak-2026.md`, `dai-le-hoi-chau-phap-2026.md`, `checkpoint-2026-05-16.md`.
- **Errors/audit:** `runtime-errors/` (empty), `dropped-group-inbound/` (empty), `conversation-audit/` (smoke only) — **operational audit largely unpopulated**; real signal lives in `outbound-audit/` decisions.

## Sensitive content (NOT copied; redacted everywhere)
- `ctn-crm-login.md` — **plaintext CRM email + password** (secret leak in memory).
- `team-nhan-su-vesak-2026.md`, `checkpoint-2026-05-16.md`, daily logs — **real names + phone numbers + Zalo user IDs** (PII).
- No `.env`/session/cookie/key/QR files exist under `memory/` (those live under `config/` and were not read).
