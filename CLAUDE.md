# CLAUDE.md — Hermes Zalo Control Center

## Project Summary

A web dashboard for controlling AI agents that operate through Zalo. The system lets an AI agent (Hermes) create schedules, send messages, and interact with Zalo groups — but every action is transparent, auditable, and user-controllable via the web UI.

**Core rule**: AI never touches zca-js directly. All Zalo actions go through backend services.

## Architecture

```
User (Web Dashboard)
    ↓
Backend API (Fastify :3000)
    ├── Schedule Service → Prisma → SQLite/PostgreSQL
    ├── Queue Worker (BullMQ / node-cron) → Scheduler
    ├── Zalo Gateway → zca-js → Zalo WebSocket
    └── SSE → Frontend realtime updates

Frontend (Next.js :3001)
    └── Dashboard / Schedule Center / Attendance

Hermes Agent (external)
    └── Internal API → Backend (not zca-js directly)
```

## Key Design Rules

1. **Worker always reloads schedule from DB** before executing — never trusts job payload
2. **Every schedule has a version number** — incremented on every edit
3. **Jobs carry scheduleId + scheduleVersion** — skipped if version outdated
4. **All edits create revision log** + increment version + cancel old job + create new job
5. **Global pause/emergency stop** — worker checks before any individual schedule
6. **Dry-run mode** — runs all validation but doesn't actually send
7. **Zalo session persists** — restore on restart, reconnect with backoff
8. **Production secrets must be set** — server fails fast if default passwords in prod

See `PLAN.md` for the full architecture and mandatory requirements.

## Commands

```bash
npm run dev              # backend + frontend
npm run dev:all          # backend + frontend + worker
npm run typecheck        # tsc --noEmit all packages
npm test                 # vitest all packages
npm run test:e2e         # e2e tests only
npm run lint             # eslint
npm run format           # prettier
npm run db:migrate       # prisma migrate dev
npm run db:studio        # prisma studio
```

## Package tsconfig Rules

- **shared**: `module: "ESNext"`, `moduleResolution: "bundler"`
- **backend**: `module: "NodeNext"`, `moduleResolution: "NodeNext"`
- **frontend**: `module: "ESNext"`, `moduleResolution: "bundler"`, `jsx: "preserve"`
- **base**: No `module`/`moduleResolution` — each package overrides

## Key Files

| File                                        | Purpose                                      |
| ------------------------------------------- | -------------------------------------------- |
| `PLAN.md`                                   | Full architecture, phases, database schema   |
| `packages/backend/prisma/schema.prisma`     | Database schema                              |
| `packages/shared/src/schemas/`              | Shared Zod validation                        |
| `packages/backend/src/config.ts`            | Env config with production secret validation |
| `packages/backend/src/workers/scheduler.ts` | Main worker logic                            |

## Database Tables

`schedules` → `schedule_executions` → `schedule_revisions` → `schedule_jobs` → `messages` → `zalo_threads` → `agent_tasks` → `audit_logs` → `attendance_sessions` → `attendance_records` → `app_settings`

## Phases

1. ✅ Project skeleton (current)
2. Schedule Core — CRUD + revision log + version bump
3. Queue Worker — BullMQ/node-cron + execution tracking
4. Frontend Schedule Center — full UI
5. Zalo Gateway — zca-js integration
6. Hermes Integration — agent task API
7. Attendance MVP
8. Hardening — security, tests, docs

## Development Notes

- `ZALO_DRY_RUN=true` by default in dev — no real Zalo messages sent
- Redis is optional for dev — node-cron used as fallback
- SQLite database file is gitignored
- Zalo session data must NEVER be committed
- Backend is `"type": "module"` — use ESM imports with `.js` extensions in relative paths
- Shared package must be built (`npm run build -w packages/shared`) before other packages can import it
