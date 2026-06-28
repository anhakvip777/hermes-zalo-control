import { z } from "zod";

export const CreateAttendanceSessionSchema = z.object({
  name: z.string().min(1).max(255),
  targetId: z.string().min(1),
  targetName: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
  expectedCount: z.number().int().min(0).optional(),
});
export type CreateAttendanceSessionInput = z.infer<typeof CreateAttendanceSessionSchema>;

export const AttendanceStatus = z.enum(["draft", "scheduled", "active", "closed", "cancelled"]);
export type AttendanceStatus = z.infer<typeof AttendanceStatus>;
