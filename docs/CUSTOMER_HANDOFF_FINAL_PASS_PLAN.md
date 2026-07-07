# Customer Handoff Final Pass Plan

Status: PLAN FOR AGENT EXECUTION ONLY. No live. No Zalo reconnect. No deploy.

Baseline expected:
- `HEAD == origin/master == 4777e7f`
- Working tree clean before execution
- Session file may exist locally at `packages/backend/zalo-session/zalo-session.json`; do not read, delete, stage, commit, or print it.

## Goal

Prepare the repo for customer handoff/publication without adding features or running live systems.

## Strict limits

- Do not start backend/frontend dev servers.
- Do not reconnect Zalo.
- Do not scan QR.
- Do not send Zalo messages.
- Do not enable live, autoReply live, or bridge.
- Do not deploy.
- Do not edit `.env`.
- Do not read or print secret/session contents.
- Do not touch schema/migration.
- Do not delete DB, backups, session, or logs.
- Do not commit session, `.env`, DB, logs, QR, backups, tokens, cookies, or code feature changes.

## Step A — Verify git baseline

Run:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/master
```

Pass criteria:
- HEAD equals origin/master.
- Expected hash is `4777e7f` unless a later approved commit exists.
- Working tree is clean except this plan/handoff docs if created in this task.

## Step B — Sensitive file check

Check tracked/staged/ignored status only. Do not print contents.

Must verify these are not tracked/staged:
- `.env`
- `packages/backend/.env`
- `zalo-session/`
- `packages/backend/zalo-session/zalo-session.json`
- session/token/cookie files
- QR images
- `*.db`, `*.db-wal`, `*.db-shm`
- `backups/`
- logs/temp scripts

If any sensitive file is tracked or staged: STOP and report.

## Step C — Verification checks

Run quick checks only:

```bash
npm run typecheck -w packages/backend
npm run typecheck -w packages/frontend
```

Run targeted retrieval tests using the repo-safe test DB workflow. Do not use runtime `dev.db`.

Suggested backend command pattern:

```bash
cd packages/backend
DATABASE_URL="file:./test.db" NODE_ENV=test npx prisma db push --skip-generate
DATABASE_URL="file:./test.db" NODE_ENV=test npx vitest run retrieval-intent retrieval-answer retrieval-dispatch
```

Also run secret audit if available:

```bash
npm run secret:audit
```

Record exit codes. If command cannot run, report why.

## Step D — Verify example env files

Check `.env.example` and `packages/backend/.env.example` if present.

Must include safe sample defaults or equivalent docs:
- `ZALO_AUTO_REPLY_ENABLED=false`
- `ZALO_AUTO_REPLY_DRY_RUN=true`
- `HERMES_AGENT_BRIDGE_ENABLED=false`
- `RETRIEVAL_DISPATCHER_DRYRUN_ENABLED=false`
- `ZALO_DRY_RUN=false`

Must not contain real secrets.

If only comments/sample defaults are missing, make minimal example-env edits. Do not edit real `.env`.

## Step E — Customer handoff doc

Create or update:

`docs/CUSTOMER_HANDOFF_20260707.md`

Required contents:

1. Current commit hash.
2. Repo status: clean/synced.
3. What works:
   - controlled dry-run
   - allowlist/default-deny
   - inbound redaction
   - identity/thread normalization
   - listener recovery
   - outbound dispatcher / dryRun gate
   - retrieval answer and media OCR search
   - real-listener dry-run safety PASS
   - retrieval `not_found` bug fixed
4. What is not live:
   - no production live send
   - global live OFF
   - autoReply OFF by default
   - structured bridge OFF
5. Safety flags and defaults.
6. Known limitations:
   - Phase 9 limited live test not executed
   - reminder/schedule idempotency deferred
   - live-test quota atomicity deferred
   - reaction/poll governed DB evidence gap
   - full Tool Gateway / agent-agnostic bridge not complete
   - web search gateway not built
   - original media resend not built
   - legacy secretary features not fully rebuilt
7. Session file note:
   - local session may exist
   - not committed
   - do not include in zip/export
8. Customer-safe next step:
   - controlled demo / dry-run pilot
   - if live desired: Phase 9 limited live 1-DM with TTL/quota/kill-switch and explicit approval
9. Export instructions:
   - use clean git archive/remote
   - exclude ignored local files
   - do not zip working directory with session/db/logs

## Step F — Diff and commit rules

Show:

```bash
git diff --stat
git diff --name-only
```

Allowed changed files:
- `docs/CUSTOMER_HANDOFF_20260707.md`
- this plan file if newly created/updated
- `.env.example` files only if needed

No code files unless separately approved.

If only allowed files changed, commit:

```bash
git add docs/CUSTOMER_HANDOFF_20260707.md docs/CUSTOMER_HANDOFF_FINAL_PASS_PLAN.md
# add .env.example files only if changed and safe
git commit -m "docs: add customer handoff readiness report"
git push origin master
```

After push verify:

```bash
git fetch origin
git rev-parse HEAD
git rev-parse origin/master
git rev-list --left-right --count HEAD...origin/master
git status --short --branch
```

Pass criteria:
- HEAD equals origin/master.
- ahead/behind is `0 0`.
- working tree clean.

## Step G — Final report

Report only:
- baseline hash
- final commit hash
- files changed
- checks run + exit codes
- sensitive-file check result
- secret audit result
- env example status
- handoff doc path
- known limitations summary
- confirmation: no Zalo/listener/reconnect/QR/live/send/deploy
- confirmation: no session/env/db/log/QR/backups committed

Stop after report.
