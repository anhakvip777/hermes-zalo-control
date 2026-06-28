// =============================================================================
// AgentTask Service — track every Hermes action
// =============================================================================

import { prisma } from "../db.js";

export interface CreateAgentTaskInput {
  agentName?: string;
  taskType: string;
  input: unknown;
  scheduleId?: string;
  messageId?: string;
}

export async function createAgentTask(input: CreateAgentTaskInput) {
  return prisma.agentTask.create({
    data: {
      agentName: input.agentName ?? "hermes",
      taskType: input.taskType,
      input: JSON.stringify(input.input),
      status: "pending",
      scheduleId: input.scheduleId ?? null,
      messageId: input.messageId ?? null,
    },
  });
}

export async function markAgentTaskCompleted(
  id: string,
  result: unknown,
  scheduleId?: string,
) {
  return prisma.agentTask.update({
    where: { id },
    data: {
      status: "completed",
      result: JSON.stringify(result),
      scheduleId: scheduleId ?? undefined,
      updatedAt: new Date(),
    },
  });
}

export async function markAgentTaskFailed(
  id: string,
  error: string,
) {
  return prisma.agentTask.update({
    where: { id },
    data: {
      status: "failed",
      errorMessage: error,
      updatedAt: new Date(),
    },
  });
}

export async function listAgentTasks(opts: {
  status?: string;
  agentName?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 50;
  const where: Record<string, unknown> = {};
  if (opts.status) where.status = opts.status;
  if (opts.agentName) where.agentName = opts.agentName;

  const [data, total] = await Promise.all([
    prisma.agentTask.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.agentTask.count({ where }),
  ]);

  return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}
