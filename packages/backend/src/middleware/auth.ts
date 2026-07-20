// =============================================================================
// Admin Auth Middleware — basic auth via ADMIN_USERNAME/ADMIN_PASSWORD
// =============================================================================

import type { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";

const BASIC_CHALLENGE = 'Basic realm="Hermes Admin", charset="UTF-8"';
const UNAUTHORIZED_MESSAGE = "Authentication required";

function unauthorized(reply: FastifyReply) {
  reply.header("WWW-Authenticate", BASIC_CHALLENGE);
  reply.header("Cache-Control", "no-store");
  reply.header("Vary", "Authorization");
  return reply.status(401).send({
    error: { code: "UNAUTHORIZED", message: UNAUTHORIZED_MESSAGE },
  });
}

/**
 * Decode one Basic credential without throwing or exposing which part failed.
 * The delimiter is intentionally limited to the first colon so passwords may
 * contain colons. Basic credentials are UTF-8 for this application.
 */
function decodeBasicCredentials(value: string): { username: string; password: string } | null {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return null;
  }

  try {
    const bytes = Buffer.from(value, "base64");
    if (bytes.length === 0 || bytes.toString("base64") !== value) {
      return null;
    }

    const decoded = bytes.toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator <= 0) {
      return null;
    }

    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    if (!username || !password || decoded.includes("�")) {
      return null;
    }
    return { username, password };
  } catch {
    return null;
  }
}

export async function adminAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    return unauthorized(reply);
  }

  const match = /^Basic\s+(.+)$/i.exec(authHeader);
  const credentials = match?.[1] ? decodeBasicCredentials(match[1]) : null;
  if (
    !credentials ||
    credentials.username !== config.security.adminUsername ||
    credentials.password !== config.security.adminPassword
  ) {
    return unauthorized(reply);
  }

  reply.header("Cache-Control", "no-store");
  reply.header("Vary", "Authorization");
}
