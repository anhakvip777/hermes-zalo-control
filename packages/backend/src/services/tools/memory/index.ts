// =============================================================================
// Memory tools — registration (Phase 4)
// =============================================================================
// registerMemoryTools() registers all memory/rules/access/system tools into a
// registry. NOT called at import time and NOT wired into app startup — runtime
// dispatch arrives in Phase 5. Tests register explicitly.
// =============================================================================

import { getToolRegistry, type ToolRegistry } from "../../tool-gateway/registry.js";
import type { ToolDefinition } from "../../tool-gateway/types.js";
import type { MemoryDeps } from "./deps.js";
import {
  createGetRecentMessagesTool,
  createGetThreadHistoryTool,
  createSearchMessagesTool,
} from "./message-tools.js";
import {
  createGetAgentTasksTool,
  createGetOutboundRecordsTool,
  createRulesExplainForMessageTool,
} from "./record-tools.js";
import {
  createAccessGetUserRoleTool,
  createSystemGetRuntimeStatusTool,
} from "./access-system-tools.js";

export type { MemoryDeps } from "./deps.js";

/** Build all memory tool definitions (pure — no registration side-effect). */
export function buildMemoryTools(deps: MemoryDeps = {}): ToolDefinition[] {
  return [
    createGetRecentMessagesTool(deps),
    createSearchMessagesTool(deps),
    createGetThreadHistoryTool(deps),
    createGetOutboundRecordsTool(deps),
    createGetAgentTasksTool(deps),
    createRulesExplainForMessageTool(deps),
    createAccessGetUserRoleTool(deps),
    createSystemGetRuntimeStatusTool(deps),
  ];
}

/** Register all memory tools (idempotent). Default: shared registry. */
export function registerMemoryTools(registry: ToolRegistry = getToolRegistry(), deps: MemoryDeps = {}): void {
  for (const tool of buildMemoryTools(deps)) {
    if (!registry.has(tool.name)) registry.register(tool);
  }
}
