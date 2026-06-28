// =============================================================================
// Simple in-memory rate limit middleware for API routes
// =============================================================================

import type { FastifyRequest, FastifyReply } from "fastify";

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_WINDOWS = 10000;

export function createRateLimiter(maxPerMinute: number) {
  return async function rateLimitMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const key = request.ip || "unknown";
    const now = Date.now();

    let w = windows.get(key);
    if (!w || now > w.resetAt) {
      w = { count: 1, resetAt: now + 60_000 };
      windows.set(key, w);
    } else if (w.count >= maxPerMinute) {
      return reply.status(429).send({
        error: {
          code: "RATE_LIMITED",
          message: `Too many requests. Max ${maxPerMinute} per minute.`,
        },
      });
    } else {
      w.count++;
    }

    // Prune old entries
    if (windows.size > MAX_WINDOWS) {
      for (const [k, v] of windows) {
        if (now > v.resetAt) windows.delete(k);
      }
    }
  };
}

// Pre-defined limiters
export const apiRateLimit = createRateLimiter(120); // General API: 120 req/min
export const strictRateLimit = createRateLimiter(20); // Sensitive: 20 req/min
export const agentRateLimit = createRateLimiter(60); // Agent tools: 60 req/min
