import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanDatabase } from "./shared-setup.js";
import * as scheduleService from "../services/schedule.service.js";
import * as agentTaskService from "../services/agent-task.service.js";
import { listMessages, saveIncomingMessage } from "../services/zalo-receive.js";
import { parseCommand } from "../agent/parse-command.js";

beforeAll(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
});

beforeEach(async () => {
  await cleanDatabase();
});

// ═══════════════════════════════════════════════════════════════════
describe("AgentTask service", () => {
  it("creates task with pending status", async () => {
    const task = await agentTaskService.createAgentTask({
      taskType: "create_schedule",
      input: { name: "Test" },
    });
    expect(task.status).toBe("pending");
    expect(task.agentName).toBe("hermes");
    expect(task.taskType).toBe("create_schedule");
    expect(task.input).toContain("Test");
  });

  it("marks task completed with result", async () => {
    const task = await agentTaskService.createAgentTask({
      taskType: "create_schedule",
      input: { name: "Test" },
    });
    await agentTaskService.markAgentTaskCompleted(task.id, { scheduleId: "sched-1" }, "sched-1");

    const updated = await agentTaskService.listAgentTasks({});
    expect(updated.data[0]!.status).toBe("completed");
    expect(updated.data[0]!.result).toContain("sched-1");
    expect(updated.data[0]!.scheduleId).toBe("sched-1");
  });

  it("marks task failed with error", async () => {
    const task = await agentTaskService.createAgentTask({
      taskType: "create_schedule",
      input: { name: "Test" },
    });
    await agentTaskService.markAgentTaskFailed(task.id, "Something went wrong");

    const updated = await agentTaskService.listAgentTasks({});
    expect(updated.data[0]!.status).toBe("failed");
    expect(updated.data[0]!.errorMessage).toBe("Something went wrong");
  });

  it("lists tasks filtered by status", async () => {
    const t1 = await agentTaskService.createAgentTask({ taskType: "search_messages", input: {} });
    const t2 = await agentTaskService.createAgentTask({ taskType: "create_schedule", input: {} });
    await agentTaskService.markAgentTaskCompleted(t1.id, {});
    await agentTaskService.markAgentTaskFailed(t2.id, "error");

    const completed = await agentTaskService.listAgentTasks({ status: "completed" });
    expect(completed.total).toBe(1);

    const failed = await agentTaskService.listAgentTasks({ status: "failed" });
    expect(failed.total).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("Agent creates schedule (tool flow)", () => {
  it("creates schedule with createdBy=ai", async () => {
    const task = await agentTaskService.createAgentTask({
      taskType: "create_schedule",
      input: { name: "Nhac Le Phat" },
    });

    const schedule = await scheduleService.createSchedule({
      name: "Nhac Le Phat",
      type: "zalo_message",
      scheduledAt: "2026-06-22T22:00:00.000Z",
      messageContent: "Nho Le Phat nhe",
      targetId: "group-123",
      targetName: "Lop Tu Hoc",
      createdBy: "ai",
      repeatEnabled: false,
      originalCommand: "22h nhac Le Phat vao group Lop Tu Hoc",
    });

    await agentTaskService.markAgentTaskCompleted(
      task.id,
      { scheduleId: schedule.id },
      schedule.id,
    );

    expect(schedule.createdBy).toBe("ai");
    expect(schedule.version).toBe(1);

    const updated = await agentTaskService.listAgentTasks({});
    expect(updated.data[0]!.status).toBe("completed");
    expect(updated.data[0]!.scheduleId).toBe(schedule.id);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("Agent updates schedule with version bump", () => {
  it("update creates revision and bumps version", async () => {
    const schedule = await scheduleService.createSchedule({
      name: "Test",
      type: "zalo_message",
      scheduledAt: "2026-06-22T10:00:00.000Z",
      messageContent: "Original",
      targetId: "group-abc",
      createdBy: "ai",
      repeatEnabled: false,
    });
    expect(schedule.version).toBe(1);

    const updated = await scheduleService.updateSchedule(schedule.id, {
      scheduledAt: "2026-06-22T11:00:00.000Z",
      changedBy: "ai",
    }, "ai");

    expect(updated).not.toBeNull();
    expect(updated!.version).toBe(2);
    expect(updated!.createdBy).toBe("ai");

    const revisions = await scheduleService.getScheduleRevisions(schedule.id);
    const timeRev = revisions.find((r) => r.field === "scheduledAt");
    expect(timeRev).toBeDefined();
    expect(timeRev!.changedBy).toBe("ai");
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("Agent searchMessages from message store", () => {
  it("finds saved messages", async () => {
    await saveIncomingMessage({
      zaloMessageId: "zmid-agent-1",
      threadId: "group-x",
      threadType: "group",
      senderId: "user-5",
      senderName: "User Five",
      content: "Nho Le Phat toi nay",
      messageType: "text",
      rawMetadata: "{}",
    }, null);
    await saveIncomingMessage({
      zaloMessageId: "zmid-agent-2",
      threadId: "group-y",
      threadType: "group",
      senderId: "user-6",
      content: "Chao buoi sang",
      messageType: "text",
      rawMetadata: "{}",
    }, null);

    const result = await listMessages({ search: "Le Phat" });
    expect(result.total).toBe(1);
    expect(result.data[0]!.content).toContain("Le Phat");
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("parseCommand — NL → schedule draft", () => {
  it('detects intent from "22h nhắc Lễ Phật vào group Lớp Tu Học"', () => {
    const result = parseCommand("22h nhắc Lễ Phật vào group Lớp Tu Học");
    expect(result.intent).toBe("create_schedule");
    expect(result.scheduleDraft!.targetName).toContain("Lớp Tu Học");
    expect(result.scheduleDraft!.scheduledAt).toBeTruthy();
  });

  it('detects missing targetId when no group mentioned', () => {
    const result = parseCommand("21h nhắc học bài");
    expect(result.missingFields).toContain("targetId");
  });

  it('parses time from "10h30 tối" format', () => {
    const result = parseCommand("10h30 tối nhắn tin ngủ ngon vào group Test");
    expect(result.scheduleDraft!.scheduledAt).toBeTruthy();
    const date = new Date(result.scheduleDraft!.scheduledAt as string);
    expect(date.getHours()).toBeGreaterThanOrEqual(20); // evening
  });

  it('extracts content from "nhắc X vào group Y"', () => {
    const result = parseCommand("7h sáng nhắc tập thể dục vào group Sức Khỏe");
    expect(result.scheduleDraft!.messageContent).toContain("tập thể dục");
    expect(result.scheduleDraft!.targetName).toContain("Sức Khỏe");
  });

  it("detects attendance intent", () => {
    const result = parseCommand("điểm danh lớp học tối nay");
    expect(result.intent).toBe("create_attendance");
  });

  it("detects search intent", () => {
    const result = parseCommand("tìm tin nhắn Lễ Phật");
    expect(result.intent).toBe("search_messages");
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("AgentTask audit — failed task", () => {
  it("failed task preserves error in log", async () => {
    const task = await agentTaskService.createAgentTask({
      taskType: "create_schedule",
      input: { name: "Bad Input" },
    });
    await agentTaskService.markAgentTaskFailed(task.id, "Missing targetId");

    const updated = await agentTaskService.listAgentTasks({});
    expect(updated.data[0]!.status).toBe("failed");
    expect(updated.data[0]!.errorMessage).toBe("Missing targetId");
    // Failed task result is null (never completed)
  });
});
