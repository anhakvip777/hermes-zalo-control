// =============================================================================
// Web tools — registration (Phase 6)
// =============================================================================
// registerWebTools() registers web.search + web.fetchPage. NOT auto-registered
// at import/app-startup. Tools self-gate on config (return `unavailable` when
// disabled/no provider) — safe to register even when disabled.
// =============================================================================

import { getToolRegistry, type ToolRegistry } from "../../tool-gateway/registry.js";
import type { ToolDefinition } from "../../tool-gateway/types.js";
import type { WebToolDeps } from "./deps.js";
import { createWebSearchTool } from "./search.tool.js";
import { createWebFetchPageTool } from "./fetch-page.tool.js";

export type { WebToolDeps } from "./deps.js";

export function buildWebTools(deps: WebToolDeps = {}): ToolDefinition[] {
  return [createWebSearchTool(deps), createWebFetchPageTool(deps)];
}

export function registerWebTools(registry: ToolRegistry = getToolRegistry(), deps: WebToolDeps = {}): void {
  for (const tool of buildWebTools(deps)) {
    if (!registry.has(tool.name)) registry.register(tool);
  }
}
