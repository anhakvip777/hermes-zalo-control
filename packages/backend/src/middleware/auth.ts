// =============================================================================
// Admin Auth Middleware — basic auth via ADMIN_USERNAME/ADMIN_PASSWORD
// =============================================================================

import type { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";

export async function adminAuth(request: FastifyRequest, reply: FastifyReply) {
  // M1: Only skip auth in explicit dev mode WITH the specific default dev password
  // This prevents accidental auth bypass in production or with misconfigured env
  const isDevBypass =
    config.nodeEnv === "development" &&
    config.security.adminPassword === "dev-admin-password";

  if (isDevBypass) {
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    reply.header("WWW-Authenticate", 'Basic realm="Hermes Admin"');
    return reply.status(401).send({
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
  }

  const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
  const [username, password] = decoded.split(":");

  if (
    username !== config.security.adminUsername ||
    password !== config.security.adminPassword
  ) {
    reply.header("WWW-Authenticate", 'Basic realm="Hermes Admin"');
    return reply.status(401).send({
      error: { code: "UNAUTHORIZED", message: "Invalid credentials" },
    });
  }
}

// H8 helper: return the dev password for tests to use
export function getDevAuthCredentials(): { username: string; password: string } | null {
  if (config.nodeEnv === "development" && config.security.adminPassword === "dev-admin-password") {
    return { username: config.security.adminUsername, password: config.security.adminPassword };
  }
  return null;
}
