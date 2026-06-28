// =============================================================================
// Rule Routes — admin-only CRUD + simulator
// =============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as ruleEngine from "../services/rule-engine.service.js";

export async function ruleRoutes(app: FastifyInstance) {
  // ── GET /api/rules — list all rules ──────────────────────────────
  app.get("/rules", async (_req: FastifyRequest, reply: FastifyReply) => {
    const rules = await ruleEngine.listRules();
    return reply.send({ data: rules, total: rules.length });
  });

  // ── GET /api/rules/:id — get single rule ─────────────────────────
  app.get("/rules/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const rule = await ruleEngine.getRule(req.params.id);
    if (!rule) {
      return reply.status(404).send({ error: "RULE_NOT_FOUND", message: "Rule not found" });
    }
    return reply.send({ data: rule });
  });

  // ── POST /api/rules — create rule ────────────────────────────────
  app.post("/rules", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown>;
    try {
      const result = await ruleEngine.createRule({
        name: body.name as string,
        description: body.description as string | undefined,
        enabled: body.enabled as boolean | undefined,
        priority: body.priority as number | undefined,
        triggerType: body.triggerType as string,
        conditions: (body.conditions ?? {}) as Record<string, unknown>,
        actionType: body.actionType as string,
        actionConfig: (body.actionConfig ?? {}) as Record<string, unknown>,
        targetThreadIds: body.targetThreadIds as string[] | undefined,
        cooldownSeconds: body.cooldownSeconds as number | undefined,
        createdBy: (body.createdBy as string) ?? "admin",
        changeReason: body.changeReason as string | undefined,
      });
      return reply.status(201).send({ data: result.rule, version: result.version });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: "VALIDATION_ERROR", message });
    }
  });

  // ── PATCH /api/rules/:id — update rule ───────────────────────────
  app.patch("/rules/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown>;
    try {
      const result = await ruleEngine.updateRule(req.params.id, {
        name: body.name as string | undefined,
        description: body.description as string | undefined,
        enabled: body.enabled as boolean | undefined,
        priority: body.priority as number | undefined,
        triggerType: body.triggerType as string | undefined,
        conditions: body.conditions as Record<string, unknown> | undefined,
        actionType: body.actionType as string | undefined,
        actionConfig: body.actionConfig as Record<string, unknown> | undefined,
        targetThreadIds: body.targetThreadIds as string[] | undefined,
        cooldownSeconds: body.cooldownSeconds as number | undefined,
        updatedBy: (body.updatedBy as string) ?? "admin",
        changeReason: body.changeReason as string | undefined,
      });
      return reply.send({ data: result.rule, version: result.version });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === "Rule not found" ? 404 : 400;
      return reply.status(status).send({ error: status === 404 ? "RULE_NOT_FOUND" : "VALIDATION_ERROR", message });
    }
  });

  // ── POST /api/rules/:id/enable — enable rule ─────────────────────
  app.post("/rules/:id/enable", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const rule = await ruleEngine.enableRule(req.params.id);
      return reply.send({ data: rule });
    } catch {
      return reply.status(404).send({ error: "RULE_NOT_FOUND", message: "Rule not found" });
    }
  });

  // ── POST /api/rules/:id/disable — disable rule ───────────────────
  app.post("/rules/:id/disable", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const rule = await ruleEngine.disableRule(req.params.id);
      return reply.send({ data: rule });
    } catch {
      return reply.status(404).send({ error: "RULE_NOT_FOUND", message: "Rule not found" });
    }
  });

  // ── GET /api/rules/:id/versions — version history ────────────────
  app.get("/rules/:id/versions", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const versions = await ruleEngine.getRuleVersions(req.params.id);
    return reply.send({ data: versions });
  });

  // ── GET /api/rules/:id/executions — execution history ────────────
  app.get("/rules/:id/executions", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const query = req.query as { limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const executions = await ruleEngine.getRuleExecutions(req.params.id, limit);
    return reply.send({ data: executions, total: executions.length });
  });

  // ── POST /api/rules/test — simulator (bulk test) ─────────────────
  app.post("/rules/test", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown>;
    try {
      const result = await ruleEngine.simulateRule({
        threadId: body.threadId as string | undefined,
        threadType: body.threadType as string | undefined,
        senderId: body.senderId as string | undefined,
        messageType: body.messageType as string | undefined,
        content: body.content as string,
      });
      return reply.send({ data: result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: "SIMULATOR_ERROR", message });
    }
  });

  // ── POST /api/rules/:id/test — test specific rule ────────────────
  app.post("/rules/:id/test", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown>;
    const rule = await ruleEngine.getRule(req.params.id);
    if (!rule) {
      return reply.status(404).send({ error: "RULE_NOT_FOUND", message: "Rule not found" });
    }
    try {
      const result = await ruleEngine.simulateRule({
        threadId: body.threadId as string | undefined,
        threadType: body.threadType as string | undefined,
        senderId: body.senderId as string | undefined,
        messageType: body.messageType as string | undefined,
        content: body.content as string,
      });
      return reply.send({ data: result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: "SIMULATOR_ERROR", message });
    }
  });
}
