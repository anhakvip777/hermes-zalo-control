# Superpowers Adoption Plan for Hermes Agent

**Status:** PROPOSAL — for review
**Date:** 2026-07-01
**Source:** [github.com/obra/Superpowers](https://github.com/obra/Superpowers) — software development methodology for coding agents

---

## 1. What Superpowers Is

Superpowers is a **composable skill-based methodology** that shapes agent behavior from session start. Its core insight: agents succeed or fail based on **process discipline**, not intelligence. Key design patterns:

| Pattern | Description |
|---------|-------------|
| **Brainstorm → Design → Plan → Implement** | No code before design approval. Always present spec first. |
| **Verification Iron Law** | No completion claim without fresh, verified evidence. |
| **TDD Red-Green-Refactor** | Write failing test → watch it fail → minimal code → all green → refactor. |
| **Subagent-driven development** | Fresh subagent per task. Task reviewer after each. Final reviewer at end. |
| **Systematic debugging** | 4 phases. Root cause before fixes. Symptom fixes = failure. |
| **Red Flags / Rationalization tables** | Pre-commit self-checks that prevent common agent failure modes. |
| **Bite-sized task granularity** | 2-5 minute tasks. "Write the failing test" is one task. "Commit" is one task. |
| **Fresh context per subagent** | Subagents get precisely crafted context — never inherit session history. |

---

## 2. What Parts Apply to Hermes Agent

Hermes Agent has two distinct contexts: **(A) codebase development** (Admin Center) and **(B) live system operations** (Zalo pilot, monitoring, incident response). Superpowers applies differently to each:

### A. Codebase Development (✅ DIRECT APPLY)

Superpowers maps almost perfectly onto our existing batch workflow:

```
Superpowers:    Brainstorm   → Design Spec  → Write Plan   → TDD Subagent  → Review → Finish
Hermes Batch:   Batch spec   → Mini-plan    → Approve      → TDD Implement  → Review → Commit
```

**Specific skills to adopt as Hermes skills:**

| Superpowers Skill | Hermes Equivalent | Status |
|------------------|-------------------|--------|
| `brainstorming` | Already have (batch mini-plan pattern) | ✅ Exists |
| `writing-plans` | Batch planning with bite-sized tasks | 🔧 Needs formalization |
| `test-driven-development` | Already partially do | 🔧 Need Red-Green verification step |
| `subagent-driven-development` | Already use `delegate_task` | ✅ Exists |
| `requesting-code-review` | Code review before commit | 🔧 Need to make mandatory |
| `verification-before-completion` | **MISSING — this is the key gap** | ❌ Need to create |
| `systematic-debugging` | Already do partially | 🔧 Need 4-phase formalization |
| `dispatching-parallel-agents` | Already use parallel delegate_task | ✅ Exists |

### B. Live System Operations (🔧 ADAPT)

Superpowers is code-focused. For live ops, we need equivalent protocols:

| Superpowers Pattern | Live Ops Equivalent |
|--------------------|--------------------|
| "No code before design" | "No live before dryRun" |
| Verification Iron Law | API smoke + DB verify before claiming success |
| Red-Green-Refactor | dryRun → live → verify → stop |
| Systematic debugging | Incident debugging protocol (already have) |
| Subagent review | Pre-live checklist |

---

## 3. What NOT to Adopt

| Superpowers Pattern | Why Not |
|--------------------|---------|
| PR disclosure of model/harness/plugins | Internal project — not needed |
| `docs/superpowers/specs/` directory convention | Already use `docs/` flat structure |
| Zero-dependency philosophy | Hermes is a full-stack app with deps |
| Session-start hooks (`using-superpowers` bootstrap) | Hermes Agent has its own skill system |
| "Human partner" terminology | We use "user" consistently; not changing |
| Strict new harness acceptance test | Not adding new harnesses |

---

## 4. Agent Workflow Rules

These are the **iron laws** that every Hermes Agent session must follow — adapted from Superpowers principles:

### 4.1 The Verification Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

**BEFORE claiming any status (PASS/FAIL/SUCCESS):**

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

**Hard rules:**
- Exit code != 0 → CANNOT claim PASS
- Test count changed → re-report actual count
- Build failed → CANNOT claim "build succeeded"
- API returned error → CANNOT claim "API OK"

**Red Flags (STOP if you think any of these):**
- "Should work now"
- "I'm confident"
- "Looks good" (without having run verification)
- Trusting agent self-reports without independent verification
- Using partial check as evidence of full success

### 4.2 The State Reconciliation Rule

After ANY of these events, you MUST reconcile state before proceeding:

| Trigger Event | Reconciliation |
|--------------|---------------|
| Empty response from agent | Re-read context, state what was last done, ask for clarification |
| Tool interruption (Ctrl+C) | Check tool result, re-read what was interrupted |
| Command timeout | Verify with fresh command, report partial or confirm completion |
| Unexpected error | Systematic debugging Phase 1 before any fix |
| Session compaction / context loss | Read memory, re-state situation, confirm with user |

### 4.3 The Evidence Rule

Every status report MUST include evidence:

| Claim | Required Evidence |
|-------|------------------|
| Tests pass | `npm test` output: N/N PASS, 0 failures |
| Build succeeds | `npm run build` exit code 0 |
| TypeScript clean | `npm run typecheck` exit code 0 |
| API OK | curl output with statusCode=200 |
| DB query result | Actual query output (not interpretation) |
| Live test active | API response: active=true |
| Zalo connected | API response: connected=true |
| Session healthy | File exists + fileSize > 0 |
| SENT message | sentMessageId present in OutboundRecord |

### 4.4 The Mini-Plan Rule

```
NO CODE WITHOUT AN APPROVED MINI-PLAN
```

Before touching any code:
1. Write a mini-plan (5-15 lines) describing what changes, why, and the verification steps
2. Present to user
3. Get explicit approval
4. Then implement

Applies to: code changes, config changes, DB mutations, env var changes.
Exception: read-only diagnostic commands (curl, grep, ls, git log/status).

---

## 5. Batch Execution Protocol

Adapted from Superpowers' `writing-plans` + `subagent-driven-development`:

### 5.1 Batch Lifecycle

```
SPEC → MINI-PLAN → APPROVE → RED (test) → GREEN (code) → REFACTOR → VERIFY → REVIEW → COMMIT
```

### 5.2 Pre-Commit Checklist (Mandatory)

Every commit MUST pass ALL of these:

```
[ ] npm test -w packages/backend         → N/N PASS, 0 failures, exit 0
[ ] npm run typecheck -w packages/backend → exit 0
[ ] npm run build -w packages/backend     → exit 0
[ ] npm run build -w packages/frontend    → exit 0
[ ] git status --short                    → only intended files
[ ] git diff --stat                       → no unintended changes
```

**Hard gate:** Any failure → STOP. Do not commit. Fix first.

### 5.3 Commit Granularity

One commit = one logical change. No bundling unrelated changes.

Example of CORRECT splitting:
- Commit 1: "test(batch): clean stale message batches before tests" (test-only)
- Commit 2: "feat(thread): add display names via thread profiles" (feature)

Example of WRONG bundling:
- ❌ "fix: various test + feature changes" (too broad)
- ❌ "update backend and frontend" (no scope)

---

## 6. Verification Protocol

### 6.1 Test Verification

```bash
# MUST run fresh each time — never trust previous run
npm test -w packages/backend

# Read ALL output:
# - Check total count: "N/N PASS" or "Tests: N passed, N total"
# - Check for 0 failures: grep "FAIL" count
# - Check exit code: must be 0
```

**Red Flag table:**

| If you think... | STOP — Reality: |
|----------------|-----------------|
| "It passed before, should still pass" | Run it again NOW |
| "Only added 1 test, should be fine" | Run the FULL suite |
| "The change was trivial" | Run the FULL suite |
| "I'll run it after commit" | Run BEFORE commit |

### 6.2 Typecheck Verification

```bash
npm run typecheck -w packages/backend
# Exit code 0 + no "error TS" lines = PASS
```

### 6.3 Build Verification

```bash
npm run build -w packages/backend
npm run build -w packages/frontend
# Both must exit 0
```

### 6.4 Live Ops Verification (separate protocol)

For live system changes (config, env, allowedThreads, session):

```bash
# Always verify AFTER change:
curl -s -u "admin:PASS" http://127.0.0.1:3002/api/system/runtime-config
curl -s -u "admin:PASS" http://127.0.0.1:3002/api/system/live-test/status
curl -s -u "admin:PASS" http://127.0.0.1:3002/api/zalo/ops/status
```

---

## 7. Commit / Deploy Protocol

### 7.1 Commit Standards

- **Message format:** `type(scope): description`
- **Types:** feat, fix, refactor, test, docs, chore, perf, revert
- **Scopes:** thread, outbound, dispatcher, live-test, batch, session, auth, ui, config, worker

### 7.2 Before Commit

```
[ ] All 4 verification gates passed (test, typecheck, backend build, frontend build)
[ ] git diff --stat reviewed — only intended changes
[ ] No commented-out code, no debug prints, no secrets in diff
```

### 7.3 After Commit

```
[ ] git log --oneline -3 — confirm commit message and hash
[ ] git status --short — clean working tree
```

### 7.4 Deploy (PM2 Restart)

```
[ ] pm2 restart hermes-backend --update-env
[ ] Verify: health check, Zalo connected, listener active
[ ] Check logs for errors
[ ] Verify session persisted
```

---

## 8. Monitoring Agent Protocol

### 8.1 Report-Only Rule

```
NEVER auto-fix production. Report findings, wait for approval.
```

When monitoring detects an issue:

| Severity | Action |
|----------|--------|
| CRITICAL (e.g., Zalo disconnected) | Report + suggest fix + ask for approval |
| WARNING (e.g., session nearing expiry) | Report + note timeline |
| INFO (e.g., high CPU) | Log, no user alert needed |

### 8.2 Safety Boundaries

These require **human confirmation** (no auto-fix):

| Action | Why |
|--------|-----|
| `pm2 restart` | Interrupts active connections |
| `dryRun=false` | ⛔ NEVER without explicit approval |
| `allowedThreads` changes | Security boundary |
| `session delete/restore` | Destroys login state |
| `DB reset/migration` | Data loss risk |
| `env var change` | Runtime behavior change |
| `npm install/update` | Dependency risk |

---

## 9. Safety Rules (Hermes-Specific)

These are non-negotiable — adapted from lessons learned across 15+ batches:

### 9.1 Live System Safety

```
⛔ NEVER: set global live=true
⛔ NEVER: test groups before trusted DMs
⛔ NEVER: delete session or reset DB without explicit approval
⛔ NEVER: expose token/session content in logs or reports
⛔ NEVER: run multiple live test sessions simultaneously
```

### 9.2 Production Awareness

```
[ ] Know what's running before acting: pm2 status, Docker ps
[ ] Know what changed: git log --oneline -5
[ ] Know system state: runtime-config, live-test status, Zalo ops
[ ] Know safety gates: dryRun, allowedThreads, session health
```

### 9.3 State Recovery

After PM2 restart:
```
[ ] Session file exists (zalo-session/zalo-session.json)
[ ] Zalo connected + listener active
[ ] Heartbeats healthy (not "down")
[ ] dryRun=true (verified, not assumed)
```

---

## 10. Rollback Protocol

### 10.1 Code Rollback

```bash
# Before risky change — create rollback tag:
git tag backup/YYYY-MM-DD-before-<change>

# To rollback:
git checkout <tag> -- <files>   # or full reset
npm test && npm run build        # must pass before deploy
pm2 restart hermes-backend
```

### 10.2 Config Rollback

```bash
# Ecosystem config is under git — revert the file:
git checkout HEAD -- ecosystem.config.cjs
# Or restore from backup:
cp ecosystem.config.cjs.bak ecosystem.config.cjs
pm2 restart hermes-backend --update-env
```

### 10.3 DB Rollback

```bash
# Restore from latest backup:
LATEST=$(ls -dt packages/backend/backups/db/zalo-session-*/ | head -1)
cp ${LATEST}zalo-session.json packages/backend/zalo-session/
pm2 restart hermes-backend
```

### 10.4 Rollback Checklist

```
[ ] Identify what changed (git diff / API status change)
[ ] Apply revert
[ ] Verify: test + build + health check + Zalo connected
[ ] Confirm with user
```

---

## 11. Files to Create / Update

| File | Action | Description |
|------|--------|-------------|
| `docs/AGENT_OPERATING_PROTOCOL.md` | **CREATE** | This document |
| `CLAUDE.md` | **UPDATE** | Add verification iron law + safety rules |
| `.hermes/AGENTS.md` | **CREATE** if missing | Agent self-documentation |
| `skills/hermes-agent-operating-protocol/SKILL.md` | **CREATE** | Hermes skill: auto-loaded protocols |

### Proposed updates to CLAUDE.md

Add a new section at the top:

```markdown
## Agent Operating Protocol

### Iron Laws
1. **Verification:** No PASS/SUCCESS claim without fresh evidence (test output, exit code, API response)
2. **Mini-Plan:** No code/config changes without user-approved plan
3. **State Reconciliation:** After empty response, interruption, or error — reconcile before proceeding
4. **Safety:** Never set global live=true. Never delete session/DB. Never expose tokens.
5. **Evidence:** Every status report includes actual command output, not interpretation

### Pre-Commit Gates
- [ ] `npm test -w packages/backend` — all pass, exit 0
- [ ] `npm run typecheck -w packages/backend` — exit 0
- [ ] `npm run build -w packages/backend` — exit 0
- [ ] `npm run build -w packages/frontend` — exit 0
- [ ] `git diff --stat` — reviewed, no unintended changes

### Live Ops Verification
After any live system change, verify:
- Runtime config: dryRun=true, allowedThreads correct
- Live test: active=false (unless intentional)
- Zalo: connected=true, listenerActive=true, session exists
- Heartbeats: all "ok" (not "down")
```

---

## 12. Risks

| Risk | Mitigation |
|------|------------|
| Protocol overhead slows down simple tasks | Apply proportional rigor: 1-line config change ≠ full batch |
| Agent forgets to follow iron laws | Add to CLAUDE.md + AGENTS.md (injected every session) |
| Too many checklists cause fatigue | Focus on gates (pre-commit + pre-live), not every micro-step |
| Verification commands have edge cases | Accept known test failures table (already have `known-test-failures.md`) |

---

## 13. Recommendation

### Phase 1 — Adopt Immediately (this batch)

1. ✅ Create `docs/AGENT_OPERATING_PROTOCOL.md` (this document)
2. 🔧 Update `CLAUDE.md` with Iron Laws section
3. 🔧 Create `AGENTS.md` with agent self-documentation

### Phase 2 — Skill Creation (next batch)

4. Create `skills/hermes-agent-operating-protocol/SKILL.md`
5. Add to Hermes Agent config as auto-loaded skill
6. Test: verify agent follows verification iron law in real sessions

### Phase 3 — Tooling (future)

7. Pre-commit hook that refuses commit if test/typecheck/build don't pass
8. Verification script: `scripts/pre-commit-check.sh` that runs all 4 gates
9. Live ops health script: `scripts/health-check.sh`

### What changes TODAY

**Nothing changes in app runtime.** This batch is documentation-only. No code to `packages/`, no PM2 restart, no feature flags. The protocol is a set of rules for agent behavior, not application code.

---

## Appendix A: Superpowers Skills → Hermes Skills Map

| Superpowers | Hermes Existing | Gap |
|------------|----------------|-----|
| `brainstorming` | Batch spec in conversation | ✅ |
| `writing-plans` | Mini-plan in conversation | 🔧 Formalize with CHECKBOX |
| `test-driven-development` | Partially do | 🔧 Add RED verification step |
| `subagent-driven-development` | `delegate_task` | ✅ |
| `requesting-code-review` | Sometimes do | 🔧 Make mandatory |
| `verification-before-completion` | ❌ MISSING | ❌ Create |
| `systematic-debugging` | Partially do | 🔧 Add 4-phase doc |
| `dispatching-parallel-agents` | Parallel `delegate_task` | ✅ |
| `executing-plans` | Sequential batch execution | ✅ |
| `finishing-a-development-branch` | Commit + build verify | 🔧 Formalize |

## Appendix B: Key Superpowers Quotes

> "Violating the letter of this rule is violating the spirit of this rule."

> "If you didn't watch the test fail, you don't know if it tests the right thing."

> "Claiming work is complete without verification is dishonesty, not efficiency."

> "Random fixes waste time and create new bugs. Quick patches mask underlying issues."

> "ALWAYS find root cause before attempting fixes. Symptom fixes are failure."
