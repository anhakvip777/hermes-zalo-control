import { resolveSqliteDatabasePath } from "./backend-paths.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const databasePath = resolveSqliteDatabasePath(databaseUrl);

if (
  process.env.NODE_ENV !== "test" ||
  !databasePath ||
  !/[\\/]test(?:-[^\\/]+)?\.db$/i.test(databasePath)
) {
  throw new Error(
    `Backend tests require NODE_ENV=test and an isolated test database; got DATABASE_URL=${databaseUrl || "<missing>"}`,
  );
}
