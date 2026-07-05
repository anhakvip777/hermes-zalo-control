// =============================================================================
// Zalo tools — registration (Phase 3)
// =============================================================================
// registerZaloTools() registers all zalo.* tools into a registry. NOT called at
// import time and NOT wired into app startup — runtime agent→gateway dispatch
// arrives in Phase 5. Tests register explicitly into a fresh ToolRegistry.
// =============================================================================

import { getToolRegistry, type ToolRegistry } from "../../tool-gateway/registry.js";
import type { ToolDefinition } from "../../tool-gateway/types.js";
import type { ZaloToolDeps } from "./deps.js";
import {
  createGetFriendInfoTool,
  createGetRuntimeStatusTool,
  createGetThreadInfoTool,
  createListFriendsTool,
  createListGroupsTool,
} from "./read-tools.js";
import { createSendTextTool } from "./send-text.tool.js";

export type { ZaloToolDeps } from "./deps.js";

/** Build all Zalo tool definitions (pure — no registration side-effect). */
export function buildZaloTools(deps: ZaloToolDeps = {}): ToolDefinition[] {
  return [
    createGetRuntimeStatusTool(deps),
    createListGroupsTool(deps),
    createGetThreadInfoTool(deps),
    createListFriendsTool(deps),
    createGetFriendInfoTool(deps),
    createSendTextTool(deps),
  ];
}

/**
 * Register all Zalo tools into the given registry (default: shared registry).
 * Idempotent: skips tools already registered.
 */
export function registerZaloTools(
  registry: ToolRegistry = getToolRegistry(),
  deps: ZaloToolDeps = {},
): void {
  for (const tool of buildZaloTools(deps)) {
    if (!registry.has(tool.name)) registry.register(tool);
  }
}
