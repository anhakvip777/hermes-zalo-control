import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BACKEND_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const PRISMA_DIR = resolve(BACKEND_ROOT, "prisma");
export const BACKUPS_DIR = resolve(BACKEND_ROOT, "backups");

/** Resolve a file-backed Prisma SQLite URL from the schema directory. */
export function resolveSqliteDatabasePath(databaseUrl: string): string | null {
  const match = /^file:(.+)$/.exec(databaseUrl);
  const configuredPath = match?.[1]?.trim();
  if (!configuredPath || configuredPath === ":memory:") return null;

  return isAbsolute(configuredPath)
    ? resolve(configuredPath)
    : resolve(PRISMA_DIR, configuredPath);
}
