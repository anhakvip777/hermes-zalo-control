import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { config } from "../config.js";
import { sendApiError } from "../http/api-error.js";

export function errorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  // Zod validation errors
  if (error instanceof ZodError) {
    return sendApiError(reply, 400, "VALIDATION_ERROR", "Invalid request data", error.issues);
  }

  // Fastify validation errors
  if ("validation" in error) {
    return sendApiError(reply, 400, "VALIDATION_ERROR", error.message);
  }

  // Default error
  const statusCode = "statusCode" in error ? (error.statusCode ?? 500) : 500;
  const code = error.name.toUpperCase().replace(/\s/g, "_");
  const message = config.isDev ? error.message : "Internal server error";

  return sendApiError(reply, statusCode, code, message);
}
