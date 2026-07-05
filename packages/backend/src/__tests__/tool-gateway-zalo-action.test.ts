// =============================================================================
// Tool Gateway — ZaloActionRecord / writeZaloAction unit tests (Phase 1, DB-free)
// =============================================================================
// Exercises the evidence writer + payload redaction + action idempotency-key
// derivation. Reaction/poll RUNTIME wiring is Phase 2 — these tests only verify
// the Phase 1 foundation (model shape via in-memory sink, redaction, key derive).
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";

import { InMemoryToolEvidenceSink } from "../services/tool-gateway/evidence.js";
import { redactToJson, REDACTED } from "../services/tool-gateway/redaction.js";
import { deriveZaloActionIdempotencyKey } from "../services/tool-gateway/keys.js";
import type { ZaloActionEvidence } from "../services/tool-gateway/types.js";

describe("Tool Gateway — ZaloActionRecord / writeZaloAction (Phase 1)", () => {
  let sink: InMemoryToolEvidenceSink;

  beforeEach(() => {
    sink = new InMemoryToolEvidenceSink();
  });

  it("writeZaloAction creates a record with the correct shape", async () => {
    const payloadRedacted = redactToJson({ icon: "/-heart" });
    const idempotencyKey = deriveZaloActionIdempotencyKey({
      actionType: "reaction",
      threadId: "thread-1",
      targetMsgId: "msg-9",
      payloadRedacted,
    });

    const record: ZaloActionEvidence = {
      actionType: "reaction",
      threadId: "thread-1",
      threadType: "group",
      principalId: "user-1",
      trigger: "agent_tool",
      targetMsgId: "msg-9",
      payloadRedacted,
      dryRun: true,
      decision: "allow",
      reason: "dry_run",
      executionStatus: "success",
      deliveryStatus: "dry_run",
      idempotencyKey,
      toolCallRecordId: "tcr-42",
    };

    const id = await sink.writeZaloAction(record);
    expect(id).toBeTruthy();
    expect(sink.zaloActions).toHaveLength(1);

    const saved = sink.zaloActions[0]!;
    expect(saved.id).toBe(id);
    expect(saved.actionType).toBe("reaction");
    expect(saved.threadId).toBe("thread-1");
    expect(saved.threadType).toBe("group");
    expect(saved.trigger).toBe("agent_tool");
    expect(saved.targetMsgId).toBe("msg-9");
    expect(saved.payloadRedacted).toBe(payloadRedacted);
    expect(saved.dryRun).toBe(true);
    expect(saved.decision).toBe("allow");
    expect(saved.executionStatus).toBe("success");
    expect(saved.deliveryStatus).toBe("dry_run");
    expect(saved.idempotencyKey).toBe(idempotencyKey);
    expect(saved.toolCallRecordId).toBe("tcr-42");
  });

  it("poll action: payload is redacted before persist (secret keys + phone value)", async () => {
    // Redaction masks secret-NAMED keys + value patterns (JWT/Bearer/long-hex/phone).
    // Secrets belong in keys or match a value pattern — arbitrary free text is not masked.
    const rawPayload = {
      question: "Which time works?",
      options: ["Morning", "Evening"],
      token: "super-secret-token",   // secret key → value dropped
      cookie: "auth=deadbeef",       // secret key → value dropped
      sessionId: "sess-abc-123",     // secret key → value dropped
      contact: "+84 912 345 678",    // value → phone masked
    };
    const payloadRedacted = redactToJson(rawPayload); // non-admin default → phone masked

    const record: ZaloActionEvidence = {
      actionType: "poll",
      threadId: "thread-2",
      threadType: "group",
      trigger: "agent_tool",
      payloadRedacted,
      dryRun: false,
      decision: "allow",
      reason: "live_sent",
      executionStatus: "success",
      deliveryStatus: "live_sent",
      providerResultId: "poll_123",
    };

    await sink.writeZaloAction(record);
    const stored = sink.zaloActions[0]!.payloadRedacted ?? "";

    // No raw secrets/PII persisted.
    expect(stored).not.toContain("super-secret-token");
    expect(stored).not.toContain("sess-abc-123");
    expect(stored).not.toContain("deadbeef");
    expect(stored).not.toContain("912 345 678");
    // sessionId is a secret-named key → fully redacted.
    expect(stored).toContain(REDACTED);
  });

  it("idempotency key derives from actionType + threadId + targetMsgId + payloadRedacted", async () => {
    const payloadRedacted = redactToJson({ icon: "/-heart" });
    const base = { actionType: "reaction", threadId: "t1", targetMsgId: "m1", payloadRedacted };

    const k1 = deriveZaloActionIdempotencyKey(base);
    const k2 = deriveZaloActionIdempotencyKey({ ...base });
    expect(k1).toBe(k2); // deterministic

    // Any component change → different key.
    expect(deriveZaloActionIdempotencyKey({ ...base, targetMsgId: "m2" })).not.toBe(k1);
    expect(deriveZaloActionIdempotencyKey({ ...base, threadId: "t2" })).not.toBe(k1);
    expect(deriveZaloActionIdempotencyKey({ ...base, actionType: "poll" })).not.toBe(k1);
    expect(deriveZaloActionIdempotencyKey({ ...base, payloadRedacted: redactToJson({ icon: "/-like" }) })).not.toBe(k1);

    // Missing targetMsgId is stable (empty-string slot).
    const noTarget = { actionType: "poll", threadId: "t1", payloadRedacted };
    expect(deriveZaloActionIdempotencyKey(noTarget)).toBe(deriveZaloActionIdempotencyKey({ ...noTarget }));
  });

  it("does not persist raw token/cookie/session/phone in a reaction payload", async () => {
    const payloadRedacted = redactToJson({
      icon: "/-heart",
      token: "raw-token-value",
      meta: { cookie: "c=1", note: "+84 912 345 678" },
    });

    await sink.writeZaloAction({
      actionType: "reaction",
      threadId: "t3",
      threadType: "user",
      trigger: "listener",
      targetMsgId: "m5",
      payloadRedacted,
      reason: "auto_react",
      executionStatus: "success",
      deliveryStatus: "live_sent",
    });

    const stored = sink.zaloActions[0]!.payloadRedacted ?? "";
    expect(stored).not.toContain("raw-token-value");
    expect(stored).not.toContain("c=1");
    expect(stored).not.toContain("912 345 678");
  });
});
