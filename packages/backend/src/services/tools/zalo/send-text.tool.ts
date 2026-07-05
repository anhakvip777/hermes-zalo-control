// =============================================================================
// zalo.sendText (Phase 3) — outbound text tool
// =============================================================================
// MUST route through OutboundDispatcher.sendOutbound() (source="agent_tool").
// NEVER calls the provider / zca-js / sendMessage directly. The dispatcher is the
// sole authority for dryRun/live/cooldown/OutboundRecord. This tool maps the
// OutboundResult to the gateway's two-field status and records the sentMessageId.
// (Note: sendOutbound does not return outboundRecordId, so ToolCallRecord links
//  via sentMessageId + stored decision, not the OutboundRecord.id.)
// =============================================================================

import { z } from "zod";
import { toolErrors } from "../../tool-gateway/errors.js";
import type { DeliveryStatus, ToolDefinition } from "../../tool-gateway/types.js";
import { resolveSendOutbound, type ZaloToolDeps } from "./deps.js";

export function createSendTextTool(deps: ZaloToolDeps = {}): ToolDefinition {
  return {
    name: "zalo.sendText",
    kind: "outbound",
    minRole: "basic_chat",
    dataScope: "own_thread",
    requiresIdempotencyKey: true,
    argsSchema: z.object({
      threadId: z.string().min(1),
      threadType: z.enum(["user", "group"]),
      content: z.string().min(1),
      relatedMessageId: z.string().optional(),
    }),
    resultSchema: z.object({
      success: z.boolean(),
      dryRun: z.boolean(),
      decision: z.enum(["allow", "block", "skip"]),
      reason: z.string(),
      sentMessageId: z.string().optional(),
    }),
    async execute({ args, ctx }) {
      const { threadId, threadType, content, relatedMessageId } = args as {
        threadId: string;
        threadType: "user" | "group";
        content: string;
        relatedMessageId?: string;
      };

      const sendOutbound = await resolveSendOutbound(deps);
      let out;
      try {
        out = await sendOutbound({
          threadId,
          threadType,
          source: "agent_tool",
          content,
          relatedMessageId: relatedMessageId ?? ctx.relatedMessageId,
          metadata: { via: "zalo.sendText", agentName: ctx.agentName ?? null },
        });
      } catch (err: unknown) {
        // Dispatcher threw → surface as provider_error (gateway → failed).
        throw toolErrors.providerError((err as Error)?.message ?? "sendOutbound failed");
      }

      // Map OutboundResult → gateway delivery status.
      // NOTE: sendOutbound's cooldown/block responses also carry dryRun=true, so
      // branch on decision/reason first (a real dry-run has decision="allow").
      let deliveryStatus: DeliveryStatus;
      if (out.decision === "allow" && out.dryRun) {
        deliveryStatus = "dry_run";
      } else if (out.decision === "allow" && out.success) {
        deliveryStatus = "live_sent";
      } else if (out.reason === "cooldown") {
        deliveryStatus = "cooldown_blocked";
      } else {
        deliveryStatus = "skipped";
      }

      return {
        result: {
          success: out.success,
          dryRun: out.dryRun,
          decision: out.decision,
          reason: out.reason,
          sentMessageId: out.sentMessageId,
        },
        deliveryStatus,
        links: {
          relatedMessageId: relatedMessageId ?? ctx.relatedMessageId,
        },
      };
    },
  };
}
