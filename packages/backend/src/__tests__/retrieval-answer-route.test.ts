// =============================================================================
// Phase 3.5C — POST /api/agent/tools/retrieval-answer (admin/test route)
// =============================================================================
// First fastify.inject() route-level test. A minimal app registers agentRoutes
// behind the real adminAuth; config is passthrough-mocked to set known admin
// creds + NODE_ENV=test (so the dev-bypass never triggers). The route delegates
// to answerRetrieval() — read-only, no send/provider/bridge/live.
// =============================================================================

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// Passthrough mock: keep the real config, override only creds + nodeEnv.
vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    config: {
      ...actual.config,
      nodeEnv: "test",
      security: { ...actual.config.security, adminUsername: "admin", adminPassword: "test-admin-pw" },
    },
  };
});

import Fastify, { type FastifyInstance } from "fastify";
import { agentRoutes } from "../routes/agent.js";
import { adminAuth } from "../middleware/auth.js";
import { cleanDatabase } from "./shared-setup.js";
import { prisma } from "../db.js";

const ROUTE = "/api/agent/tools/retrieval-answer";
const AUTH = "Basic " + Buffer.from("admin:test-admin-pw").toString("base64");

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(async (scope) => {
    scope.addHook("preHandler", adminAuth);
    await scope.register(agentRoutes as never, { prefix: "/api" });
  });
  await app.ready();
  return app;
}

/** Seed an image + successful OCR extraction in group A via the real 3.5A pipeline. */
async function seedMenu(extractedText = "Menu cửa hàng B: cơm gà 45k, bún bò 50k") {
  const { saveInboundAttachment, updateExtractionByZaloMessageId } = await import(
    "../services/attachment.service.js"
  );
  await prisma.message.create({
    data: {
      id: "mm-1", zaloMessageId: "zz-1", threadId: "group-A", threadType: "group",
      content: "[Ảnh Zalo]", isFromBot: false, messageType: "image", receivedAt: new Date(),
    },
  });
  await saveInboundAttachment({
    messageId: "mm-1", zaloMessageId: "zz-1", threadId: "group-A", threadType: "group",
    senderId: "u1", kind: "image",
  });
  await updateExtractionByZaloMessageId("zz-1", "image", { extractedText, status: "success" });
}

let app: FastifyInstance;

describe("POST /api/agent/tools/retrieval-answer", () => {
  beforeEach(async () => {
    await cleanDatabase();
    if (!app) app = await buildTestApp();
  });
  afterAll(async () => {
    await cleanDatabase();
    if (app) await app.close();
  });

  const menuBody = { query: "cửa hàng B", requesterThreadId: "group-A", requesterThreadType: "group" };

  it("rejects requests with no auth header → 401", async () => {
    const res = await app.inject({ method: "POST", url: ROUTE, payload: menuBody });
    expect(res.statusCode).toBe(401);
  });

  it("rejects invalid credentials → 401", async () => {
    const res = await app.inject({
      method: "POST", url: ROUTE, payload: menuBody,
      headers: { authorization: "Basic " + Buffer.from("admin:wrong").toString("base64") },
    });
    expect(res.statusCode).toBe(401);
  });

  it("auth + menu case → 200 found, evidence has attachmentId", async () => {
    await seedMenu();
    const res = await app.inject({
      method: "POST", url: ROUTE, payload: menuBody, headers: { authorization: AUTH },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.status).toBe("found");
    expect(json.answerText).toContain("cửa hàng B");
    expect(json.evidence[0].attachmentId).toBeTruthy();
    expect(json.evidence[0].source).toBe("attachment");
  });

  it("auth + role basic_chat + target other thread → permission_denied", async () => {
    await seedMenu();
    const res = await app.inject({
      method: "POST", url: ROUTE, headers: { authorization: AUTH },
      payload: {
        query: "cửa hàng B",
        requesterThreadId: "group-A", requesterThreadType: "group",
        targetThreadId: "group-B", targetThreadType: "group",
        role: "basic_chat",
      },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.status).toBe("permission_denied");
    expect(json.evidence).toEqual([]);
  });

  it("secret in OCR → response redacted, no raw sk/password/JWT", async () => {
    const secret = "sk-proj-Ab3dEf6GhiJkLmNoPqRs012345_-6789 password=hunter2secretpw eyJhbGciOi.eyJzdWIiOj.SflKxwRJSMk";
    // Keep the query keyword in the OCR text so it matches, plus the secret to redact.
    await seedMenu(`Menu cửa hàng B: cơm gà 45k ${secret}`);
    const res = await app.inject({
      method: "POST", url: ROUTE, payload: menuBody, headers: { authorization: AUTH },
    });
    expect(res.statusCode).toBe(200);
    const body = res.payload; // full raw JSON string
    expect(body).not.toContain("sk-proj-Ab3dEf6GhiJkLmNoPqRs012345_-6789");
    expect(body).not.toContain("hunter2secretpw");
    expect(body).not.toContain("eyJhbGciOi.eyJzdWIiOj.SflKxwRJSMk");
    expect(body).toContain("[REDACTED]");
  });

  it("is read-only: no OutboundRecord is created by a retrieval call", async () => {
    await seedMenu();
    const res = await app.inject({
      method: "POST", url: ROUTE, payload: menuBody, headers: { authorization: AUTH },
    });
    expect(res.statusCode).toBe(200);
    // A send path would have written an OutboundRecord; a pure read must not.
    const outboundCount = await prisma.outboundRecord.count();
    expect(outboundCount).toBe(0);
  });
});
