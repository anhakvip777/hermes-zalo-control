// =============================================================================
// Phase 4A — persistent outbound idempotency (DB-backed)
// =============================================================================
// Proves a given inbound (or identical content) produces at most ONE outbound,
// and that the guard survives restart (in-memory dedup/cooldown cleared) because
// the block comes from the DB unique idempotencyKey. Runs in dry-run (the safe,
// active mode) so no provider/live send occurs.
// =============================================================================

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { cleanDatabase } from "./shared-setup.js";
import { prisma } from "../db.js";
import { sendOutbound } from "../services/outbound-dispatcher.service.js";
import { clearAllCooldowns } from "../services/cooldown.service.js";
import {
  reserveOutboundRecord,
  findOutboundByIdempotencyKey,
  isUniqueViolation,
  resetOutboundDedup,
} from "../services/outbound-guardrails.service.js";

async function resetTransient() {
  await clearAllCooldowns(); // simulate cooldown window elapsed / process restart
  resetOutboundDedup();      // clear in-memory outbound dedup (lost on restart anyway)
}

beforeEach(async () => {
  await cleanDatabase();
  resetOutboundDedup();
});
afterAll(async () => {
  await cleanDatabase();
});

describe("Phase 4A — outbound idempotency (dry-run)", () => {
  it("same inbound processed twice -> one OutboundRecord, second skipped", async () => {
    const intent = {
      threadId: "user:t1", threadType: "user" as const, source: "hermes" as const,
      relatedMessageId: "inb-1", content: "xin chào",
    };
    const r1 = await sendOutbound(intent);
    expect(r1.decision).toBe("allow");
    expect(r1.reason).toBe("dry_run");
    expect(r1.dryRun).toBe(true);

    await resetTransient(); // so the 2nd call is NOT blocked by cooldown — must hit idempotency

    const r2 = await sendOutbound(intent);
    expect(r2.decision).toBe("skip");
    expect(r2.reason).toBe("duplicate_idempotency");

    const key = "reply:inb-1:user:t1:user";
    const count = await prisma.outboundRecord.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
  });

  it("restart simulation: DB idempotencyKey still blocks after in-memory state cleared", async () => {
    const intent = {
      threadId: "user:t2", threadType: "user" as const, source: "hermes" as const,
      relatedMessageId: "inb-2", content: "hello",
    };
    await sendOutbound(intent);
    await resetTransient(); // <- "restart": cooldown + in-memory dedup gone
    const r2 = await sendOutbound(intent);
    expect(r2.reason).toBe("duplicate_idempotency");
    const total = await prisma.outboundRecord.count({ where: { threadId: "user:t2" } });
    expect(total).toBe(1);
  });

  it("user vs group with same id -> different keys, both send (no collision)", async () => {
    const base = { threadId: "77", source: "hermes" as const, content: "x", relatedMessageId: "inb-77" };
    const ru = await sendOutbound({ ...base, threadType: "user" });
    await resetTransient();
    const rg = await sendOutbound({ ...base, threadType: "group" });
    expect(ru.reason).toBe("dry_run");
    expect(rg.reason).toBe("dry_run");
    expect(await findOutboundByIdempotencyKey("reply:inb-77:77:user")).not.toBeNull();
    expect(await findOutboundByIdempotencyKey("reply:inb-77:77:group")).not.toBeNull();
  });

  it("fallback content-hash key: identical content (no inbound id) de-duped; different content sends", async () => {
    const mk = (content: string) => ({
      threadId: "user:t3", threadType: "user" as const, source: "hermes" as const, content,
    });
    const a1 = await sendOutbound(mk("cùng nội dung"));
    expect(a1.reason).toBe("dry_run");
    await resetTransient();
    const a2 = await sendOutbound(mk("cùng nội dung"));
    expect(a2.reason).toBe("duplicate_idempotency");
    await resetTransient();
    const b1 = await sendOutbound(mk("nội dung khác"));
    expect(b1.reason).toBe("dry_run"); // different content -> different key -> allowed
  });

  it("pre-existing reserved (e.g. failed live send) blocks accidental retry", async () => {
    // Simulate a prior send that reserved the key (decision=allow) but is not a block/skip.
    await reserveOutboundRecord({
      idempotencyKey: "reply:inb-9:user:t9:user",
      inboundMessageId: "inb-9",
      threadId: "user:t9", threadType: "user",
      content: "prev", source: "auto_reply", dryRun: false,
    });
    const r = await sendOutbound({
      threadId: "user:t9", threadType: "user", source: "hermes",
      relatedMessageId: "inb-9", content: "retry attempt",
    });
    expect(r.decision).toBe("skip");
    expect(r.reason).toBe("duplicate_idempotency");
    // Still exactly one record for this key (no second create).
    const count = await prisma.outboundRecord.count({ where: { idempotencyKey: "reply:inb-9:user:t9:user" } });
    expect(count).toBe(1);
  });

  it("concurrent reservation with the same key -> unique violation (P2002) is detectable", async () => {
    const key = "reply:inb-conc:user:tc:user";
    await reserveOutboundRecord({
      idempotencyKey: key, inboundMessageId: "inb-conc",
      threadId: "user:tc", threadType: "user", content: "a", source: "auto_reply", dryRun: true,
    });
    let threw: unknown = null;
    try {
      await reserveOutboundRecord({
        idempotencyKey: key, inboundMessageId: "inb-conc",
        threadId: "user:tc", threadType: "user", content: "b", source: "auto_reply", dryRun: true,
      });
    } catch (e) {
      threw = e;
    }
    expect(threw).not.toBeNull();
    expect(isUniqueViolation(threw)).toBe(true);
  });
});
