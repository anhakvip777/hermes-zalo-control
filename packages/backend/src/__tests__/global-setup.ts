import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function setup() {
  const schemaPath = resolve(__dirname, "../../prisma/schema.prisma");

  // Push schema to test.db (idempotent)
  execSync(`npx prisma db push --schema="${schemaPath}" --accept-data-loss --skip-generate`, {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "pipe",
  });
}
