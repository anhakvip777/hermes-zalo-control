import { prisma } from "../db.js";
import * as settingsService from "../services/settings.service.js";

// =============================================================================
// TDB1 — Test Database Isolation Guard
// =============================================================================
// Prevent tests from accidentally wiping the runtime (dev.db) database.
// cleanDatabase() MUST refuse to run unless DATABASE_URL points to a test DB.
// This is the runtime-level defense; vitest.config.ts also sets test env vars.
// =============================================================================

function assertTestDatabase(): void {
  const nodeEnv = process.env.NODE_ENV || "";
  const dbUrl = process.env.DATABASE_URL || "";

  // Guard 1: NODE_ENV must be "test"
  if (nodeEnv !== "test") {
    throw new Error(
      `[TDB1] cleanDatabase REFUSED: NODE_ENV=${nodeEnv || "(not set)"}, expected "test". ` +
      `Tests must run with NODE_ENV=test to protect runtime data.`
    );
  }

  // Guard 2: DATABASE_URL must NOT contain dev.db
  if (dbUrl.includes("dev.db")) {
    throw new Error(
      `[TDB1] cleanDatabase REFUSED: DATABASE_URL points to dev.db (runtime DB). ` +
      `URL: ${dbUrl} — Tests must NEVER touch the runtime database.`
    );
  }

  // Guard 3: DATABASE_URL must reference a test DB (test.db or :memory:)
  if (!dbUrl.includes("test.db") && !dbUrl.includes(":memory:")) {
    throw new Error(
      `[TDB1] cleanDatabase REFUSED: DATABASE_URL is not a test DB. ` +
      `URL: ${dbUrl} — Expected file:./test.db or file::memory:.`
    );
  }
}

// Delete all data respecting FK constraints (children first, parents last)
export async function cleanDatabase() {
  // === TDB1 GUARD — MUST be first ===
  assertTestDatabase();

  // Disable FK checks during cleanup for robustness
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  try {
    await prisma.scheduleExecution.deleteMany();
    await prisma.scheduleRevision.deleteMany();
    await prisma.scheduleJob.deleteMany();
    await prisma.ruleExecution.deleteMany();
    await prisma.ruleVersion.deleteMany();
    await prisma.rule.deleteMany();
    await prisma.documentChunk.deleteMany();
    await prisma.documentIngestionJob.deleteMany();
    await prisma.document.deleteMany();
    await prisma.attendanceRecord.deleteMany();
    await prisma.attendanceSession.deleteMany();
    await prisma.agentTask.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.message.deleteMany();
    await prisma.zaloThread.deleteMany();
    await prisma.zaloPrincipal.deleteMany();
    await prisma.zaloPrincipalAudit.deleteMany();
    await prisma.threadProfile.deleteMany();
    await prisma.messageBatch.deleteMany();
    await prisma.outboundRecord.deleteMany();
    await prisma.schedule.deleteMany();
    await prisma.appSetting.deleteMany();
  } finally {
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  }
}

export async function resetForTest() {
  await cleanDatabase();
  await settingsService.initializeDefaultSettings();
}
