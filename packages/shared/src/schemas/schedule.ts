import { z } from "zod";

// === Enums ===
export const ScheduleType = z.enum([
  "zalo_message",
  "attendance",
  "poll_extract",
  "custom_agent_task",
]);
export type ScheduleType = z.infer<typeof ScheduleType>;

export const ScheduleStatus = z.enum([
  "draft",
  "scheduled",
  "active",
  "paused",
  "cancelled",
  "expired",
]);
export type ScheduleStatus = z.infer<typeof ScheduleStatus>;

export const ExecutionMode = z.enum(["scheduled", "run_now", "test_send", "dry_run"]);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

export const ExecutionStatus = z.enum([
  "pending",
  "running",
  "success",
  "failed",
  "retrying",
  "skipped",
  "unknown",
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

export const JobType = z.enum(["scheduled", "run_now", "test_send", "dry_run", "retry"]);
export type JobType = z.infer<typeof JobType>;

export const JobStatus = z.enum(["queued", "active", "completed", "cancelled", "failed"]);
export type JobStatus = z.infer<typeof JobStatus>;

// === Create Schedule ===
export const CreateScheduleSchema = z.object({
  name: z.string().min(1).max(255),
  type: ScheduleType.default("zalo_message"),
  scheduledAt: z.string().datetime().optional(),
  cronExpression: z.string().optional(),
  messageContent: z.string().min(1).max(5000),
  targetId: z.string().min(1),
  targetName: z.string().optional(),
  repeatEnabled: z.boolean().default(false),
  repeatCron: z.string().optional(),
  createdBy: z.enum(["user", "ai", "system"]).default("user"),
  originalCommand: z.string().optional(),
  metadata: z.string().optional(),
});
export type CreateScheduleInput = z.infer<typeof CreateScheduleSchema>;

// === Update Schedule ===
export const UpdateScheduleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  cronExpression: z.string().nullable().optional(),
  messageContent: z.string().min(1).max(5000).optional(),
  targetId: z.string().min(1).optional(),
  targetName: z.string().nullable().optional(),
  repeatEnabled: z.boolean().optional(),
  repeatCron: z.string().nullable().optional(),
  status: ScheduleStatus.optional(),
  changedBy: z.enum(["user", "ai", "system"]).optional(),
});
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleSchema>;

// === Schedule Filter ===
export const ScheduleFilterSchema = z.object({
  status: z.union([ScheduleStatus, z.array(ScheduleStatus)]).optional(),
  type: z.union([ScheduleType, z.array(ScheduleType)]).optional(),
  createdBy: z.enum(["user", "ai", "system"]).optional(),
  search: z.string().optional(),
  sortBy: z
    .enum(["createdAt", "scheduledAt", "nextRunAt", "updatedAt", "name"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ScheduleFilterInput = z.infer<typeof ScheduleFilterSchema>;

// === Admin Actions ===
export const AdminActionSchema = z.object({
  action: z.enum(["pause_sending", "resume_sending", "emergency_stop"]),
  reason: z.string().optional(),
});
export type AdminActionInput = z.infer<typeof AdminActionSchema>;
