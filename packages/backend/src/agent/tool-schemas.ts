// =============================================================================
// Tool Schemas — contract between Hermes AI and backend tools
// =============================================================================

import { z } from "zod";

// ─── create-schedule ─────────────────────────────────────────────────

export const CreateScheduleToolInput = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(["zalo_message", "attendance", "poll_extract", "custom_agent_task"]).default("zalo_message"),
  scheduledAt: z.string().datetime().optional(),
  cronExpression: z.string().optional(),
  targetId: z.string().min(1),
  targetName: z.string().optional(),
  messageContent: z.string().min(1).max(5000),
  originalCommand: z.string().optional(),
  repeatEnabled: z.boolean().optional(),
  repeatCron: z.string().optional(),
});

export type CreateScheduleToolInput = z.infer<typeof CreateScheduleToolInput>;

// ─── update-schedule ─────────────────────────────────────────────────

export const UpdateScheduleToolInput = z.object({
  scheduleId: z.string().min(1),
  name: z.string().min(1).max(255).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  cronExpression: z.string().nullable().optional(),
  messageContent: z.string().min(1).max(5000).optional(),
  targetId: z.string().min(1).optional(),
  targetName: z.string().nullable().optional(),
  status: z.enum(["draft", "scheduled", "active", "paused", "cancelled", "expired"]).optional(),
  reason: z.string().optional(),
});

export type UpdateScheduleToolInput = z.infer<typeof UpdateScheduleToolInput>;

// ─── search-messages ─────────────────────────────────────────────────

export const SearchMessagesToolInput = z.object({
  threadId: z.string().optional(),
  search: z.string().optional(),
  dateStart: z.string().datetime().optional(),
  dateEnd: z.string().datetime().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export type SearchMessagesToolInput = z.infer<typeof SearchMessagesToolInput>;

// ─── parse-command ───────────────────────────────────────────────────

export const ParseCommandInput = z.object({
  command: z.string().min(1),
});

export type ParseCommandInput = z.infer<typeof ParseCommandInput>;

// ─── run-dry ─────────────────────────────────────────────────────────

export const RunDryToolInput = z.object({
  scheduleId: z.string().min(1),
});

export type RunDryToolInput = z.infer<typeof RunDryToolInput>;

// ─── create-attendance (M5: add Zod validation) ──────────────────────

export const CreateAttendanceToolInput = z.object({
  name: z.string().min(1).max(255),
  targetId: z.string().min(1),
  targetName: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
  expectedCount: z.number().int().min(0).optional(),
});

export type CreateAttendanceToolInput = z.infer<typeof CreateAttendanceToolInput>;

// ─── parse-attendance (M5: add Zod validation) ───────────────────────

export const ParseAttendanceToolInput = z.object({
  sessionId: z.string().min(1),
});

export type ParseAttendanceToolInput = z.infer<typeof ParseAttendanceToolInput>;

// ─── generic agent task (M5: add minimal Zod validation) ─────────────

export const CreateAgentTaskInput = z.object({
  agentName: z.string().optional(),
  taskType: z.string().min(1),
  input: z.unknown(),
  scheduleId: z.string().optional(),
  messageId: z.string().optional(),
});

export type CreateAgentTaskInput = z.infer<typeof CreateAgentTaskInput>;
