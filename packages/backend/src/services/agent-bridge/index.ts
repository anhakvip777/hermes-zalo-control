// =============================================================================
// Agent Bridge — public surface (Phase 5)
// =============================================================================
// getAgentBridge() lazily constructs the bridge with the HermesAdapter and
// registers the existing tool sets (Zalo + memory) — ONLY when called (i.e. only
// when config.hermesAgentBridge.enabled is true, from the guarded dispatcher
// branch). Not constructed at import / app startup.
//
// NOTE: importing the register* FUNCTIONS below is side-effect-free — no tool is
// registered until registerAllTools()/getAgentBridge() actually runs.
// =============================================================================

export * from "./types.js";
export { AgentBridge, type AgentBridgeInput, type AgentBridgeOptions } from "./agent-bridge.js";
export { HermesAdapter } from "./hermes-adapter.js";

import { AgentBridge } from "./agent-bridge.js";
import { HermesAdapter } from "./hermes-adapter.js";
import { getToolRegistry, type ToolRegistry } from "../tool-gateway/registry.js";
import { registerZaloTools } from "../tools/zalo/index.js";
import { registerMemoryTools } from "../tools/memory/index.js";
import { registerWebTools } from "../tools/web/index.js";

let sharedBridge: AgentBridge | null = null;

/** Register existing tool sets into a registry (idempotent). */
export function registerAllTools(registry: ToolRegistry = getToolRegistry()): void {
  registerZaloTools(registry);
  registerMemoryTools(registry);
  registerWebTools(registry);
}

/**
 * Lazily build the shared AgentBridge (HermesAdapter + default registry).
 * Registers Zalo + memory tools on first construction. Call only when the
 * structured bridge flag is enabled.
 */
export function getAgentBridge(): AgentBridge {
  if (!sharedBridge) {
    const registry = getToolRegistry();
    registerAllTools(registry); // idempotent; only runs when the bridge is built
    sharedBridge = new AgentBridge({ adapter: new HermesAdapter(), registry });
  }
  return sharedBridge;
}

export function setAgentBridgeForTest(bridge: AgentBridge | null): void {
  sharedBridge = bridge;
}
