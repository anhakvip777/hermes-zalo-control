export type ZaloLoginSafetyReason =
  | "STATIC_DRY_RUN_ENABLED"
  | "OUTBOUND_DRY_RUN_REQUIRED";

export type ZaloLoginSafetyDecision =
  | { allowed: true; reason: null }
  | { allowed: false; reason: ZaloLoginSafetyReason };

export function evaluateZaloLoginSafety(input: {
  staticDryRun: boolean;
  effectiveDryRun: boolean;
}): ZaloLoginSafetyDecision {
  if (input.staticDryRun) {
    return { allowed: false, reason: "STATIC_DRY_RUN_ENABLED" };
  }
  if (!input.effectiveDryRun) {
    return { allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" };
  }
  return { allowed: true, reason: null };
}

/**
 * Manual login entrypoints do not own runtime configuration initialization.
 * Static dry-run always wins. Otherwise, treat any thrown or non-boolean
 * effective value as unsafe, then delegate valid values to the shared truth table.
 */
export function evaluateZaloLoginScriptSafety(input: {
  staticDryRun: boolean;
  getEffectiveDryRun: () => unknown;
}): ZaloLoginSafetyDecision {
  if (input.staticDryRun) {
    return { allowed: false, reason: "STATIC_DRY_RUN_ENABLED" };
  }

  try {
    const effectiveDryRun = input.getEffectiveDryRun();
    if (typeof effectiveDryRun !== "boolean") {
      return { allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" };
    }
    return evaluateZaloLoginSafety({
      staticDryRun: input.staticDryRun,
      effectiveDryRun,
    });
  } catch {
    return { allowed: false, reason: "OUTBOUND_DRY_RUN_REQUIRED" };
  }
}
