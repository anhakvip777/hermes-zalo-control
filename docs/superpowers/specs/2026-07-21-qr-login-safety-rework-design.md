# QR Login Safety Rework Design

**Goal:** Make every Zalo login, session restore, reconnect, and QR retrieval path obey one fail-closed safety decision without changing auto-reply, Agent Bridge, database schema, or live-send behavior.

**Scope:** Backend Zalo gateway/routes/reconnect reporting and the existing QR-login UI flow. No Prisma schema/migration changes and no edits to the standard `.env`, database or Zalo session. A later, explicitly isolated local QR smoke may use process-scoped environment values and temporary resources; it must never touch the standard runtime.

## Decision model

`ZaloLoginSafetyGate` will be a pure evaluator of static/effective dry-run state. It returns an allow/block decision and a stable reason; it never mutates gateway state. The gateway applies a blocked decision only to the operation being requested:

Static and effective dry-run serve separate safety boundaries: `staticDryRun=false` permits a real Zalo connection, while `effectiveDryRun=true` keeps outbound actions in dry-run. The gate follows this truth table:

| staticDryRun | effectiveDryRun | Decision |
| --- | --- | --- |
| `true` | `true` | Block: `STATIC_DRY_RUN_ENABLED` |
| `true` | `false` | Block: `STATIC_DRY_RUN_ENABLED` |
| `false` | `true` | Allow |
| `false` | `false` | Block: `OUTBOUND_DRY_RUN_REQUIRED` |

- A fresh login/restore/reconnect must not create a Zalo client, begin QR, restore credentials, schedule another retry, or return QR content.
- A decision must not force an already-connected gateway to report disconnected or stop an existing listener.
- A blocked decision observed while a QR operation is in progress invalidates that operation through a monotonically increasing login generation. Its eventual completion may not persist a session, set connected state, or start a listener.

## Gateway lifecycle

The gateway owns an incrementing `loginGeneration`. Starting a QR flow captures the current generation. `cancelLogin` and a later blocked decision invalidate the active generation and remove the current QR artifact. Background callbacks check their captured generation before each externally visible state change.

The gateway invokes the gate before `startLogin`, `restoreSession`, the scheduled reconnect attempt, and the admin reconnect path. A blocked reconnect is terminal for that attempt: it records a blocked result but does not schedule backoff or convert the blocker into `RECONNECT_EXHAUSTED`.

## QR API and UI

`GET /api/zalo/login/qr` evaluates the same gate before reading `qr-current.png`; blocked returns the stable login-safety error and never returns a stale file. Gateway status exposes `qrAvailable` only for a valid current generation.

The browser enters `pending` and starts status polling after a successful `connecting` response. `QR_NOT_FOUND` is transient while generation is pending; polling retries until QR appears, the status becomes connected/expired/blocked, or the component unmounts. A blocked status stops polling, clears the QR, and presents the gate reason rather than a generic login error.

## Compatibility boundaries

- Existing connected sessions remain truthful; the rework never disconnects them merely because a fresh-login policy becomes blocked.
- `ZALO_DRY_RUN=false` is required for a real QR/session connection, while effective outbound dry-run must remain enabled. The login gate does not treat those intentionally different values as a mismatch and does not make a synthetic connection.
- Auto-reply remains disabled and Agent Bridge remains disabled; neither implementation nor tests touch their code paths.

## Acceptance tests

Backend tests must cover: blocked fresh start, blocked restore, blocked admin/auto reconnect without reschedule, blocked QR fetch with stale file, connected state preserved on a new blocked request, and late QR completion ignored after cancellation/block.

Frontend tests must cover: `connecting` plus initial `QR_NOT_FOUND` continues polling until QR exists, and a blocked safety status clears QR/stops polling without another QR request.

Completion is staged: focused tests, full `npm test`, `npm run typecheck`, `npm run build`, `git diff --check`, browser fail-closed QA, then (when explicitly authorized) one isolated local QR scan with outbound dry-run. VPS deployment/smoke and any merge or push are separate approvals; the VPS smoke never scans a QR.
