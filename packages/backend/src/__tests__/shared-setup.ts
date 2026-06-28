import { prisma } from "../db.js";
import * as settingsService from "../services/settings.service.js";

// Delete all data respecting FK constraints (children first, parents last)
export async function cleanDatabase() {
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
    await prisma.message.deleteMany();
    await prisma.zaloThread.deleteMany();
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
