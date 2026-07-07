# Customer Handoff — Hermes Zalo Bridge

Date: 2026-07-07
Prepared as a customer handoff / publication readiness report. No live systems were run to produce this document.

## 1. Current commit

- Commit at handoff (baseline): `4777e7f` (`4777e7fa7614660e08b0c25e3bcd889ca1e12aa9`)
- This handoff commit updates only documentation and `.env.example` templates.

## 2. Repo status

- Working tree clean before this handoff work.
- `HEAD == origin/master` at baseline.
- Synced with remote `origin/master`.

## 3. What works

- **Controlled dry-run.** Outbound is dry-run by default; no real Zalo send occurs unless a scoped live-test session explicitly bypasses it.
- **Allowlist / default-deny.** Threads are denied by default; only allowlisted threads are processed.
- **Inbound redaction.** Inbound message content and metadata are redacted (secrets, tokens, JWT, phone, high-entropy strings) before being persisted.
- **Identity / thread normalization.** `senderId` / `threadId` / `threadType` normalized; sender id is never derived from display name; identity confidence recorded.
- **Listener recovery.** Session/listener watchdog + auto-recovery; recovery never toggles autoReply or live.
- **Outbound dispatcher / dryRun gate.** `OutboundDispatcher.sendOutbound()` is the sole outbound door; hard dryRun/live gate; persistent idempotency on text replies.
- **Retrieval answer + media OCR search.** Evidence-backed answers composed from indexed messages and attachment OCR text; scope-guarded; no hallucination on not-found/unreadable.
- **Real-listener dry-run safety PASS.** A one-time local dry-run with the real listener received real inbound and produced only dry-run outbound records — no live send, no bridge, no provider.
- **Retrieval `not_found` bug fixed.** Not-found queries no longer return false `found` via self-match of the user's own request message or via generic command words (fixed in `4777e7f`).

## 4. What is not live

- No production live send.
- Global live is OFF.
- AutoReply is OFF by default.
- Structured agent bridge is OFF.

## 5. Safety flags and defaults

| Flag | Default | Meaning |
|------|---------|---------|
| `ZALO_AUTO_REPLY_ENABLED` | `false` | AutoReply pipeline disabled |
| `ZALO_AUTO_REPLY_DRY_RUN` | `true` | AutoReply never sends real Zalo |
| `HERMES_AGENT_BRIDGE_ENABLED` | `false` | Structured agent bridge disabled |
| `RETRIEVAL_DISPATCHER_DRYRUN_ENABLED` | `false` | Retrieval dispatch inert unless explicitly enabled (dry-run only when enabled) |
| `ZALO_DRY_RUN` | `false` in root example / `true` in backend example | Provider-level dry-run switch |

Enabling live sending requires changing these flags AND explicit approval. No flag alone enables production live.

## 6. Known limitations

- Phase 9 limited live test **not executed**.
- Reminder / schedule idempotency **deferred**.
- Live-test quota atomicity **deferred**.
- Reaction / poll governed-action DB evidence gap (dryRun-gated but no DB evidence yet).
- Full Tool Gateway / agent-agnostic bridge **not complete** (`HermesAgentBridge` is a stub, referenced by tests only).
- Web search gateway **not built**.
- Original media resend **not built**.
- Legacy secretary features **not fully rebuilt**.

## 7. Session file note

- A local Zalo session file may exist at `packages/backend/zalo-session/zalo-session.json`.
- It is **git-ignored and not committed**.
- Do **not** include it in any zip / export / archive.

## 8. Customer-safe next step

- Recommended: controlled demo / dry-run pilot (no real send).
- If live sending is desired: run **Phase 9 limited live** — a single DM, with TTL + quota + kill-switch, under explicit approval only.

## 9. Export instructions

- Export via a clean `git archive` or a fresh clone from the remote.
- Exclude ignored local files (`.env`, `zalo-session/`, `*.db`, `backups/`, logs, QR images).
- Do **not** zip the working directory directly — it may contain the local session file, dev DB, and logs.
