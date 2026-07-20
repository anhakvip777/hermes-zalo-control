import { afterEach, describe, expect, it, vi } from "vitest";
import { adminCredentials, encodeBasicAuthorization } from "./admin-auth";
import { apiFetch } from "./api";

afterEach(() => {
  vi.useRealTimers();
  adminCredentials.clear();
  vi.unstubAllGlobals();
});

describe("admin credential transport", () => {
  it("encodes Unicode and colon-containing passwords as UTF-8 Basic auth", () => {
    const authorization = encodeBasicAuthorization("quản-trị", "mật:khẩu");
    expect(authorization.startsWith("Basic ")).toBe(true);
    const encoded = authorization.slice("Basic ".length);
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe("quản-trị:mật:khẩu");
  });

  it("does not let a stale 401 clear newer credentials", async () => {
    adminCredentials.set("admin", "old-password");
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    const staleRequest = apiFetch("/api/test");
    adminCredentials.set("admin", "new-password");
    const currentAuthorization = adminCredentials.getAuthorization();
    resolveFetch(
      new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(staleRequest).rejects.toMatchObject({ code: "STALE_RESPONSE" });
    expect(adminCredentials.getAuthorization()).toBe(currentAuthorization);
  });

  it("does not invalidate stored credentials when an explicit Authorization header receives 401", async () => {
    adminCredentials.set("admin", "current-password");
    const currentAuthorization = adminCredentials.getAuthorization();
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Basic external-credential");
      return new Response(
        JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch("/api/test", {
        headers: { Authorization: "Basic external-credential" },
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(adminCredentials.getAuthorization()).toBe(currentAuthorization);
  });

  it("clears current stored credentials on a store-authenticated 401", async () => {
    adminCredentials.set("admin", "current-password");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorized", { status: 401 })),
    );

    await expect(apiFetch("/api/test")).rejects.toMatchObject({ status: 401 });
    expect(adminCredentials.getAuthorization()).toBeNull();
  });

  it("preserves credentials on 401 when skipAuthInvalidation is true", async () => {
    adminCredentials.set("admin", "current-password");
    const currentAuthorization = adminCredentials.getAuthorization();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorized", { status: 401 })),
    );

    await expect(apiFetch("/api/test", { skipAuthInvalidation: true })).rejects.toMatchObject({
      status: 401,
    });
    expect(adminCredentials.getAuthorization()).toBe(currentAuthorization);
  });

  it.each([401, 403, 500])("discards stale %s responses before status handling", async (status) => {
    adminCredentials.set("admin", "old-password");
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    const staleRequest = apiFetch("/api/test");
    adminCredentials.set("admin", "new-password");
    resolveFetch(
      new Response(JSON.stringify({ error: { code: "OLD_ERROR", message: "Old response" } }), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(staleRequest).rejects.toMatchObject({ code: "STALE_RESPONSE" });
  });

  it("rejects a pre-aborted signal without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(apiFetch("/api/test", { signal: controller.signal })).rejects.toMatchObject({
      code: "REQUEST_ABORTED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns REQUEST_TIMEOUT when the internal 15-second timer aborts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_path: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = apiFetch("/api/test");
    const outcome = request.then(
      () => null,
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(outcome).resolves.toMatchObject({ code: "REQUEST_TIMEOUT" });
  });

  it("keeps caller abort classification when the fetch settles after the timeout window", async () => {
    vi.useFakeTimers();
    let rejectFetch!: (error: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            rejectFetch = reject;
          }),
      ),
    );
    const caller = new AbortController();

    const request = apiFetch("/api/test", { signal: caller.signal });
    caller.abort();
    await vi.advanceTimersByTimeAsync(15_000);
    rejectFetch(new DOMException("Aborted", "AbortError"));

    await expect(request).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
  });

  it("discards a response when credentials change while response body is pending", async () => {
    adminCredentials.set("admin", "old-password");
    let releaseBody!: (body: string) => void;
    let textStarted!: () => void;
    const body = new Promise<string>((resolve) => {
      releaseBody = resolve;
    });
    const bodyStarted = new Promise<void>((resolve) => {
      textStarted = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            status: 401,
            ok: false,
            statusText: "Unauthorized",
            headers: new Headers({ "content-type": "application/json" }),
            text: () => {
              textStarted();
              return body;
            },
          }) as Response,
      ),
    );

    const request = apiFetch("/api/test");
    await bodyStarted;
    adminCredentials.set("admin", "new-password");
    releaseBody(JSON.stringify({ error: { code: "OLD", message: "Old response" } }));

    await expect(request).rejects.toMatchObject({ code: "STALE_RESPONSE" });
  });

  it("rejects absolute and protocol-relative API paths before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("https://example.com/api/test")).rejects.toMatchObject({
      code: "INVALID_API_PATH",
    });
    await expect(apiFetch("//example.com/api/test")).rejects.toMatchObject({
      code: "INVALID_API_PATH",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
