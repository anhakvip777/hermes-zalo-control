# Hermes Zalo Control Center

Web dashboard for monitoring and controlling AI agents that operate through Zalo.

## Stack

| Layer      | Technology                             |
| ---------- | -------------------------------------- |
| Backend    | Fastify + TypeScript                   |
| Frontend   | Next.js 15 + TailwindCSS v4            |
| ORM        | Prisma (SQLite dev, PostgreSQL ready)  |
| Queue      | BullMQ + Redis (or node-cron fallback) |
| Validation | Zod (shared package)                   |
| Testing    | Vitest                                 |

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url> hermes-zalo-control
cd hermes-zalo-control
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your settings (defaults work for dev)

# 3. Set up database
npm run db:migrate
npm run db:generate

# 4. Start development
npm run dev           # backend + frontend
# or
npm run dev:all       # backend + frontend + worker

# 5. Open in browser
# Frontend: http://localhost:3001
# Backend API: http://localhost:3000
# Prisma Studio: npm run db:studio
```

## Project Structure

```
hermes-zalo-control/
├── packages/
│   ├── shared/       # Zod schemas, shared types
│   ├── backend/      # Fastify API, Prisma, worker
│   └── frontend/     # Next.js dashboard
├── PLAN.md           # Architecture & phase plan
├── CLAUDE.md         # Context for AI assistants
└── README.md         # This file
```

## Scripts

| Command              | Description                       |
| -------------------- | --------------------------------- |
| `npm run dev`        | Start backend + frontend          |
| `npm run dev:all`    | Start backend + frontend + worker |
| `npm run typecheck`  | Type-check all packages           |
| `npm test`           | Run all tests                     |
| `npm run test:e2e`   | Run end-to-end tests              |
| `npm run lint`       | Lint all packages                 |
| `npm run format`     | Format all files                  |
| `npm run db:migrate` | Run Prisma migrations             |
| `npm run db:studio`  | Open Prisma Studio                |

## Environment Variables

See `.env.example` for all configuration options. Key variables:

- `DATABASE_URL` — SQLite or PostgreSQL connection string
- `REDIS_URL` — Redis for BullMQ (leave empty for node-cron fallback)
- `ZALO_DRY_RUN` — Set to `true` to skip actual Zalo API calls in dev
- `ZALO_SESSION_DIR` — Where to persist Zalo login session

## Deployment

### On VPS

1. Clone repo and install dependencies
2. Set up PostgreSQL and Redis
3. Copy `.env.example` to `.env` and fill production values
4. Run `npm run db:migrate && npm run build`
5. Use pm2 or systemd to run the services:

```bash
# Backend
pm2 start npm --name "hermes-api" -- run dev:backend
# Worker
pm2 start npm --name "hermes-worker" -- run dev:worker
# Frontend
pm2 start npm --name "hermes-web" -- run dev:frontend
```

### With nginx

```nginx
location /api/ {
    proxy_pass http://localhost:3000;
}
location / {
    proxy_pass http://localhost:3001;
}
```

## License

MIT
