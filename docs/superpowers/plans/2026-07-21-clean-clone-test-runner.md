# Clean Clone Test Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm test` deterministic on a fresh clone without inheriting the VPS runtime `ZALO_DRY_RUN` value.

**Architecture:** The root test orchestrator owns workspace ordering and its child environment. It must compile the shared workspace before backend Vitest resolves `@hermes/shared`, and it must provide the login-test semantic environment explicitly. Runtime `.env` remains unchanged and is never used as a test-policy source.

**Tech Stack:** Node.js 22, npm workspaces, TypeScript, Vitest.

---

### Task 1: Lock the runner contract with regression assertions

**Files:**

- Modify: `packages/backend/src/__tests__/test-runner-safety.test.ts`
- Test: `packages/backend/src/__tests__/test-runner-safety.test.ts`

- [ ] **Step 1: Add assertions before implementation**

```ts
expect(source).toContain('require.resolve("typescript/bin/tsc")');
expect(source).toContain('ZALO_DRY_RUN: "false"');
```

- [ ] **Step 2: Run the focused file and verify it fails**

Run: `npm test -w packages/backend -- src/__tests__/test-runner-safety.test.ts`

Expected: the new assertions fail because the root runner currently starts backend before a shared build and forwards the runtime `ZALO_DRY_RUN` value.

### Task 2: Make the root runner own the prerequisites and test environment

**Files:**

- Modify: `scripts/run-tests.mjs`
- Test: `packages/backend/src/__tests__/test-runner-safety.test.ts`

- [ ] **Step 1: Add the first root step**

```js
{
  cmd: process.execPath,
  args: [TSC_CLI, "--project", "./packages/shared/tsconfig.json"],
  label: "shared build prerequisite",
}
```

Place it before the backend test step so `packages/shared/dist/index.js` exists before Vite resolves `@hermes/shared`.

- [ ] **Step 2: Pin the test-only Zalo mode**

```js
ZALO_DRY_RUN: "false",
```

Add it to the root runner's `env` object. This applies only to its child processes, preserves the VPS `.env`, and allows the QR-login tests to exercise their mocked non-dry-run branches without an actual Zalo login.

- [ ] **Step 3: Re-run the focused regression**

Run: `npm test -w packages/backend -- src/__tests__/test-runner-safety.test.ts`

Expected: PASS.

### Task 3: Verify clean-clone behavior and repository integrity

**Files:**

- Verify: `scripts/run-tests.mjs`
- Verify: `packages/backend/src/__tests__/test-runner-safety.test.ts`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: backend 84 files / 1336 tests, shared 6 tests, frontend 106 tests all pass. The runner builds shared automatically before backend tests.

- [ ] **Step 2: Run static verification**

Run: `npm run typecheck`, `npm run build`, and `git diff --check`.

Expected: all exit 0.

- [ ] **Step 3: Review and publish**

Stage only `scripts/run-tests.mjs`, `packages/backend/src/__tests__/test-runner-safety.test.ts`, and this plan after checking `git diff --check`; create one focused commit and push it to `master`.
