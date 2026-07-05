// =============================================================================
// Web tools — injectable dependencies (Phase 6)
// =============================================================================
// DB/web-free testable. Defaults use config + Node built-in fetch/dns.
// Providers read their own API key internally; keys never surface in tool I/O.
// =============================================================================

import type { DnsResolver } from "./ssrf-guard.js";
import type { FetchImpl, WebSearchProvider } from "./providers.js";

export interface WebConfig {
  searchEnabled: boolean;
  searchMaxResults: number;
  fetchEnabled: boolean;
  fetchTimeoutMs: number;
  fetchMaxBytes: number;
  fetchMaxRedirects: number;
  fetchMaxContentChars: number;
}

export interface WebToolDeps {
  getConfig?: () => WebConfig;
  getSearchProvider?: () => WebSearchProvider;
  fetchImpl?: FetchImpl;
  resolveDns?: DnsResolver;
}

export function resolveWebConfig(deps: WebToolDeps): WebConfig {
  if (deps.getConfig) return deps.getConfig();
  // Lazy require of config to keep this module import-safe.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { config } = requireConfig();
  const w = config.web;
  return {
    searchEnabled: w.searchEnabled,
    searchMaxResults: w.searchMaxResults,
    fetchEnabled: w.fetchEnabled,
    fetchTimeoutMs: w.fetchTimeoutMs,
    fetchMaxBytes: w.fetchMaxBytes,
    fetchMaxRedirects: w.fetchMaxRedirects,
    fetchMaxContentChars: w.fetchMaxContentChars,
  };
}

export function resolveSearchProvider(deps: WebToolDeps): WebSearchProvider {
  if (deps.getSearchProvider) return deps.getSearchProvider();
  const { config } = requireConfig();
  const { NoneProvider, TavilyProvider } = requireProviders();
  const w = config.web;
  if (w.searchProvider === "tavily") {
    return new TavilyProvider(w.searchApiKey, deps.fetchImpl ?? (globalThis.fetch as FetchImpl), w.fetchTimeoutMs);
  }
  // firecrawl / gemini not implemented in Phase 6 → unavailable.
  return new NoneProvider();
}

export function resolveFetchImpl(deps: WebToolDeps): FetchImpl {
  return deps.fetchImpl ?? (globalThis.fetch as FetchImpl);
}

// ── Sync module accessors (resolved at call time, not import time) ────
// The backend is ESM; use static imports here — importing config/providers is
// side-effect-free. Wrapped in functions so mocking stays straightforward.
import { config as _config } from "../../../config.js";
import * as _providers from "./providers.js";

function requireConfig(): { config: typeof _config } {
  return { config: _config };
}
function requireProviders(): typeof _providers {
  return _providers;
}
