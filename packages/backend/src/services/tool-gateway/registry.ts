// =============================================================================
// Tool Gateway — tool registry (Phase 1)
// =============================================================================
// Holds ToolDefinitions. An unknown tool → the gateway returns "unavailable"
// (feeds the "chưa được cấp tool" behavior). Phase 3/4/6 register real tools;
// Phase 1 ships no runtime tools (tests register stubs).
// =============================================================================

import type { ToolDefinition } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(def: ToolDefinition): void {
    if (this.tools.has(def.name)) {
      throw new Error(`ToolRegistry: duplicate tool name "${def.name}"`);
    }
    this.tools.set(def.name, def);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Test/util: remove a tool. */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /** Test/util: clear all tools. */
  clear(): void {
    this.tools.clear();
  }
}

// Default shared registry (real tools register here in later phases).
let defaultRegistry: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!defaultRegistry) defaultRegistry = new ToolRegistry();
  return defaultRegistry;
}

export function setToolRegistryForTest(registry: ToolRegistry | null): void {
  defaultRegistry = registry;
}
