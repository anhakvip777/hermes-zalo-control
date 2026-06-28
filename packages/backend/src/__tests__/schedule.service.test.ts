import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanDatabase } from "./shared-setup.js";
import * as scheduleService from "../services/schedule.service.js";
import * as settingsService from "../services/settings.service.js";
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

const baseInput: CreateScheduleInput = {
  name: "Nhắc Lễ Phật",
  type: "zalo_message",
  scheduledAt: "2026-06-22T22:00:00.000Z",
  messageContent: "Nhắc Lễ Phật tối nay",
  targetId: "group-123",
  targetName: "Lớp Tu Học",
  createdBy: "ai",
  repeatEnabled: false,
  originalCommand: "22h tối nay nhắn tin nhắc Lễ Phật vào group Zalo Lớp Tu Học",
};

describe("Schedule CRUD", () => {
  it("createSchedule sets version=1 and status=scheduled", async () => {
    const s = await scheduleService.createSchedule(baseInput);
    expect(s.version).toBe(1);
    expect(s.status).toBe("scheduled");
    expect(s.name).toBe("Nhắc Lễ Phật");
    expect(s.createdBy).toBe("ai");
    const revs = await scheduleService.getScheduleRevisions(s.id);
    expect(revs.length).toBe(1);
    expect(revs[0]!.scheduleVersion).toBe(1);
    expect(revs[0]!.field).toBe("_created");
  });

  it("createSchedule with cron+active defaults to active status", async () => {
    const s = await scheduleService.createSchedule({
      ...baseInput,
      scheduledAt: undefined,
      cronExpression: "0 22 * * *",
      repeatEnabled: true,
    });
    expect(s.status).toBe("active");
    expect(s.version).toBe(1);
  });

  it("createSchedule without repeat and no scheduledAt stays draft", async () => {
    const s = await scheduleService.createSchedule({
      ...baseInput,
      scheduledAt: undefined,
      repeatEnabled: false,
    });
    expect(s.status).toBe("draft");
  });

  it("getScheduleById returns correct schedule", async () => {
    const created = await scheduleService.createSchedule(baseInput);
    const found = await scheduleService.getScheduleById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });

  it("getScheduleById returns null for missing", async () => {
    const found = await scheduleService.getScheduleById("nonexistent");
    expect(found).toBeNull();
  });
});

describe("Version Bump", () => {
  it("update time bumps version from 1 to 2", async () => {
    const s = await scheduleService.createSchedule(baseInput);
    expect(s.version).toBe(1);
    const updated = await scheduleService.updateSchedule(s.id, {
      scheduledAt: "2026-06-22T23:00:00.000Z",
    });
    expect(updated).not.toBeNull();
    expect(updated!.version).toBe(2);
  });

  it("update content bumps version", async () => {
    const s = await scheduleService.createSchedule(baseInput);
    const updated = await scheduleService.updateSchedule(s.id, {
      messageContent: "Nội dung mới",
    });
    expect(updated!.version).toBe(2);
  });

  it("update group bumps version", async () => {
    const s = await scheduleService.createSchedule(baseInput);
    const updated = await scheduleService.updateSchedule(s.id, {
      targetId: "group-456",
    });
    expect(updated!.version).toBe(2);
  });

  it("update status bumps version", async () => {
    const s = await scheduleService.createSchedule(baseInput);
    const updated = await scheduleService.updateSchedule(s.id, {
      status: "paused",
    });
    expect(updated!.version).toBe(2);
    expect(updated!.pausedAt).not.toBeNull();
  });

  it("no-op update does NOT bump version", async () => {
    const s = await scheduleService.createSchedule(baseInput);
    const updated = await scheduleService.updateSchedule(s.id, {
      name: "Nhắc Lễ Phật",
    });
    expect(updated!.version).toBe(1);
  });

  it("three consecutive edits → version=4", async () => {
    let s = await scheduleService.createSchedule(baseInput);
    s = (await scheduleService.updateSchedule(s.id, {
      scheduledAt: "2026-06-22T23:00:00.000Z",
    }))!;
    s = (await scheduleService.updateSchedule(s.id, {
      messageContent: "Updated content",
    }))!;
    s = (await scheduleService.updateSchedule(s.id, {
      targetName: "New Group Name",
    }))!;
    expect(s.version).toBe(4);
  });
});

describe("Revision Log", () => {
  it("single field change creates one revision", async () => {
    const s = await scheduleService.createSchedule(baseInput);
    const initialRevs = await scheduleService.getScheduleRevisions(s.id);
    expect(initialRevs.length).toBe(1);

    await scheduleService.updateSchedule(s.id, {
      scheduledAt: "2026-06-22T23:00:00.000Z",
    });

    const revs = await scheduleService.getScheduleRevisions(s.id);
    expect(revs.length).toBe(2);
    const timeRev = revs.find((r) => r.field === "scheduledAt");
    expect(timeRev).toBeDefined();
    expect(timeRev!.scheduleVersion).toBe(2);
    expect(timeRev!.oldValue).toContain("22:00");
    expect(timeRev!.newValue).toContain("23:00");
    expect(timeRev!.changedBy).toBe("user");
  });

  it("multi-field change creates a revision per field", async () => {
    const s = await scheduleService.createSchedule(baseInput);
    await scheduleService.updateSchedule(s.id, {
      scheduledAt: "2026-06-22T23:00:00.000Z",
      messageContent: "New content",
      targetId: "group-999",
    });
    const revs = await scheduleService.getScheduleRevisions(s.id);
    expect(revs.length).toBe(4);
    const fields = revs.filter((r) => r.field !== "_created").map((r) => r.field);
    expect(fields).toContain("scheduledAt");
    expect(fields).toContain("messageContent");
    expect(fields).toContain("targetId");
  });

  it("revision captures old and new values correctly", async () => {
    const s = await scheduleService.createSchedule(baseInput);
    await scheduleService.updateSchedule(s.id, { name: "Updated Name" });
    const revs = await scheduleService.getScheduleRevisions(s.id);
    const nameRev = revs.find((r) => r.field === "name")!;
    expect(nameRev.oldValue).toBe("Nhắc Lễ Phật");
    expect(nameRev.newValue).toBe("Updated Name");
    expect(nameRev.scheduleVersion).toBe(2);
  });

  it("no-op update does NOT create extra revisions", async () => {
    const s = await scheduleService.createSchedule(baseInput);
    const before = await scheduleService.getScheduleRevisions(s.id);
    await scheduleService.updateSchedule(s.id, { name: s.name });
    const after = await scheduleService.getScheduleRevisions(s.id);
    expect(after.length).toBe(before.length);
  });

  it("ai changedBy is recorded in revision", async () => {
    const s = await scheduleService.createSchedule(baseInput);
    await scheduleService.updateSchedule(s.id, { messageContent: "AI change" }, "ai");
    const revs = await scheduleService.getScheduleRevisions(s.id);
    const aiRev = revs.find((r) => r.field === "messageContent")!;
    expect(aiRev.changedBy).toBe("ai");
  });
});

describe("Status Transitions", () => {
  it("cancel sets cancelledAt and clears nextRunAt", async () => {
    const s = await scheduleService.createSchedule(baseInput);
    const result = await scheduleService.cancelSchedule(s.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("cancelled");
    expect(result!.cancelledAt).not.toBeNull();
    expect(result!.nextRunAt).toBeNull();
  });

  it("pause sets pausedAt", async () => {
    const s = await scheduleService.createSchedule(baseInput);
    const result = await scheduleService.updateSchedule(s.id, { status: "paused" });
    expect(result!.status).toBe("paused");
    expect(result!.pausedAt).not.toBeNull();
  });

  it("re-activating clears pausedAt", async () => {
    const s = await scheduleService.createSchedule(baseInput);
    await scheduleService.updateSchedule(s.id, { status: "paused" });
    const result = await scheduleService.updateSchedule(s.id, { status: "active" });
    expect(result!.status).toBe("active");
    expect(result!.pausedAt).toBeNull();
  });
});

describe("List / Filter / Pagination", () => {
  it("list returns all schedules with pagination", async () => {
    await scheduleService.createSchedule(baseInput);
    await scheduleService.createSchedule({
      ...baseInput,
      name: "Schedule 2",
      scheduledAt: "2026-06-23T10:00:00.000Z",
    });
    const result = await scheduleService.listSchedules({
      page: 1,
      pageSize: 10,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    expect(result.total).toBe(2);
    expect(result.data.length).toBe(2);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it("filter by status", async () => {
    const s1 = await scheduleService.createSchedule(baseInput);
    await scheduleService.createSchedule(baseInput);
    await scheduleService.cancelSchedule(s1.id);
    const active = await scheduleService.listSchedules({
      status: "scheduled",
      page: 1,
      pageSize: 10,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    expect(active.data.length).toBe(1);
    const cancelled = await scheduleService.listSchedules({
      status: "cancelled",
      page: 1,
      pageSize: 10,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    expect(cancelled.data.length).toBe(1);
  });

  it("filter by type", async () => {
    await scheduleService.createSchedule(baseInput);
    await scheduleService.createSchedule({
      ...baseInput,
      name: "Att",
      type: "attendance",
      scheduledAt: "2026-06-23T10:00:00.000Z",
    });
    const zalo = await scheduleService.listSchedules({
      type: "zalo_message",
      page: 1,
      pageSize: 10,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    expect(zalo.data.length).toBe(1);
  });

  it("search across name, content, targetName", async () => {
    await scheduleService.createSchedule(baseInput);
    await scheduleService.createSchedule({
      ...baseInput,
      name: "Unrelated",
      messageContent: "Random",
      targetName: "Other",
      originalCommand: "something different",
    });
    const results = await scheduleService.listSchedules({
      search: "Lễ Phật",
      page: 1,
      pageSize: 10,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    expect(results.data.length).toBe(1);
  });

  it("pagination works correctly", async () => {
    for (let i = 0; i < 5; i++) {
      await scheduleService.createSchedule({ ...baseInput, name: `Schedule ${i}` });
    }
    const page1 = await scheduleService.listSchedules({
      page: 1,
      pageSize: 2,
      sortBy: "createdAt",
      sortOrder: "asc",
    });
    expect(page1.data.length).toBe(2);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);
  });
});
