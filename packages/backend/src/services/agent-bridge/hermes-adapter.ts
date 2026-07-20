// =============================================================================
// HermesAdapter — structured HTTP implementation of the neutral AgentAdapter
// =============================================================================
// NEVER imports zca-js / calls getApi / sendMessage.
// =============================================================================

import { config } from "../../config.js";
import type { AgentToolResult } from "../tool-gateway/types.js";
import type { AgentAdapter, AgentRequest } from "./types.js";

export interface HermesAdapterOptions {
  endpoint?: string;
  protocolVersion?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_PROTOCOL_VERSION = "2026-07-ARCH1";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const HARD_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

class HermesAdapterError extends Error {}

function clampFiniteInteger(value: number | undefined, fallback: number, maximum: number): number {
  const candidate = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.min(maximum, Math.max(1, candidate));
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Preserve the stable adapter error for the early-rejection path.
  }
}

async function readBoundedUtf8(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await cancelResponseBody(response);
      throw new HermesAdapterError("HERMES_RESPONSE_TOO_LARGE");
    }
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the stable oversized-response error.
      }
      throw new HermesAdapterError("HERMES_RESPONSE_TOO_LARGE");
    }
    text += decoder.decode(value, { stream: true });
  }
}

export class HermesAdapter implements AgentAdapter {
  readonly name = "hermes";

  private readonly endpoint: string;
  private readonly protocolVersion: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HermesAdapterOptions = {}) {
    const cfg = config.hermesAgentBridge as typeof config.hermesAgentBridge & {
      maxResponseBytes?: number;
    };
    this.endpoint = (options.endpoint ?? cfg.endpoint).trim();
    this.protocolVersion = (options.protocolVersion ?? cfg.protocolVersion).trim() || DEFAULT_PROTOCOL_VERSION;
    this.timeoutMs = clampFiniteInteger(options.timeoutMs ?? cfg.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    this.maxResponseBytes = clampFiniteInteger(
      options.maxResponseBytes ?? cfg.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      HARD_MAX_RESPONSE_BYTES,
    );
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async run(request: AgentRequest, priorToolResults: AgentToolResult[]): Promise<unknown> {
    if (!this.endpoint) throw new HermesAdapterError("HERMES_ENDPOINT_MISSING");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocolVersion: this.protocolVersion, request, priorToolResults }),
        signal: controller.signal,
      });

      if (!response.ok) {
        await cancelResponseBody(response);
        throw new HermesAdapterError(`HERMES_HTTP_ERROR:${response.status}`);
      }

      const body = await readBoundedUtf8(response, this.maxResponseBytes);
      try {
        return JSON.parse(body) as unknown;
      } catch {
        throw new HermesAdapterError("HERMES_INVALID_JSON");
      }
    } catch (error: unknown) {
      if (error instanceof HermesAdapterError) throw error;
      if (controller.signal.aborted || isAbortError(error)) {
        throw new HermesAdapterError("HERMES_TIMEOUT");
      }
      throw new HermesAdapterError("HERMES_TRANSPORT_ERROR");
    } finally {
      clearTimeout(timeout);
    }
  }
}
