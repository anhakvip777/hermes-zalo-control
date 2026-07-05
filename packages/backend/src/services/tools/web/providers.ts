// =============================================================================
// Web search providers (Phase 6)
// =============================================================================
// Abstraction + default NoneProvider (unavailable) + TavilyProvider (fetch-based,
// no dependency). API keys are read internally and NEVER returned in results,
// errors, or evidence. Tests inject stub providers — no real network.
// =============================================================================

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchProviderResult {
  ok: boolean;
  results?: WebSearchResultItem[];
  /** Safe, key-free error message. */
  error?: string;
  errorCode?: string;
}

export interface WebSearchProvider {
  readonly name: string;
  /** True only when a usable provider + key are configured. */
  isConfigured(): boolean;
  search(query: string, opts: { limit: number }): Promise<WebSearchProviderResult>;
}

/** Default: nothing configured → unavailable. Never fabricates. */
export class NoneProvider implements WebSearchProvider {
  readonly name = "none";
  isConfigured(): boolean {
    return false;
  }
  async search(): Promise<WebSearchProviderResult> {
    return { ok: false, errorCode: "PROVIDER_UNAVAILABLE", error: "No web search provider configured" };
  }
}

export type FetchImpl = (url: string, init?: any) => Promise<any>;

/**
 * Tavily provider (https://api.tavily.com/search). Fetch-based, no dependency.
 * Only configured when provider="tavily" and an API key is present. The key is
 * sent in the request body only; it is never echoed into results/errors.
 */
export class TavilyProvider implements WebSearchProvider {
  readonly name = "tavily";
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchImpl,
    private readonly timeoutMs = 10_000,
  ) {}

  isConfigured(): boolean {
    return this.apiKey.trim().length > 0;
  }

  async search(query: string, opts: { limit: number }): Promise<WebSearchProviderResult> {
    if (!this.isConfigured()) {
      return { ok: false, errorCode: "PROVIDER_UNAVAILABLE", error: "Tavily API key not configured" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await this.fetchImpl("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: this.apiKey, query, max_results: opts.limit }),
        signal: controller.signal,
      });
      if (!resp?.ok) {
        // Do NOT include the key or raw provider body in the error.
        return { ok: false, errorCode: "PROVIDER_ERROR", error: `Tavily returned status ${resp?.status ?? "unknown"}` };
      }
      const data = await resp.json();
      const items: WebSearchResultItem[] = Array.isArray(data?.results)
        ? data.results.slice(0, opts.limit).map((r: any) => ({
            title: String(r?.title ?? "").slice(0, 300),
            url: String(r?.url ?? ""),
            snippet: String(r?.content ?? r?.snippet ?? "").slice(0, 500),
          }))
        : [];
      return { ok: true, results: items };
    } catch (err: unknown) {
      const msg = err instanceof Error && err.name === "AbortError" ? "Tavily request timed out" : "Tavily request failed";
      return { ok: false, errorCode: "PROVIDER_ERROR", error: msg };
    } finally {
      clearTimeout(timer);
    }
  }
}
