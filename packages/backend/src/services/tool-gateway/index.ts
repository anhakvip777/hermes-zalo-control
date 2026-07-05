// =============================================================================
// Tool Gateway — public surface (Phase 1)
// =============================================================================
// Agent-agnostic core for all agent tool calls. Real tools (zalo/memory/web) and
// runtime wiring land in later phases. Phase 1 = foundation + evidence only.
// =============================================================================

export * from "./types.js";
export { ToolError, toolErrors, executionStatusForError } from "./errors.js";
export { redact, redactToJson, REDACTED } from "./redaction.js";
export {
  TOOL_ROLE_LEVEL,
  roleLevel,
  checkToolPermission,
  checkDataScope,
  buildAllowedTools,
  type PermissionDecision,
} from "./permissions.js";
export { validateArgs, validateResult } from "./schema.js";
export { deriveZaloActionIdempotencyKey, type ZaloActionKeyInput } from "./keys.js";
export { ToolRegistry, getToolRegistry, setToolRegistryForTest } from "./registry.js";
export {
  PrismaToolEvidenceSink,
  InMemoryToolEvidenceSink,
  getToolEvidenceSink,
  setToolEvidenceSinkForTest,
} from "./evidence.js";
export {
  ToolGateway,
  getToolGateway,
  setToolGatewayForTest,
  type ToolGatewayOptions,
  type ResolvedRole,
} from "./gateway.js";

import { getToolGateway } from "./gateway.js";
import type { AgentToolCall, AgentToolResult, ToolContext } from "./types.js";

/** Convenience: execute a tool call through the default shared gateway. */
export function executeTool(call: AgentToolCall, ctx: ToolContext): Promise<AgentToolResult> {
  return getToolGateway().execute(call, ctx);
}
