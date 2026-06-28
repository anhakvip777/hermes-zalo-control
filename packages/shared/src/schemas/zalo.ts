import { z } from "zod";

export const SendMessageSchema = z.object({
  threadId: z.string().min(1),
  threadType: z.enum(["user", "group"]),
  content: z.string().min(1).max(5000),
  quoteMessageId: z.string().optional(),
  dryRun: z.boolean().default(false),
});
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const ZaloStatusSchema = z.object({
  connected: z.boolean(),
  connectionStatus: z.enum(["disconnected", "connecting", "connected", "error"]),
  lastConnectedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  uptime: z.number().nullable(),
});
export type ZaloStatus = z.infer<typeof ZaloStatusSchema>;
