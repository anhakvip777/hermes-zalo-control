import { beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

beforeAll(async () => {
  // Push schema to test.db (which already exists via migration)
  // Clean any leftover test data
  await prisma.scheduleExecution.deleteMany();
  await prisma.scheduleRevision.deleteMany();
  await prisma.scheduleJob.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.appSetting.deleteMany();
}, 15_000);

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.scheduleExecution.deleteMany();
  await prisma.scheduleRevision.deleteMany();
  await prisma.scheduleJob.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.appSetting.deleteMany();
});
