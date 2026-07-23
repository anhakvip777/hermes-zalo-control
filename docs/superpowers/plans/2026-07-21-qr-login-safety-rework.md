# QR Login Safety Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make every Zalo QR-login, session-restore, reconnect and QR-read path fail closed unless static policy permits a real connection and effective policy keeps outbound actions in dry-run, without changing database schema, runtime settings, Zalo data, outbound behavior or agent behavior.

**Architecture:** Add a pure ZaloLoginSafetyGate that converts static config.zalo.dryRun and getCurrentEffectiveDryRun() into one stable allow/block decision. The gateway owns generation invalidation and applies a block only to the requested or in-flight login operation; routes and admin reconnect reuse the same decision. A small frontend polling policy translates truthful backend status into actions, keeping QR_NOT_FOUND transient and stopping immediately on a safety block.

**Tech Stack:** TypeScript, Fastify, Vitest, Next.js/React. No new dependencies, Prisma changes, migrations, standard config writes, or standard session/DB mutation. A separately authorized local QR smoke may use process-scoped values and temporary resources only.

## Progress checkpoints

| Checkpoint | Cumulative QR Safety Rework | Evidence required |
|---|---:|---|
| Current worktree baseline | ~50% | Existing focused backend/frontend tests |
| Safety policy + lifecycle + regressions | 78% | Isolated backend suites and full test |
| Frontend state machine + `/zalo-ops` fail-closed QA | 93% | Frontend tests, typecheck and browser evidence |
| Full verification/diff review | 97% | Full test, typecheck, build, inventory |
| Isolated local QR smoke | 99% | Temporary DB/session, no outbound send |
| Narrow commit + approved VPS smoke | 100% | Commit review and VPS HTTP 200/409 evidence |

---

## File structure

| File | Action | Responsibility |
| --- | --- | --- |
| packages/backend/src/services/zalo-login-safety.service.ts | Create | Pure static/effective dry-run evaluator and stable block reason. |
| packages/backend/src/__tests__/zalo-login-safety.test.ts | Create | Unit contract for all gate combinations. |
| packages/backend/src/services/zalo-gateway.service.ts | Modify | Gate lifecycle and invalidate stale QR work with a generation. |
| packages/backend/src/services/zalo-ops.service.ts | Modify | Return an audited, terminal blocked result before admin reconnect begins. |
| packages/backend/src/routes/zalo.ts | Modify | Fail closed before any QR-file read and return one API error code. |
| packages/backend/src/__tests__/qr-login-safety.test.ts | Create | Gateway, reconnect and route regression tests with mocked filesystem/network. |
| packages/frontend/src/lib/zalo-login-polling.ts | Create | Pure mapping from login status to one polling action. |
| packages/frontend/src/lib/zalo-login-polling.test.ts | Create | Frontend polling safety contract without browser-only dependencies. |
| packages/frontend/src/components/zalo-login-card.tsx | Modify | Consume polling policy; clear QR and stop polling when blocked. |
| packages/frontend/src/lib/api-client.ts | Modify | Type the new backend connection statuses; no request semantics change. |

## Safety contract

- Static and effective dry-run protect separate boundaries: `staticDryRun=false` permits a real connection, while `effectiveDryRun=true` requires outbound actions to remain dry-run.

| staticDryRun | effectiveDryRun | Decision |
| --- | --- | --- |
| `true` | `true` | Block: `STATIC_DRY_RUN_ENABLED` |
| `true` | `false` | Block: `STATIC_DRY_RUN_ENABLED` |
| `false` | `true` | Allow |
| `false` | `false` | Block: `OUTBOUND_DRY_RUN_REQUIRED` |

- API responses use stable public error code LOGIN_SAFETY_BLOCKED. The reason is safe diagnostic text, never session data.
- A block never changes a truthful existing connected state or stops its listener. For a disconnected in-flight QR flow it clears the QR artifact, increments the generation and reports connectionStatus: blocked.
- A blocked reconnect is terminal: it does not call restoreSession, startLogin, scheduleReconnect, or convert the reason to RECONNECT_EXHAUSTED.

### Task 1: Define and lock the pure login-safety decision

**Files:**

- Create: packages/backend/src/services/zalo-login-safety.service.ts
- Create: packages/backend/src/__tests__/zalo-login-safety.test.ts

- [ ] **Step 1: Write the failing gate-contract test**

~~~ts
import { describe, expect, it } from "vitest";
import { evaluateZaloLoginSafety } from "../services/zalo-login-safety.service.js";

describe("ZaloLoginSafetyGate", () => {
  it.each([
    [
      { staticDryRun: true, effectiveDryRun: true },
      { allowed: false, reason: "STATIC_DRY_RUN_ENABLED" },
    ],
    [
      { staticDryRun: true, effectiveDryRun: false },
      { allowed: false, reason: "STATIC_DRY_RUN_ENABLED" },
    ],
    [
      { staticDryRun: false, effectiveDryRun: true },
      { allowed: true, reason: null },
    ],
    [
      { staticDryRun: false, effectiveDryRun: false },
      { allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" },
    ],
  ] as const)("evaluates static/effective dry-run policy %#", (input, expected) => {
    expect(evaluateZaloLoginSafety(input)).toEqual(expected);
  });
});
~~~

- [ ] **Step 2: Run the test and confirm RED**

Run: `$env:ZALO_DRY_RUN="false"; try { npm test -w packages/backend -- src/__tests__/zalo-login-safety.test.ts } finally { Remove-Item Env:ZALO_DRY_RUN -ErrorAction SilentlyContinue }`

Expected: FAIL because the new service does not exist.

- [ ] **Step 3: Add the minimal pure evaluator**

~~~ts
export type ZaloLoginSafetyReason =
  | "STATIC_DRY_RUN_ENABLED"
  | "OUTBOUND_DRY_RUN_REQUIRED";

export type ZaloLoginSafetyDecision =
  | { allowed: true; reason: null }
  | { allowed: false; reason: ZaloLoginSafetyReason };

export function evaluateZaloLoginSafety(input: {
  staticDryRun: boolean;
  effectiveDryRun: boolean;
}): ZaloLoginSafetyDecision {
  if (input.staticDryRun) {
    return { allowed: false, reason: "STATIC_DRY_RUN_ENABLED" };
  }
  if (!input.effectiveDryRun) {
    return { allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" };
  }
  return { allowed: true, reason: null };
}
~~~

Do not import Fastify, Prisma, filesystem, zca-js, or mutate global state in this service.

- [ ] **Step 4: Run the test and confirm GREEN**

Run: `$env:ZALO_DRY_RUN="false"; try { npm test -w packages/backend -- src/__tests__/zalo-login-safety.test.ts } finally { Remove-Item Env:ZALO_DRY_RUN -ErrorAction SilentlyContinue }`

Expected: PASS, exit 0.

- [ ] **Step 5: Record the gate checkpoint without committing**

Keep the worktree uncommitted until Task 8. Re-run the focused test and inventory the exact changed paths.

### Task 2: Guard gateway lifecycle and invalidate late QR work

**Files:**

- Modify: packages/backend/src/services/zalo-gateway.service.ts
- Create: packages/backend/src/__tests__/qr-login-safety.test.ts

- [ ] **Step 1: Write failing gateway tests**

Use hoisted mocks for config, runtime-config, node:fs and zca-js. The suite must prove: blocked start creates no client and no synthetic connection; blocked restore reads no session file; blocked new request preserves an already-connected status; cancelling a QR flow makes a late success unable to persist a session, set connected or start a listener; and a blocked scheduled reconnect neither restores, starts login, nor queues another timer.

~~~ts
it("blocks start before it creates a client or synthetic connection", async () => {
  const gateway = new ZaloGatewayService();
  await expect(gateway.startLogin()).resolves.toEqual({
    status: "blocked",
    reason: "STATIC_DRY_RUN_ENABLED",
  });
  expect(ZaloConstructor).not.toHaveBeenCalled();
  expect(gateway.getStatus().connected).toBe(false);
});

it("preserves existing connection on blocked new request", async () => {
  const gateway = new ZaloGatewayService();
  (gateway as any).status = { ...gateway.getStatus(), connected: true, connectionStatus: "connected" };
  await gateway.startLogin();
  expect(gateway.getStatus()).toMatchObject({ connected: true, connectionStatus: "connected" });
});
~~~

- [ ] **Step 2: Run focused gateway tests and confirm RED**

Run: `$env:ZALO_DRY_RUN="false"; try { npm test -w packages/backend -- src/__tests__/qr-login-safety.test.ts } finally { Remove-Item Env:ZALO_DRY_RUN -ErrorAction SilentlyContinue }`

Expected: FAIL because blocked results, generation checks and terminal reconnect handling do not exist.

- [ ] **Step 3: Implement the smallest gateway changes**

Add fields beside the existing login state:

~~~ts
private loginGeneration = 0;
private activeLoginGeneration: number | null = null;
~~~

Add a synchronous wrapper:

~~~ts
private getLoginSafetyDecision() {
  return evaluateZaloLoginSafety({
    staticDryRun: config.zalo.dryRun,
    effectiveDryRun: getCurrentEffectiveDryRun(),
  });
}
~~~

Implement invalidateActiveLogin(reason): increment loginGeneration, clear activeLoginGeneration, set loginInProgress false, clear qrUpdatedAt, remove only qr-current.png, and set connectionStatus: blocked plus lastError: LOGIN_SAFETY_BLOCKED:<reason> only if not already connected. Reuse it from cancelLogin so cancellation does not overwrite a connected status.

Apply the gate before the current config.zalo.dryRun branch in startLogin and restoreSession. On block return { status: "blocked", reason } from startLogin and false from restoreSession; neither branch may instantiate zca-js, read credentials, write credentials or call setConnected.

Capture generation when starting QR. Keep zca-js client and API local inside runLoginInBackground(generation); before writing QR, setting QR timestamp/status, persisting credentials, calling setConnected, starting listener or emitting ready, require:

~~~ts
private isCurrentLogin(generation: number): boolean {
  return this.loginInProgress
    && this.activeLoginGeneration === generation
    && this.loginGeneration === generation;
}
~~~

getStatus must evaluate the gate and report qrAvailable false unless the active generation remains current and the QR file exists. scheduleReconnect must evaluate before scheduling and inside its callback. A block invalidates active QR work, sets recoveryState to idle and lastReconnectError to the stable blocked code, then returns without rescheduling.

- [ ] **Step 4: Run focused gateway tests and confirm GREEN**

Run: `$env:ZALO_DRY_RUN="false"; try { npm test -w packages/backend -- src/__tests__/qr-login-safety.test.ts } finally { Remove-Item Env:ZALO_DRY_RUN -ErrorAction SilentlyContinue }`

Expected: PASS; Zalo constructor, session read/write, listener start and second timer are zero in blocked or late cases.

- [ ] **Step 5: Record the gateway checkpoint without committing**

Keep the worktree uncommitted until Task 8. Re-run the focused lifecycle suite and inventory the exact changed paths.

### Task 3: Reuse the decision in QR routes and admin reconnect

**Files:**

- Modify: packages/backend/src/routes/zalo.ts
- Modify: packages/backend/src/services/zalo-ops.service.ts
- Modify: packages/backend/src/__tests__/qr-login-safety.test.ts

- [ ] **Step 1: Write failing route and reconnect tests**

Register zaloRoutes on bare Fastify with mocked gateway and filesystem. Test that a stale qr-current.png cannot be read while blocked:

~~~ts
const response = await app.inject({ method: "GET", url: "/zalo/login/qr" });
expect(response.statusCode).toBe(409);
expect(response.json()).toEqual({
  error: {
    code: "LOGIN_SAFETY_BLOCKED",
    message: "STATIC_DRY_RUN_ENABLED",
  },
});
expect(readFileSync).not.toHaveBeenCalled();
~~~

Test admin reconnect:

~~~ts
const result = await reconnectZalo("admin-test");
expect(result).toMatchObject({ success: false, status: "login_safety_blocked" });
expect(mockGateway.restoreSession).not.toHaveBeenCalled();
expect(mockGateway.startLogin).not.toHaveBeenCalled();
expect(mockGateway.beginReconnect).not.toHaveBeenCalled();
~~~

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `$env:ZALO_DRY_RUN="false"; try { npm test -w packages/backend -- src/__tests__/qr-login-safety.test.ts } finally { Remove-Item Env:ZALO_DRY_RUN -ErrorAction SilentlyContinue }`

Expected: FAIL because the QR route reads the file first and reconnect enters restore/QR branches.

- [ ] **Step 3: Implement consistent API and reconnect behavior**

In GET /zalo/login/qr, obtain the gateway decision before a path, existsSync or readFileSync. Return exactly:

~~~ts
return reply.status(409).send({
  error: { code: "LOGIN_SAFETY_BLOCKED", message: decision.reason },
});
~~~

In POST /zalo/login/start map status blocked to the same envelope. In reconnectZalo keep already_connected first; for a disconnected gateway, evaluate before the mutex. Return success false and status login_safety_blocked, create one existing-style zalo.reconnect audit with detail login_safety_blocked:<reason>, and do not invoke a session or QR method.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `$env:ZALO_DRY_RUN="false"; try { npm test -w packages/backend -- src/__tests__/qr-login-safety.test.ts } finally { Remove-Item Env:ZALO_DRY_RUN -ErrorAction SilentlyContinue }`

Expected: PASS; stale QR is blocked and admin reconnect has no lifecycle side effect.

- [ ] **Step 5: Record the route/reconnect checkpoint without committing**

Keep the worktree uncommitted until Task 8. Re-run the route/reconnect suite and inventory the exact changed paths.

### Task 4: Make browser QR polling transient-aware

**Files:**

- Create: packages/frontend/src/lib/zalo-login-polling.ts
- Create: packages/frontend/src/lib/zalo-login-polling.test.ts
- Modify: packages/frontend/src/components/zalo-login-card.tsx
- Modify: packages/frontend/src/lib/api-client.ts

- [ ] **Step 1: Write failing pure polling tests**

~~~ts
import { describe, expect, it } from "vitest";
import { decideZaloLoginPoll } from "./zalo-login-polling";

describe("decideZaloLoginPoll", () => {
  it("keeps polling while QR is not generated", () => {
    expect(decideZaloLoginPoll({
      connected: false, connectionStatus: "connecting", qrAvailable: false, lastError: null,
    })).toEqual({
      phase: "pending", fetchQr: false, stopPolling: false, clearQr: false, message: null,
    });
  });

  it("stops without another QR request when safety blocks", () => {
    expect(decideZaloLoginPoll({
      connected: false, connectionStatus: "blocked", qrAvailable: true,
      lastError: "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED",
    })).toEqual({
      phase: "blocked", fetchQr: false, stopPolling: true, clearQr: true,
      message: "STATIC_DRY_RUN_ENABLED",
    });
  });
});
~~~

- [ ] **Step 2: Run frontend test and confirm RED**

Run: npx vitest run --config vitest.config.ts packages/frontend/src/lib/zalo-login-polling.test.ts

Expected: FAIL because the polling policy does not exist.

- [ ] **Step 3: Add policy and wire the card**

Define the function:

~~~ts
export function decideZaloLoginPoll(status: {
  connected: boolean;
  connectionStatus: string;
  qrAvailable: boolean;
  lastError: string | null;
}) {
  if (status.connected) {
    return { phase: "connected", fetchQr: false, stopPolling: true, clearQr: true, message: null };
  }
  if (status.connectionStatus === "blocked") {
    return {
      phase: "blocked", fetchQr: false, stopPolling: true, clearQr: true,
      message: status.lastError?.replace("LOGIN_SAFETY_BLOCKED:", "") ?? "LOGIN_SAFETY_BLOCKED",
    };
  }
  if (status.connectionStatus === "expired") {
    return { phase: "expired", fetchQr: false, stopPolling: true, clearQr: true, message: null };
  }
  return { phase: "pending", fetchQr: status.qrAvailable, stopPolling: false, clearQr: false, message: null };
}
~~~

Add blocked to LoginPhase and blocked/expired to LoginStatusOutput.connectionStatus. In pollStatus call decideZaloLoginPoll before loadQR: stop and clear on block, set errMsg to the stable reason, and never call loadQR for that action. QR_NOT_FOUND remains a no-op while pending; do not turn qrAvailable false into expired. Render a red blocked panel that displays the safe reason and only lets the operator return to idle.

- [ ] **Step 4: Run frontend test and confirm GREEN**

Run: npx vitest run --config vitest.config.ts packages/frontend/src/lib/zalo-login-polling.test.ts

Expected: PASS; connecting/no-QR remains pending and blocked gives fetchQr false plus stopPolling true.

- [ ] **Step 5: Record the frontend checkpoint without committing**

Keep the worktree uncommitted until Task 8. Re-run the focused frontend suite and inventory the exact changed paths.

### Task 5: Mount Controlled QR Login and prove browser fail-closed behavior

- Render `ZaloLoginCard` only after `/zalo-ops` has a validated operational-status response.
- Refresh operational status after either restore-connected or QR-connected completion.
- Keep reconnect, disconnect, test-DM and all outbound mutations status-only.
- Browser QA must cover backend down/malformed, safety block, and a delayed QR response after block without producing another mutation.

### Task 6: Full verification and review handoff

**Files:**

- Modify only if necessary: docs/superpowers/specs/2026-07-21-qr-login-safety-rework-design.md
- Modify only if necessary: this plan

- [ ] **Step 1: Run focused suites**

~~~bash
$env:ZALO_DRY_RUN = "false"
try {
  npm test -w packages/backend -- src/__tests__/zalo-login-safety.test.ts src/__tests__/qr-login-safety.test.ts src/__tests__/zalo-restore-safety.test.ts
  npm test -w packages/backend -- src/__tests__/zalo.test.ts src/__tests__/batch-zr1-auto-reconnect.test.ts src/__tests__/zr2-reconnect-backup-restore.test.ts src/__tests__/batch16-zalo-ops.test.ts
} finally {
  Remove-Item Env:ZALO_DRY_RUN -ErrorAction SilentlyContinue
}
npx vitest run --config vitest.config.ts packages/frontend/src/lib/zalo-login-polling.test.ts
~~~

Expected: all focused tests pass, exit 0.

- [ ] **Step 2: Run repository gates**

~~~bash
npm test
npm run typecheck
npm run build
git diff --check
git diff --stat
git status --short --untracked-files=all
git ls-files --others --exclude-standard
~~~

Expected: test/typecheck/build/diff-check exit 0; inventory contains only the files in this plan plus its approved spec.

- [ ] **Step 3: Run isolated backend-down and backend-up fail-closed smokes**

Use a temporary DB/session directory, ZALO_DRY_RUN=true, auto-reply disabled and Agent Bridge disabled. Verify read-only health/status JSON and that both login start/QR endpoints return 409 LOGIN_SAFETY_BLOCKED. Do not scan a QR code, reconnect Zalo or send a message.

- [ ] **Step 4: Review final diff before any publish action**

~~~bash
git diff --check
git diff --stat
git status --short
~~~

Expected: no schema/migration, `.env`, database, session, backup, generated output or unrelated dashboard change. Stage only explicit paths; never use `git add .` or `git add -A`.

### Task 7: Controlled QR test on the local machine

Run the backend with process-scoped `ZALO_DRY_RUN=false`, effective outbound dry-run `true`, auto-reply disabled, Agent Bridge disabled, and temporary database/session paths. Scan exactly one QR and verify connected state, active listener, temporary session persistence, stale-QR removal, and zero real outbound/auto-reply. Stop the runtime after the check and retain the temporary session for the operator; do not copy it into the standard repo session directory.

### Task 8: Narrow commit and VPS fail-closed smoke

After final review, stage explicit intended paths and create one narrow commit on `codex/qr-safety-rework`. Merge, push, deploy and PM2 restarts still require separate operator approval. The VPS smoke uses static dry-run enabled, keeps outbound dry-run enabled, does not scan a QR, and proves health plus both QR endpoints fail closed with HTTP 409.
