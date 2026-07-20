/**
 * DB Guard — startup check module.
 * Import and call `checkDbOnStartup()` at the beginning of your main() function.
 */

import { existsSync, statSync } from "node:fs";
import { resolveSqliteDatabasePath } from "./backend-paths.js";

const CRITICAL_TABLES = [
  "Message",
  "ZaloThread",
  "AgentTask",
  "Schedule",
  "ScheduleJob",
  "ThreadSetting",
  "OutboundRecord",
  "ThreadConversationState",
];

function getDbPath(): string {
  const url = process.env.DATABASE_URL || "file:./dev.db";
  const dbPath = resolveSqliteDatabasePath(url);
  if (!dbPath) throw new Error(`Cannot parse file-backed DATABASE_URL: ${url}`);
  return dbPath;
}

export async function checkDbOnStartup(): Promise<void> {
  const requireGuard = process.env.REQUIRE_DB_GUARD === "true";
  const dbPath = getDbPath();

  console.log(`[db-guard] Startup check: ${dbPath}`);

  // Check file exists
  if (!existsSync(dbPath)) {
    const msg = "[db-guard] WARNING: Database file not found";
    console.warn(msg);
    if (requireGuard) throw new Error(msg);
    return;
  }

  const size = statSync(dbPath).size;
  if (size < 1024) {
    console.warn(`[db-guard] WARNING: DB size suspiciously small (${size} bytes)`);
  }

  // Check critical tables via Prisma (lazy import to avoid circular deps)
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const tableResults = (await prisma.$queryRawUnsafe(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
      )) as { name: string }[];
      const existingTables = tableResults.map((r) => r.name);
      const missing = CRITICAL_TABLES.filter((t) => !existingTables.includes(t));

      if (missing.length > 0) {
        const msg = `[db-guard] WARNING: Missing critical tables: ${missing.join(", ")}`;
        console.warn(msg);
        if (requireGuard) throw new Error(msg);
      }

      // Check row counts for key tables
      for (const table of ["Message", "ZaloThread", "AgentTask"]) {
        if (existingTables.includes(table)) {
          const result = (await prisma.$queryRawUnsafe(
            `SELECT COUNT(*) as cnt FROM "${table}"`
          )) as { cnt: number }[];
          if (result[0]?.cnt === 0) {
            console.warn(`[db-guard] WARNING: ${table} table empty`);
          }
        }
      }

      console.log("[db-guard] Startup check: PASS");
    } finally {
      await prisma.$disconnect();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[db-guard] Startup check failed: ${msg}`);
    if (requireGuard) throw err;
  }
}
