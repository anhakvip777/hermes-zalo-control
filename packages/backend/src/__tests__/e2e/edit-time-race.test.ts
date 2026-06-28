// E2E R10 — Edit Time Race Condition
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanDatabase } from "../shared-setup.js";
import * as scheduleService from "../../services/schedule.service.js";
import * as executionService from "../../services/execution.service.js";
import * as jobService from "../../services/job.service.js";
import * as settingsService from "../../services/settings.service.js";
import { executeJob } from "../../workers/scheduler.js";
import { MockMessageSender } from "../../services/message-sender.js";
import { queueScheduleJob, cancelScheduleJobs } from "../../workers/scheduler-bridge.js";
import type { CreateScheduleInput } from "@hermes/shared";

beforeAll(async () => {
  await cleanDatabase();
  await settingsService.initializeDefaultSettings();
});

afterAll(async () => {
  await cleanDatabase();
});

beforeEach(async () => {
  await cleanDatabase();
  await settingsService.initializeDefaultSettings();
});

describe("E2E — Edit Time Race Condition (R10)", () => {
  it("old job skipped, only new job sends at updated time", async () => {
    const sender = new MockMessageSender();

    // Step 1: Create schedule at 10:00 version=1
    const schedule = await scheduleService.createSchedule({
      name: "E2E Test",
      type: "zalo_message",
      scheduledAt: "2026-06-22T10:00:00.000Z",
      messageContent: "Original 10:00 message",
      targetId: "group-e2e",
      targetName: "E2E Group",
      createdBy: "user",
      repeatEnabled: false,
      metadata: JSON.stringify({ threadType: "user" }),
    });
    expect(schedule.version).toBe(1);

    // Queue job_1
    await queueScheduleJob({
      scheduleId: schedule.id,
      scheduleVersion: 1,
      runAt: new Date("2026-06-22T10:00:00.000Z"),
      type: "scheduled",
    });
    const jobs1 = await jobService.listScheduleJobs(schedule.id);
    expect(jobs1.length).toBe(1);

    // Step 2: Edit to 11:00 version=2, cancel old jobs
    await cancelScheduleJobs(schedule.id);
    const updated = await scheduleService.updateSchedule(schedule.id, {
      scheduledAt: "2026-06-22T11:00:00.000Z",
      messageContent: "Updated 11:00 message",
    });
    expect(updated!.version).toBe(2);

    // Job_1 should be cancelled
    for (const j of await jobService.listScheduleJobs(schedule.id)) {
      expect(j.status).toBe("cancelled");
    }

    // Queue job_2
    await queueScheduleJob({
      scheduleId: schedule.id,
      scheduleVersion: 2,
      runAt: new Date("2026-06-22T11:00:00.000Z"),
      type: "scheduled",
    });

    // Step 3: Force job_1 to fire → skipped
    await executeJob({ scheduleId: schedule.id, scheduleVersion: 1 }, { sender });
    expect(sender.getSentMessages().length).toBe(0);

    // Step 4: Fire job_2 → success
    await executeJob({ scheduleId: schedule.id, scheduleVersion: 2 }, { sender });
    expect(sender.getSentMessages().length).toBe(1);
    expect(sender.getLastSentMessage()!.content).toBe("Updated 11:00 message");

    // Step 5: Verify execution records
    const executions = await executionService.listExecutions({ scheduleId: schedule.id });
    expect(executions.data.filter((e) => e.status === "skipped").length).toBe(1);
    expect(executions.data.filter((e) => e.status === "success").length).toBe(1);
  });

  it("edit content — old skipped, new content sent", async () => {
    const sender = new MockMessageSender();
    const schedule = await scheduleService.createSchedule({
      name: "Content Edit",
      type: "zalo_message",
      scheduledAt: "2026-06-22T14:00:00.000Z",
      messageContent: "Original",
      targetId: "group-content",
      targetName: "Content Group",
      createdBy: "user",
      repeatEnabled: false,
      metadata: JSON.stringify({ threadType: "user" }),
    });
    expect(schedule.version).toBe(1);

    await cancelScheduleJobs(schedule.id);
    const updated = await scheduleService.updateSchedule(schedule.id, {
      messageContent: "Revised",
    });
    expect(updated!.version).toBe(2);

    // Old job
    await executeJob({ scheduleId: schedule.id, scheduleVersion: 1 }, { sender });
    expect(sender.getSentMessages().length).toBe(0);

    // New job
    await executeJob({ scheduleId: schedule.id, scheduleVersion: 2 }, { sender });
    expect(sender.getSentMessages().length).toBe(1);
    expect(sender.getLastSentMessage()!.content).toBe("Revised");

    const executions = await executionService.listExecutions({ scheduleId: schedule.id });
    expect(executions.data.filter((e) => e.status === "skipped").length).toBe(1);
    expect(executions.data.filter((e) => e.status === "success").length).toBe(1);
  });
});
