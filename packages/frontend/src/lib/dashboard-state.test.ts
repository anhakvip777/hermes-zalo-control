import { describe, expect, it } from "vitest";
import { classifyOutboundStatus } from "./dashboard-state";

const base = {
  decision: "allow",
  reason: "sent",
  dryRun: false,
  sentMessageId: "real-message-id",
  errorCode: null,
};

describe("classifyOutboundStatus", () => {
  it("labels dry-run records as DRY RUN even with synthetic sentMessageId", () => {
    expect(classifyOutboundStatus({
      ...base,
      dryRun: true,
      sentMessageId: "dry-run-123",
    })).toBe("DRY RUN");
  });

  it("labels only an allowed non-dry-run record with sentMessageId as SENT", () => {
    expect(classifyOutboundStatus(base)).toBe("SENT");
  });

  it("uses specific safety decisions before generic blocked states", () => {
    expect(classifyOutboundStatus({ ...base, decision: "block", dryRun: true, sentMessageId: null, reason: "prompt_echo_guard: response contains internal marker" })).toBe("PROMPT GUARD");
    expect(classifyOutboundStatus({ ...base, decision: "block", sentMessageId: null, reason: "permission_denied" })).toBe("PERM DENIED");
    expect(classifyOutboundStatus({ ...base, decision: "skip", sentMessageId: null, reason: "cooldown" })).toBe("COOLDOWN");
  });

  it("returns UNKNOWN for contradictory or insufficient live evidence", () => {
    expect(classifyOutboundStatus({ ...base, sentMessageId: null })).toBe("UNKNOWN");
    expect(classifyOutboundStatus({ ...base, decision: "skip" })).toBe("UNKNOWN");
    expect(classifyOutboundStatus({ ...base, decision: "block" })).toBe("UNKNOWN");
    expect(classifyOutboundStatus({ ...base, errorCode: "SEND_FAILED" })).toBe("UNKNOWN");
    expect(classifyOutboundStatus({ ...base, sentMessageId: "dry-run-123" })).toBe("UNKNOWN");
    expect(classifyOutboundStatus({ ...base, dryRun: true, sentMessageId: "real-message-id" })).toBe("UNKNOWN");
  });

  it.each([
    "sent-1720000000000",
    "voice-1720000000000",
    "mock-msg-1720000000000-test",
  ])("does not treat a locally fabricated id as delivery evidence (%s)", (sentMessageId) => {
    expect(classifyOutboundStatus({ ...base, sentMessageId })).toBe("UNKNOWN");
  });

  it("classifies internally consistent skipped, blocked, and failed records", () => {
    expect(classifyOutboundStatus({ ...base, decision: "skip", sentMessageId: null })).toBe("SKIPPED");
    expect(classifyOutboundStatus({ ...base, decision: "block", sentMessageId: null })).toBe("BLOCKED");
    expect(classifyOutboundStatus({ ...base, sentMessageId: null, errorCode: "SEND_FAILED" })).toBe("FAILED");
  });
});
