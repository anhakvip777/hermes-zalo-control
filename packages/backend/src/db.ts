import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.LOG_LEVEL === "debug" ? ["query", "warn", "error"] : ["warn", "error"],
});

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
