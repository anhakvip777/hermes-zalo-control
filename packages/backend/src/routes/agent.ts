import type { FastifyInstance } from "fastify";
import {
  CreateScheduleToolInput,
  UpdateScheduleToolInput,
  SearchMessagesToolInput,
  ParseCommandInput,
  RunDryToolInput,
  CreateAttendanceToolInput,
  ParseAttendanceToolInput,
  CreateAgentTaskInput,
} from "../agent/tool-schemas.js";
import * as agentTaskService from "../services/agent-task.service.js";
import * as scheduleService from "../services/schedule.service.js";
import { listMessages } from "../services/zalo-receive.js";
import { listThreads } from "../services/zalo-receive.js";
import { parseCommand } from "../agent/parse-command.js";
import { executeDryRun } from "../workers/scheduler.js";
import { MockMessageSender } from "../services/message-sender.js";

const mockSender = new MockMessageSender();

// ═══════════════════════════════════════════════════════════════════
// Wrap a tool call with AgentTask lifecycle
// ═══════════════════════════════════════════════════════════════════

async function withAgentTask<T>(
  taskType: string,
  input: unknown,
  fn: () => Promise<T>,
  extra?: { scheduleId?: string },
) {
  const task = await agentTaskService.createAgentTask({
    taskType,
    input,
    scheduleId: extra?.scheduleId,
  });

  try {
    const result = await fn();
    await agentTaskService.markAgentTaskCompleted(
      task.id,
      result,
      extra?.scheduleId,
    );
    return { taskId: task.id, status: "completed", result };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await agentTaskService.markAgentTaskFailed(task.id, msg);
    return { taskId: task.id, status: "failed", error: msg };
  }
}

// ═══════════════════════════════════════════════════════════════════

export async function agentRoutes(app: FastifyInstance) {
  // ─── POST /api/agent/tools/create-schedule ────────────────────
  app.post("/agent/tools/create-schedule", async (request, reply) => {
    const input = CreateScheduleToolInput.parse(request.body);

    const result = await withAgentTask("create_schedule", input, async () => {
      const schedule = await scheduleService.createSchedule({
        name: input.name,
        type: input.type,
        scheduledAt: input.scheduledAt,
        cronExpression: input.cronExpression,
        messageContent: input.messageContent,
        targetId: input.targetId,
        targetName: input.targetName,
        repeatEnabled: input.repeatEnabled ?? false,
        repeatCron: input.repeatCron,
        createdBy: "ai",
        originalCommand: input.originalCommand,
      });
      // Queue job for worker polling (same as POST /api/schedules)
      if (schedule.nextRunAt && (schedule.status === "scheduled" || schedule.status === "active")) {
        const { rescheduleAfterUpdate } = await import("../workers/scheduler-bridge.js");
        await rescheduleAfterUpdate(schedule.id, schedule.version);
      }
      return { scheduleId: schedule.id, version: schedule.version };
    });

    if (result.status === "failed") {
      return reply.status(400).send({ error: "CreateScheduleFailed", message: result.error, agentTaskId: result.taskId });
    }
    return result;
  });

  // ─── POST /api/agent/tools/update-schedule ────────────────────
  app.post("/agent/tools/update-schedule", async (request, reply) => {
    const input = UpdateScheduleToolInput.parse(request.body);

    const result = await withAgentTask(
      "update_schedule",
      input,
      async () => {
        const updated = await scheduleService.updateSchedule(
          input.scheduleId,
          {
            name: input.name,
            scheduledAt: input.scheduledAt,
            cronExpression: input.cronExpression,
            messageContent: input.messageContent,
            targetId: input.targetId,
            targetName: input.targetName,
            status: input.status,
            changedBy: "ai",
          },
          "ai",
        );

        if (!updated) throw new Error(`Schedule ${input.scheduleId} not found`);

        return { scheduleId: updated.id, version: updated.version, status: updated.status };
      },
      { scheduleId: input.scheduleId },
    );

    if (result.status === "failed") {
      return reply.status(400).send({ error: "UpdateScheduleFailed", message: result.error, agentTaskId: result.taskId });
    }
    return result;
  });

  // ─── POST /api/agent/tools/search-messages ────────────────────
  app.post("/agent/tools/search-messages", async (request) => {
    const input = SearchMessagesToolInput.parse(request.body);

    const result = await withAgentTask("search_messages", input, async () => {
      return listMessages({
        threadId: input.threadId,
        search: input.search,
        page: input.page,
        pageSize: input.pageSize,
      });
    });

    return result;
  });

  // ─── GET /api/agent/messages ────────────────────────────────────
  app.get("/agent/messages", async (request) => {
    const query = request.query as Record<string, string>;
    return listMessages({
      threadId: query.threadId,
      search: query.search,
      page: query.page ? parseInt(query.page, 10) : 1,
      pageSize: query.pageSize ? parseInt(query.pageSize, 10) : 50,
    });
  });

  // ─── GET /api/agent/tools/threads ─────────────────────────────
  app.get("/agent/tools/threads", async (request) => {
    const query = request.query as Record<string, string>;
    const result = await withAgentTask("list_threads", query, async () => {
      return listThreads({
        type: query.type,
        page: query.page ? parseInt(query.page, 10) : 1,
        pageSize: query.pageSize ? parseInt(query.pageSize, 10) : 50,
      });
    });
    return result;
  });

  // ─── POST /api/agent/tools/create-attendance-session ─────────
  app.post("/agent/tools/create-attendance-session", async (request, reply) => {
    const input = CreateAttendanceToolInput.parse(request.body);
    const result = await withAgentTask("create_attendance", input, async () => {
      const { createSession } = await import("../services/attendance.service.js");
      return createSession(input);
    });
    if (result.status === "failed") {
      return reply.status(400).send({ error: "CreateAttendanceFailed", message: result.error, agentTaskId: result.taskId });
    }
    return result;
  });

  // ─── POST /api/agent/tools/parse-attendance ──────────────────
  app.post("/agent/tools/parse-attendance", async (request, reply) => {
    const input = ParseAttendanceToolInput.parse(request.body);
    const result = await withAgentTask("parse_attendance", input, async () => {
      const { parseMessagesForAttendance } = await import("../services/attendance.service.js");
      return parseMessagesForAttendance(input.sessionId);
    });
    if (result.status === "failed") {
      return reply.status(400).send({ error: "ParseAttendanceFailed", message: result.error, agentTaskId: result.taskId });
    }
    return result;
  });

  // ─── GET /api/agent/tools/attendance-summary ─────────────────
  app.get("/agent/tools/attendance-summary", async (request) => {
    const query = request.query as Record<string, string>;
    const result = await withAgentTask("attendance_summary", query, async () => {
      const sessionId = query.sessionId;
      if (!sessionId) throw new Error("sessionId required");
      const { getSession, listRecords } = await import("../services/attendance.service.js");
      const session = await getSession(sessionId);
      const records = await listRecords(sessionId);
      return { session, records };
    });
    return result;
  });

  // ─── POST /api/agent/tools/run-dry ────────────────────────────
  app.post("/agent/tools/run-dry", async (request, reply) => {
    const input = RunDryToolInput.parse(request.body);

    const result = await withAgentTask(
      "run_dry",
      input,
      async () => {
        const dryRun = await executeDryRun(input.scheduleId, { sender: mockSender });
        return dryRun;
      },
      { scheduleId: input.scheduleId },
    );

    if (result.status === "failed") {
      return reply.status(400).send({ error: "DryRunFailed", message: result.error, agentTaskId: result.taskId });
    }
    return result;
  });

  // ─── POST /api/agent/parse-command ────────────────────────────
  app.post("/agent/parse-command", async (request) => {
    const input = ParseCommandInput.parse(request.body);
    const result = await withAgentTask("parse_command", input, async () => {
      return parseCommand(input.command);
    });
    return result;
  });

  // ─── GET /api/agent/tasks ─────────────────────────────────────
  app.get("/agent/tasks", async (request) => {
    const query = request.query as Record<string, string>;
    return agentTaskService.listAgentTasks({
      status: query.status,
      agentName: query.agentName,
      page: query.page ? parseInt(query.page, 10) : 1,
      pageSize: query.pageSize ? parseInt(query.pageSize, 10) : 50,
    });
  });

  // ─── GET /api/agent/auto-reply/status ───────────────────────────
  app.get("/agent/auto-reply/status", async () => {
    const { getAutoReplyStatus } = await import("../services/incoming-dispatcher.service.js");
    return getAutoReplyStatus();
  });

  // ─── General POST /api/agent/tasks ────────────────────────────
  app.post("/agent/tasks", async (request, reply) => {
    const input = CreateAgentTaskInput.parse(request.body);
    const task = await agentTaskService.createAgentTask({
      agentName: input.agentName,
      taskType: input.taskType,
      input: input.input,
      scheduleId: input.scheduleId,
      messageId: input.messageId,
    });
    reply.status(201);
    return { data: task };
  });

  // ═══════════════════════════════════════════════════════════════════
  // Allowed Thread Review — safety dashboard for production readiness
  // ═══════════════════════════════════════════════════════════════════

  // ─── GET /api/agent/threads/review ───────────────────────────────
  app.get("/agent/threads/review", async (_request, reply) => {
    try {
      const { reviewAllowedThreads } = await import(
        "../services/allowed-thread-review.service.js"
      );
      const review = await reviewAllowedThreads();
      return reply.send(review);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: "ThreadReviewFailed", message: msg });
    }
  });

  // ─── GET /api/agent/threads/review/:threadId ─────────────────────
  app.get("/agent/threads/review/:threadId", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };

    try {
      const { reviewSingleThread } = await import(
        "../services/allowed-thread-review.service.js"
      );
      const entry = await reviewSingleThread(threadId);
      if (!entry) {
        return reply.status(404).send({ error: "ThreadNotFound", message: `Thread ${threadId} not found` });
      }
      return reply.send(entry);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: "ThreadReviewFailed", message: msg });
    }
  });
}
