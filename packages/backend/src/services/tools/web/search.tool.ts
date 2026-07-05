// =============================================================================
// web.search (Phase 6) — advanced/admin only; unavailable if no provider/key.
// Never fabricates results. Results whitelisted + bounded; gateway redacts.
// =============================================================================

import { z } from "zod";
import { toolErrors } from "../../tool-gateway/errors.js";
import type { ToolDefinition } from "../../tool-gateway/types.js";
import { resolveSearchProvider, resolveWebConfig, type WebToolDeps } from "./deps.js";

export function createWebSearchTool(deps: WebToolDeps = {}): ToolDefinition {
  return {
    name: "web.search",
    kind: "read",
    minRole: "advanced",
    dataScope: "none",
    argsSchema: z.object({ query: z.string().min(1), limit: z.number().optional() }),
    resultSchema: z.object({
      provider: z.string(),
      results: z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string() })),
    }),
    async execute({ args }) {
      const { query, limit } = args as { query: string; limit?: number };
      const cfg = resolveWebConfig(deps);
      const provider = resolveSearchProvider(deps);

      if (!cfg.searchEnabled || !provider.isConfigured()) {
        throw toolErrors.unavailable("web.search unavailable: no provider/key configured");
      }

      const max = cfg.searchMaxResults;
      const clamped = Math.min(max, Math.max(1, typeof limit === "number" ? Math.floor(limit) : max));
      const r = await provider.search(query, { limit: clamped });

      if (!r.ok) {
        if (r.errorCode === "PROVIDER_UNAVAILABLE") {
          throw toolErrors.unavailable("web.search unavailable");
        }
        // Key-free provider error only.
        throw toolErrors.providerError(r.error ?? "web.search provider error");
      }
      return { result: { provider: provider.name, results: (r.results ?? []).slice(0, clamped) } };
    },
  };
}
