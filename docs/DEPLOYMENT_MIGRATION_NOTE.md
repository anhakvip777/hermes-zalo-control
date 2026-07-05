# Deployment & Migration Note — Tool Gateway Evidence

Status: **read before any DB migration or deploy.** This note documents the
`tool_gateway_evidence` migration and a known migration-history drift that makes
`prisma migrate deploy` unsafe to run blindly.

---

## 1. Evidence migration

- **Migration:** `packages/backend/prisma/migrations/20260705120000_tool_gateway_evidence/`
- **Creates:**
  - `ToolCallRecord` — evidence of agent tool invocations (args/result redacted,
    two-field execution/delivery status, idempotency key, evidence pointers).
  - `ZaloActionRecord` — evidence of non-message Zalo write actions (reaction /
    poll), with dryRun/decision/execution status and idempotency key.
- **Nature:** **additive only.** The migration contains exactly:
  - 2 × `CREATE TABLE` (`ToolCallRecord`, `ZaloActionRecord`)
  - 9 × `CREATE INDEX` (incl. 2 unique indexes on `idempotencyKey`)
- **No destructive operations:** no `DROP`, no `ALTER`, no `DELETE`, no
  `TRUNCATE`, no `RENAME`, no table rebuild.

> How it was generated: via `prisma migrate diff` comparing the current
> `schema.prisma` against a baseline equal to the current schema **minus** the
> two new models. This intentionally avoids `prisma migrate dev`, which would
> have produced a destructive migration (see Warning below).

---

## 2. Warning — migrations folder is stale

- The Prisma migrations folder is **out of sync** with `schema.prisma`.
- Before this migration, only `20260622123048_init` existed, yet the schema
  contains many additional tables (e.g. `ThreadSetting`, `OutboundRecord`,
  `Rule`, `RuleExecution`, `ZaloPrincipal`, `Document`, `LiveTestSession`, plus
  added columns on `Message` such as `role` / `relatedMessageId`).
- These older tables/columns appear to have been created via `prisma db push`,
  **not** captured as migration files.

Consequences:

- **Do NOT run `prisma migrate deploy` blindly.**
- A **fresh database** initialized with `migrate deploy` would apply only
  `init` + `tool_gateway_evidence` and would therefore be **incomplete**
  (missing the ~18 objects that only exist in `schema.prisma` / via `db push`).
- An **existing database** built via `db push` has no or partial
  `_prisma_migrations` history and would likely need **baseline reconciliation**
  before `migrate deploy` can be used safely (otherwise it will try to re-run
  `init` against already-existing tables and fail).

---

## 3. Safe rollout

1. **Inspect the target DB schema first.** Do not assume the migration history
   matches reality.
2. **If the target DB already has the current schema except the evidence
   tables** (typical for an existing `db push`-built environment):
   apply **only the additive evidence SQL** from
   `20260705120000_tool_gateway_evidence/migration.sql`
   (the two `CREATE TABLE` + indexes). Do not run full `migrate deploy`.
3. **If the target DB is fresh / empty:** run the **migration-reconciliation**
   task first (see §4) so the full schema is represented before applying the
   evidence tables.
4. Ship with safety defaults:
   - `HERMES_AGENT_BRIDGE_ENABLED=false` (structured agent bridge stays OFF;
     text-only fallback path is behaviorally identical).
   - Global `dryRun=true`.
   - **No global live.** Live sends only via a controlled per-thread
     `LiveTestSession` (quota + TTL).

Also do **not** run `migrate reset`, `db push --force-reset`, or any destructive
DB command as part of rollout.

---

## 4. Follow-up task — `migration-reconciliation`

To be scheduled separately, executed **only with explicit approval**:

- Audit the current **staging** and **production** DB schemas.
- Compare each against `schema.prisma` (e.g. `prisma migrate diff`).
- Decide a baseline strategy (typically: generate a single "baseline" migration
  representing the full deployed schema via `migrate diff --from-empty
  --to-schema-datamodel schema.prisma`).
- Use `prisma migrate resolve --applied <migration>` to mark already-present
  migrations as applied **without executing** them — **only with explicit
  approval**, per environment.
- Do **not** run `migrate deploy` against any environment until its history is
  reconciled.

---

## Quick reference — what NOT to run without inspection/approval

- `prisma migrate deploy` (against any non-reconciled environment)
- `prisma migrate dev` (would generate a destructive diff given the current drift)
- `prisma migrate reset` / `prisma db push --force-reset`
- `prisma migrate resolve --applied` (requires explicit approval)
