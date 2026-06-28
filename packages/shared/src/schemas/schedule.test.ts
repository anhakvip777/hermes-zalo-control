import { describe, it, expect } from "vitest";
import { CreateScheduleSchema, UpdateScheduleSchema, ScheduleFilterSchema } from "./schedule.js";

describe("CreateScheduleSchema", () => {
  it("validates a valid schedule", () => {
    const result = CreateScheduleSchema.safeParse({
      name: "Nhắc Lễ Phật",
      type: "zalo_message",
      scheduledAt: "2026-06-22T22:00:00.000Z",
      messageContent: "Nhắc Lễ Phật tối nay",
      targetId: "group-123",
      targetName: "Lớp Tu Học",
      createdBy: "ai",
      originalCommand: "22h tối nay nhắn tin nhắc Lễ Phật vào group Zalo Lớp Tu Học",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.createdBy).toBe("ai");
      // status is not in CreateScheduleSchema — it's computed by the service
    }
  });

  it("rejects empty name", () => {
    const result = CreateScheduleSchema.safeParse({
      name: "",
      messageContent: "test",
      targetId: "group-123",
    });
    expect(result.success).toBe(false);
  });

  it("applies defaults", () => {
    const result = CreateScheduleSchema.safeParse({
      name: "Test",
      messageContent: "Hello",
      targetId: "group-123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("zalo_message");
      expect(result.data.createdBy).toBe("user");
      expect(result.data.repeatEnabled).toBe(false);
    }
  });
});

describe("UpdateScheduleSchema", () => {
  it("allows partial updates", () => {
    const result = UpdateScheduleSchema.safeParse({
      scheduledAt: "2026-06-22T23:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = UpdateScheduleSchema.safeParse({
      status: "invalid_status",
    });
    expect(result.success).toBe(false);
  });
});

describe("ScheduleFilterSchema", () => {
  it("applies pagination defaults", () => {
    const result = ScheduleFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
      expect(result.data.sortBy).toBe("createdAt");
      expect(result.data.sortOrder).toBe("desc");
    }
  });
});
