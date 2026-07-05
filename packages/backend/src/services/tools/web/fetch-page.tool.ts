// =============================================================================
// web.fetchPage (Phase 6) — admin-only, SSRF-guarded, bounded text-only output.
// No raw headers/cookies. Strips <script>/<style>; content capped (~8KB).
// Re-validates every redirect target (DNS-rebinding defense).
// =============================================================================

import { z } from "zod";
import { toolErrors } from "../../tool-gateway/errors.js";
import type { ToolDefinition } from "../../tool-gateway/types.js";
import { assertUrlAllowed, defaultResolveDns } from "./ssrf-guard.js";
import { resolveFetchImpl, resolveWebConfig, type WebToolDeps } from "./deps.js";

/** Extract bounded plain text from a response body. */
function extractText(body: string, contentType: string, maxChars: number): string {
  let out = body;
  if (/html|xml/i.test(contentType) || /<[a-z!/]/i.test(body.slice(0, 200))) {
    out = out
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  }
  out = out.replace(/\s+/g, " ").trim();
  return out.slice(0, maxChars);
}

export function createWebFetchPageTool(deps: WebToolDeps = {}): ToolDefinition {
  const resolveDns = deps.resolveDns ?? defaultResolveDns;
  return {
    name: "web.fetchPage",
    kind: "read",
    minRole: "admin",
    sensitivity: "approval_required",
    dataScope: "none",
    argsSchema: z.object({ url: z.string().min(1) }),
    resultSchema: z.object({
      url: z.string(),
      status: z.number(),
      contentType: z.string(),
      content: z.string(),
    }),
    async execute({ args }) {
      const { url } = args as { url: string };
      const cfg = resolveWebConfig(deps);
      if (!cfg.fetchEnabled) {
        throw toolErrors.unavailable("web.fetchPage unavailable: disabled");
      }
      const fetchImpl = resolveFetchImpl(deps);

      // Validate initial URL (scheme + host + resolved IPs).
      let current = await assertUrlAllowed(url, resolveDns);

      let redirects = 0;
      let resp: any;
      // Manual redirect loop — re-validate each target.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), cfg.fetchTimeoutMs);
        try {
          resp = await fetchImpl(current.toString(), {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            headers: { "User-Agent": "HermesZaloWebFetch/1.0", Accept: "text/html,text/plain" },
          });
        } catch (err: unknown) {
          const msg = err instanceof Error && err.name === "AbortError" ? "fetch timed out" : "fetch failed";
          throw toolErrors.providerError(msg);
        } finally {
          clearTimeout(timer);
        }

        const status: number = resp?.status ?? 0;
        if (status >= 300 && status < 400) {
          const location = resp?.headers?.get?.("location");
          if (!location) break;
          if (redirects >= cfg.fetchMaxRedirects) {
            throw toolErrors.blocked("Too many redirects");
          }
          redirects++;
          const next = new URL(location, current);
          // Re-validate the redirect target (blocks rebinding-via-redirect).
          current = await assertUrlAllowed(next.toString(), resolveDns);
          continue;
        }
        break;
      }

      const status: number = resp?.status ?? 0;
      const contentType = String(resp?.headers?.get?.("content-type") ?? "").slice(0, 100);

      // Bounded body read.
      let raw = "";
      const reader = resp?.body?.getReader?.();
      if (reader) {
        const decoder = new TextDecoder();
        let bytes = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value?.byteLength ?? 0;
          raw += decoder.decode(value, { stream: true });
          if (bytes >= cfg.fetchMaxBytes) {
            try { await reader.cancel(); } catch { /* ignore */ }
            break;
          }
        }
      } else if (typeof resp?.text === "function") {
        raw = String(await resp.text()).slice(0, cfg.fetchMaxBytes);
      }

      const content = extractText(raw, contentType, cfg.fetchMaxContentChars);
      // Return ONLY url/status/contentType/content — never headers/cookies.
      return { result: { url: current.toString(), status, contentType, content } };
    },
  };
}
