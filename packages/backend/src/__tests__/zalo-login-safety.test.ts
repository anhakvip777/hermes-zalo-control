import { describe, expect, it, vi } from "vitest";
import {
  evaluateZaloLoginSafety,
  evaluateZaloLoginScriptSafety,
} from "../services/zalo-login-safety.service.js";

describe("ZaloLoginSafetyGate", () => {
  it.each([
    [
      { staticDryRun: true, effectiveDryRun: true },
      { allowed: false, reason: "STATIC_DRY_RUN_ENABLED" },
    ],
    [
      { staticDryRun: true, effectiveDryRun: false },
      { allowed: false, reason: "STATIC_DRY_RUN_ENABLED" },
    ],
    [
      { staticDryRun: false, effectiveDryRun: true },
      { allowed: true, reason: null },
    ],
    [
      { staticDryRun: false, effectiveDryRun: false },
      { allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" },
    ],
  ] as const)("evaluates static/effective dry-run policy %#", (input, expected) => {
    expect(evaluateZaloLoginSafety(input)).toEqual(expected);
  });

  it.each([
    undefined,
    null,
    "true",
    1,
  ])("fails closed when a script cannot determine effective outbound dry-run (%s)", (effectiveDryRun) => {
    expect(evaluateZaloLoginScriptSafety({
      staticDryRun: false,
      getEffectiveDryRun: () => effectiveDryRun,
    })).toEqual({
      allowed: false,
      reason: "OUTBOUND_DRY_RUN_REQUIRED",
    });
  });

  it("fails closed when the effective outbound dry-run resolver throws", () => {
    expect(evaluateZaloLoginScriptSafety({
      staticDryRun: false,
      getEffectiveDryRun: () => {
        throw new Error("runtime config unavailable");
      },
    })).toEqual({
      allowed: false,
      reason: "OUTBOUND_DRY_RUN_REQUIRED",
    });
  });

  it("uses the shared truth table when a script resolves a boolean effective dry-run", () => {
    expect(evaluateZaloLoginScriptSafety({
      staticDryRun: false,
      getEffectiveDryRun: () => true,
    })).toEqual({ allowed: true, reason: null });
    expect(evaluateZaloLoginScriptSafety({
      staticDryRun: true,
      getEffectiveDryRun: () => true,
    })).toEqual({ allowed: false, reason: "STATIC_DRY_RUN_ENABLED" });
  });

  it("prioritizes static dry-run when the effective resolver throws", () => {
    const getEffectiveDryRun = vi.fn(() => {
      throw new Error("runtime config unavailable");
    });

    expect(evaluateZaloLoginScriptSafety({
      staticDryRun: true,
      getEffectiveDryRun,
    })).toEqual({ allowed: false, reason: "STATIC_DRY_RUN_ENABLED" });
    expect(getEffectiveDryRun).not.toHaveBeenCalled();
  });

  it("prioritizes static dry-run when the effective resolver is non-boolean", () => {
    const getEffectiveDryRun = vi.fn(() => "true");

    expect(evaluateZaloLoginScriptSafety({
      staticDryRun: true,
      getEffectiveDryRun,
    })).toEqual({ allowed: false, reason: "STATIC_DRY_RUN_ENABLED" });
    expect(getEffectiveDryRun).not.toHaveBeenCalled();
  });
});
