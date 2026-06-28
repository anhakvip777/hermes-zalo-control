import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { config } from "../config.js";

export function errorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  // Zod validation errors
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request data",
        details: error.issues,
      },
    });
  }

  // Fastify validation errors
  if ("validation" in error) {
    return reply.status(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: error.message,
      },
    });
  }

  // Default error
  const statusCode = "statusCode" in error ? (error.statusCode ?? 500) : 500;

  return reply.status(statusCode).send({
    error: {
      code: error.name.toUpperCase().replace(/\s/g, "_"),
      message: config.isDev ? error.message : "Internal server error",
    },
  });
}
