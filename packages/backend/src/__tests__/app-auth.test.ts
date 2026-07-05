// =============================================================================
// App route-auth regression test
// =============================================================================
// Locks in the fix for the Fastify auth gap: passing `preHandler` via
// `app.register(routes, { preHandler })` options is SILENTLY IGNORED — hooks
// must be added inside the plugin's encapsulated scope. We exercise the REAL
// exported `registerProtected()` helper + the REAL `adminAuth` middleware.
//
// DB-free: does NOT call buildApp() (which touches the DB) and never connects
// to Zalo/session. Auth env is set BEFORE importing config-bound modules so the
// admin password is deterministic. The password below is a throwaway TEST value,
// not a real secret.
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";

// Deterministic auth env — must be set before any config-bound dynamic import.
// NODE_ENV=test disables the dev auth-bypass (which only triggers on
// development + the "dev-admin-password" value), so auth is fully enforced.
const TEST_USER = "admin";
const TEST_PASS = "regression-test-pass-xyz"; // throwaway test fixture, not a secret
process.env.NODE_ENV = "test";
process.env.ADMIN_USERNAME = TEST_USER;
process.env.ADMIN_PASSWORD = TEST_PASS;

function basic(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

let app: FastifyInstance;

beforeAll(async () => {
  const Fastify = (await import("fastify")).default;
  // Real helper + real rate limiter from the app under test.
  const { registerProtected } = await import("../app.js");
  const { strictRateLimit } = await import("../middleware/rate-limit.js");

  app = Fastify({ logger: false });

  // Public route (no auth) — mirrors /api/health.
  app.get("/api/health", async () => ({ status: "ok" }));

  // Protected route mounted through the REAL helper (adminAuth applied inside scope).
  await registerProtected(
    app,
    async (scope) => {
      scope.get("/protected", async () => ({ ok: true }));
    },
    strictRateLimit,
  );

  await app.ready();
});

describe("app route auth wiring (registerProtected + adminAuth)", () => {
  it("public route is reachable without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
  });

  it("protected route rejects missing auth with 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/protected" });
    expect(res.statusCode).toBe(401);
  });

  it("protected route rejects wrong password with 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/protected",
      headers: { authorization: basic(TEST_USER, "wrong-password") },
    });
    expect(res.statusCode).toBe(401);
  });

  it("protected route rejects wrong username with 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/protected",
      headers: { authorization: basic("not-admin", TEST_PASS) },
    });
    expect(res.statusCode).toBe(401);
  });

  it("protected route allows correct admin credentials with 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/protected",
      headers: { authorization: basic(TEST_USER, TEST_PASS) },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});
