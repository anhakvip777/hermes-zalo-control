"use client";

import { adminCredentials } from "./admin-auth";

export interface ApiRequestInit extends RequestInit {
  /** Used by login probes so an expected 401 does not invalidate current auth. */
  skipAuthInvalidation?: boolean;
}

export interface ApiErrorBody {
  error?:
    | {
        code?: unknown;
        message?: unknown;
        details?: unknown;
      }
    | unknown;
  message?: unknown;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function parseErrorBody(body: ApiErrorBody, fallback: string) {
  const nested =
    body.error && typeof body.error === "object" ? (body.error as Record<string, unknown>) : null;
  const code =
    typeof nested?.code === "string"
      ? nested.code
      : typeof body.error === "string"
        ? body.error
        : undefined;
  const message =
    typeof nested?.message === "string"
      ? nested.message
      : typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : fallback;
  return {
    code,
    message,
    details: nested?.details,
  };
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

type AbortCause = "caller" | "timeout";

function abortError(cause: AbortCause | null): ApiError {
  return cause === "timeout"
    ? new ApiError(0, "Request timed out", undefined, "REQUEST_TIMEOUT")
    : new ApiError(0, "Request timed out or was aborted", undefined, "REQUEST_ABORTED");
}

export async function apiFetch<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  if (!path.startsWith("/api/") || path.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(path)) {
    throw new ApiError(0, "API path must be a relative /api/ URL", undefined, "INVALID_API_PATH");
  }

  const {
    skipAuthInvalidation = false,
    signal: callerSignal,
    headers: inputHeaders,
    ...requestInit
  } = init;
  const headers = new Headers(inputHeaders);
  const callerSuppliedAuthorization = headers.has("Authorization");
  const authorization = adminCredentials.getAuthorization();
  const storeOwnsAuthorization = !callerSuppliedAuthorization && authorization !== null;
  if (authorization && !callerSuppliedAuthorization) {
    headers.set("Authorization", authorization);
  }
  if (
    !(requestInit.body instanceof FormData) &&
    requestInit.body !== undefined &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  let abortCause: AbortCause | null = null;
  const abort = (cause: AbortCause) => {
    if (abortCause === null) abortCause = cause;
    controller.abort();
  };
  const timeout = setTimeout(() => {
    abort("timeout");
  }, 15_000);
  const generation = adminCredentials.generation();
  const abortCaller = () => abort("caller");
  callerSignal?.addEventListener("abort", abortCaller, { once: true });
  if (callerSignal?.aborted) abortCaller();

  try {
    if (controller.signal.aborted) {
      throw abortError(abortCause);
    }
    const response = await fetch(path, {
      ...requestInit,
      headers,
      signal: controller.signal,
    });
    const body = await readResponseBody(response);

    if (controller.signal.aborted) {
      throw abortError(abortCause);
    }
    if (generation !== adminCredentials.generation()) {
      throw new ApiError(
        0,
        "Response discarded after authentication changed",
        undefined,
        "STALE_RESPONSE",
      );
    }
    if (response.status === 401 && !skipAuthInvalidation && storeOwnsAuthorization) {
      adminCredentials.clear(generation);
    }
    if (!response.ok) {
      const parsed =
        body && typeof body === "object"
          ? parseErrorBody(body as ApiErrorBody, response.statusText)
          : {
              code: undefined,
              message: typeof body === "string" && body ? body : response.statusText,
              details: undefined,
            };
      throw new ApiError(response.status, parsed.message, body, parsed.code, parsed.details);
    }

    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      throw abortError(abortCause);
    }
    throw new ApiError(0, "Network request failed", undefined, "NETWORK_ERROR");
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortCaller);
  }
}
