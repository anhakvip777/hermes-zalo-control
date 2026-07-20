# Batch 4.5 / Batch 5 Checkpoint Manifest — 2026-07-20

## Scope and repository identity

- Repository: `E:\BridgeZalo\repo`
- Branch: `master`
- HEAD: `ec7ebe20cbef634fe3ed6f985b82f51ca56d9782`
- Upstream: `origin/master` at `6399e6ddb3d49d70aed397d8388f68af03e5b516`
- Branch relation: ahead 2, behind 0
- Staged files: 0
- Current inventory: 83 tracked modified paths, 0 staged paths and 38 untracked
  checkpoint-input files outside quarantine.
- Ten top-level `.claude/worktrees/**` entries remain quarantined, giving 48
  logical untracked entries under this manifest's non-recursive convention.

No file was staged, committed, pushed, merged, deployed, reset, cleaned, stashed, or discarded while preparing this checkpoint.

## Suggested checkpoint groups

These are review/rollback groups only. Nothing is staged. Use explicit paths if a later, separately approved commit is prepared; never use `git add .`.

### Group A — Test isolation, filesystem safety, config and DB guards

- `package.json`
- `scripts/run-tests.mjs`
- `vitest.config.ts`
- `packages/shared/package.json`
- `packages/shared/vitest.config.ts`
- `packages/backend/package.json`
- `packages/backend/vitest.config.ts`
- `packages/backend/scripts/assert-test-db.mjs`
- `packages/backend/scripts/backup-restore.mjs`
- `packages/backend/scripts/config-check-strict.mjs`
- `packages/backend/scripts/db-guard.mjs`
- `packages/backend/scripts/run-tests.mjs`
- `packages/backend/scripts/secret-audit.mjs`
- `packages/backend/src/backend-paths.ts`
- `packages/backend/src/config-check-cli.ts`
- `packages/backend/src/config-consistency.ts`
- `packages/backend/src/db-guard-startup.ts`
- `packages/backend/src/http/api-error.ts`
- `packages/backend/src/test-env.ts`
- `packages/backend/src/__tests__/backend-paths.test.ts`
- `packages/backend/src/__tests__/backup-restore.test.ts`
- `packages/backend/src/__tests__/batch1-backend-safety.test.ts`
- `packages/backend/src/__tests__/config-check-script.test.ts`
- `packages/backend/src/__tests__/config-consistency.test.ts`
- `packages/backend/src/__tests__/db-guard.test.ts`
- `packages/backend/src/__tests__/shared-setup.ts`
- `packages/backend/src/__tests__/test-runner-safety.test.ts`

### Group B — Backend auth, read-only dashboard APIs and fail-closed runtime safety

- `packages/backend/src/middleware/auth.ts`
- `packages/backend/src/middleware/error-handler.ts`
- `packages/backend/src/routes/admin.ts`
- `packages/backend/src/routes/agent.ts`
- `packages/backend/src/routes/internal.ts`
- `packages/backend/src/routes/system.ts`
- `packages/backend/src/routes/thread-settings.ts`
- `packages/backend/src/routes/zalo.ts`
- `packages/backend/src/services/heartbeat.service.ts`
- `packages/backend/src/services/live-test.service.ts`
- `packages/backend/src/services/message-batch.service.ts`
- `packages/backend/src/services/production-readiness.service.ts`
- `packages/backend/src/services/runtime-config.service.ts`
- `packages/backend/src/services/system-health.service.ts`
- `packages/backend/src/services/thread-settings.service.ts`
- `packages/backend/src/services/zalo-ops.service.ts`
- `packages/backend/src/__tests__/batch-r4b-media-voice.test.ts`
- `packages/backend/src/__tests__/batch-s3-session-autosave.test.ts`
- `packages/backend/src/__tests__/batch-u1-message-status.test.ts`
- `packages/backend/src/__tests__/batch14-message-batching.test.ts`
- `packages/backend/src/__tests__/batch16-zalo-ops.test.ts`
- `packages/backend/src/__tests__/batch17-production-readiness.test.ts`
- `packages/backend/src/__tests__/batch18-live-test.test.ts`
- `packages/backend/src/__tests__/batch3-thread-settings-media.test.ts`
- `packages/backend/src/__tests__/heartbeat.test.ts`
- `packages/backend/src/__tests__/internal.test.ts`
- `packages/backend/src/__tests__/outbound-global-live-guard.test.ts`
- `packages/backend/src/__tests__/retrieval-answer-route.test.ts`
- `packages/backend/src/__tests__/retrieval-dispatch.test.ts`
- `packages/backend/src/__tests__/runtime-config.test.ts`
- `packages/backend/src/__tests__/system-health.test.ts`

### Group C — Frontend auth, truthful status rendering and status-only surfaces

- `packages/frontend/src/app/documents/page.tsx`
- `packages/frontend/src/app/errors/page.tsx`
- `packages/frontend/src/app/layout.tsx`
- `packages/frontend/src/app/media-send/page.tsx`
- `packages/frontend/src/app/messages/page.tsx`
- `packages/frontend/src/app/page.tsx`
- `packages/frontend/src/app/production-readiness/page.tsx`
- `packages/frontend/src/app/retrieval-test/page.tsx`
- `packages/frontend/src/app/safety-mode/page.tsx`
- `packages/frontend/src/app/system-health/page.tsx`
- `packages/frontend/src/app/thread-settings/page.tsx`
- `packages/frontend/src/app/zalo-ops/page.tsx`
- `packages/frontend/src/components/auth-gate.tsx`
- `packages/frontend/src/components/auth-provider.tsx`
- `packages/frontend/src/components/dashboard-shell.tsx`
- `packages/frontend/src/components/operational-status-provider.tsx`
- `packages/frontend/src/components/providers.tsx`
- `packages/frontend/src/lib/admin-auth.test.ts`
- `packages/frontend/src/lib/admin-auth.ts`
- `packages/frontend/src/lib/api-client.test.ts`
- `packages/frontend/src/lib/api-client.ts`
- `packages/frontend/src/lib/api.ts`
- `packages/frontend/src/lib/auth-session-coordinator.test.ts`
- `packages/frontend/src/lib/auth-session-coordinator.ts`
- `packages/frontend/src/lib/batch4-fail-closed.test.ts`
- `packages/frontend/src/lib/dashboard-state.test.ts`
- `packages/frontend/src/lib/dashboard-state.ts`
- `packages/frontend/src/lib/operational-status-coordinator.test.ts`
- `packages/frontend/src/lib/operational-status-coordinator.ts`

### Group D — Batch 5 structured AgentBridge read-only dry-run E2E

- `packages/backend/src/services/agent-bridge/agent-bridge.ts`
- `packages/backend/src/services/agent-bridge/agent-response-schema.ts`
- `packages/backend/src/services/agent-bridge/hermes-adapter.ts`
- `packages/backend/src/services/agent-bridge/index.ts`
- `packages/backend/src/services/agent-bridge/types.ts`
- `packages/backend/src/services/incoming-dispatcher.service.ts`
- `packages/backend/src/services/outbound-dispatcher.service.ts`
- `packages/backend/src/services/outbound-guardrails.service.ts`
- `packages/backend/src/services/tool-gateway/evidence.ts`
- `packages/backend/src/services/tool-gateway/gateway.ts`
- `packages/backend/src/services/tool-gateway/permissions.ts`
- `packages/backend/src/services/tool-gateway/types.ts`
- `packages/backend/src/services/zalo-gateway.service.ts`
- `packages/backend/src/services/zalo-receive.ts`
- `packages/backend/src/__tests__/agent-bridge.test.ts`
- `packages/backend/src/__tests__/batch-audit-echo-guard.test.ts`
- `packages/backend/src/__tests__/batch5-structured-agentbridge-dryrun-e2e.test.ts`
- `packages/backend/src/__tests__/hermes-structured-adapter.test.ts`
- `packages/backend/src/__tests__/incoming-dispatcher.test.ts`
- `packages/backend/src/__tests__/memory-tools.test.ts`
- `packages/backend/src/__tests__/tool-gateway.test.ts`
- `packages/backend/src/__tests__/web-tools.test.ts`
- `packages/backend/src/__tests__/zalo-tools.test.ts`
- `packages/backend/src/__tests__/zalo.test.ts`

### Group E — Plans, designs and authoritative handoff

- `CLAUDE.md`
- `HANDOVER.md`
- `docs/2026-07-20-batch5-structured-agentbridge-dryrun-e2e-design.md`
- `docs/batch5-checkpoint-manifest-2026-07-20.md`
- `docs/superpowers/plans/2026-07-18-batch-1-safety.md`
- `docs/superpowers/plans/2026-07-19-batch-2-auth-polling-lifecycle.md`
- `docs/superpowers/plans/2026-07-19-batch-4-fail-closed.md`
- `docs/superpowers/plans/2026-07-20-batch5-structured-agentbridge-dryrun-e2e.md`
- `docs/superpowers/specs/2026-07-19-batch-2-auth-polling-design.md`
- `docs/superpowers/specs/2026-07-19-batch-4-fail-closed-design.md`

## Quarantine and excluded paths

The following untracked entries are deliberately outside every checkpoint group. They were not inspected recursively, staged, modified, or deleted because they are linked worktrees with potentially uncommitted user changes:

- `.claude/worktrees/agent-a335745b431f284e4/`
- `.claude/worktrees/agent-a3c6c044e517255d1/`
- `.claude/worktrees/agent-a587f8a7d8303dc0f/`
- `.claude/worktrees/agent-a5b3a5df8e0cac117/`
- `.claude/worktrees/agent-a875c349f9fc16a10/`
- `.claude/worktrees/agent-ab9e1da3dd6eb0764/`
- `.claude/worktrees/agent-ac4c3f997e7e8c988/`
- `.claude/worktrees/agent-add0328cda1ba95ee/`
- `.claude/worktrees/agent-ae5b7d653ba5cbbb8/`
- `.claude/worktrees/agent-ae8876e0bf0905519/`

Runtime-sensitive/ignored exclusions remain outside checkpoint groups:

- `packages/backend/prisma/dev.db`
- `packages/backend/zalo-session/`
- `packages/backend/backups/`
- `packages/backend/packages/backend/prisma/`
- `packages/backend/packages/backend/zalo-session/`
- `packages/backend/packages/backend/backups/`
- `E:\BridgeZalo\zalo-bot-2\`

Generated and ignored build outputs were regenerated for verification and left untracked:

- `packages/shared/dist/`
- `packages/backend/dist/`
- `packages/frontend/.next/`
- `packages/frontend/tsconfig.tsbuildinfo`

## Fresh verification evidence

Final gate refresh: 2026-07-20 20:05 UTC+7.

| Gate | Fresh result |
|---|---|
| Focused implementation review | 4 files / 172 tests passed, exit 0; spec and standards approved |
| Focused structured E2E | 1 file / 1 test passed, exit 0 |
| Full root test suite | backend 84 files / 1336 tests, shared 6 tests, frontend 106 tests; exit 0 |
| Monorepo typecheck | shared/backend/frontend exit 0 |
| Monorepo build | shared/backend/frontend exit 0; Next generated 24/24 pages |
| Whitespace | `git diff --check`, exit 0 (LF/CRLF warnings only) |
| Schema/migration guard | no diff under `packages/backend/prisma` or `schema.prisma` |
| Strict config positive | `CONFIG_WARN`, PASS=8/WARN=1/ERROR=0, exit 0 |
| Strict config negative | `CONFIG_ERROR`, PASS=5/WARN=1/ERROR=3, blocked with exit 1 as expected |
| DB guard | runtime `dev.db` exists, 688 KB, health PASS |
| Secret audit | 573 files scanned, 0 findings; 110 pre-existing backup/session path warnings remain quarantined |
| Structured E2E | real Bridge/Gateway/dispatcher path, one read tool round, second adapter round, dry-run outbound, linked evidence, replay suppression, zero provider send |
| Isolated built-backend smoke | corrected one-shot port-3402 run exited 0 after startup and 8/8 semantic GET checks returned HTTP 200 JSON; Zalo/listener/live-test stayed inactive; its temporary root and backend lock were absent and port 3402 was closed afterward; the earlier wrapper-only exit 1 is superseded |
| Browser QA | login reject/accept, backend-up status-only routes, backend-down and malformed fail-closed states, no mutation/live controls; actual backend 24 GET/0 mutation, malformed server 14 GET/0 mutation |
| Runtime DB integrity | SHA-256 unchanged: `36216E4786EF437833D2BFBF398BFD1F53B4BB4A0F49EF5155DF8286A30736E9` |
| Cleanup | no repo backend/Next/malformed QA process, no listeners on 3001/3002/3102/3302/3402, no Browser-QA root, lock, goal temp directory, or `test-*.db` |

The final refresh reproduced two sandbox-only execution limits. Prisma was
blocked by `spawn EPERM` before Vitest and left one zero-byte isolated test DB;
the exact `npm test` command passed outside the sandbox and that artifact was
removed. The in-sandbox Next build later stalled after shared/backend completed;
the goal-created Next process was stopped and the exact `npm run build`
command passed outside the sandbox with 24/24 pages. Neither event required a
source change, and no process or temporary test DB remained.

The repeated `9router\mitm\rootCA.crt` warning is an environmental Node diagnostic. It did not change a gate exit code.

On this Windows host, Prisma's absolute SQLite `db push` returned the opaque
`Schema engine error` when the target file did not exist and succeeded when the
same writable target was pre-created. The repository test runner already follows
that safe pattern; no schema, migration or source change was required.

## Safety conclusion

- Structured mode remains default OFF.
- Flag OFF retains the text-only path.
- Flag ON grants only `memory.getRecentMessages`, and every call goes through `ToolGateway`.
- Structured success reaches only `OutboundDispatcher.sendOutbound()` with `deliveryPolicy: "dry_run_only"`.
- Malformed, unknown, disallowed, timeout, provider, evidence and loop-limit failures are terminal and do not fall back to text or live outbound.
- No Prisma schema/migration, runtime DB/session/backup/secret, global-live, real Zalo, QR, login, reconnect, disconnect, commit, push, merge or deploy operation occurred.
- Production/live pilot remains outside this checkpoint and requires separate approval.

## Pre-publish refresh — 2026-07-20 21:40 UTC+7

Fresh `npm test` exited 0 (backend 84 files / 1336 tests, shared 6 tests,
frontend 106 tests). Fresh `npm run typecheck` and `npm run build` exited 0;
Next generated 24/24 pages. A built-backend smoke on port 3402 used a
pre-created temporary SQLite DB, empty temporary session directory, synthetic
credentials, strict config, auto-reply OFF, dry-run ON and structured mode OFF.
All eight semantic GET checks returned HTTP 200 JSON; Zalo stayed disconnected,
the listener stayed inactive, and the process, port, lock and temporary root
were cleaned up.

The runtime `dev.db` SHA-256 remained
`36216E4786EF437833D2BFBF398BFD1F53B4BB4A0F49EF5155DF8286A30736E9`. No
`test-*.db` remains and there is no schema/migration diff. Secret audit and DB
guard exited 0. Git credential access was verified with
`git push --dry-run origin master`; it reported `6399e6d..ec7ebe2` can be
pushed without updating the remote.

The host's actual `.env` does not satisfy strict startup because
`CHIASEGPU_API_KEY` is absent. The checker returned `CONFIG_ERROR`/exit 1.
No secret was generated, copied, printed or written. A VPS using
`STRICT_CONFIG_CHECK=true` must provide that operator credential; isolated
verification used a synthetic value only.

### External QA artifacts in `C:\tmp` (excluded from Git)

- `C:\tmp\bridgezalo-manual-qa-20260720-201326\`: 18 files, 700,290
  bytes, including a QA DB, helpers, logs and sensitive session backup copies.
  No session content was read.
- `C:\tmp\bridgezalo-github-publish-20260720\`: 2 test log files, 87,993
  bytes.
- `C:\tmp\batch1-*` and `C:\tmp\apply-batch-*`: 48 older patch/apply
  artifacts, 63,667 bytes.

The final smoke root `C:\tmp\bridgezalo-final-smoke-20260720-2140\` was
removed; port 3402 is closed and
`C:\tmp\hermes-zalo-control\backend.lock` is absent. No external QA
artifact is staged or eligible for commit.
