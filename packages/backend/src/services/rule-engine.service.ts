// =============================================================================
// Rule Engine Service — rule CRUD, evaluation, versioning, execution tracking
// =============================================================================

import { prisma } from "../db.js";
import { getCurrentEffectiveDryRun } from "./runtime-config.service.js";

// ── Types ──────────────────────────────────────────────────────────

export interface RuleInput {
  name: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  triggerType: string;
  conditions: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  targetThreadIds?: string[];
  cooldownSeconds?: number;
  createdBy?: string;
  updatedBy?: string;
  changeReason?: string;
}

export interface RuleOutput {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  triggerType: string;
  conditions: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  targetThreadIds: string[] | null;
  cooldownSeconds: number | null;
  matchCount: number;
  lastMatchedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuleVersionOutput {
  id: string;
  ruleId: string;
  version: number;
  snapshot: Record<string, unknown>;
  changedBy: string | null;
  changeReason: string | null;
  createdAt: string;
}

export interface RuleExecutionOutput {
  id: string;
  ruleId: string | null;
  messageId: string | null;
  threadId: string | null;
  matched: boolean;
  actionTaken: string | null;
  result: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface MessageContext {
  threadId: string;
  threadType: string;
  senderId?: string;
  content: string;
  messageType: string;
  messageId?: string;
}

export interface EvaluateResult {
  matched: boolean;
  matchedRules: Array<{
    rule: RuleOutput;
    matchDetails: string;
  }>;
  winningRule: RuleOutput | null;
  action: {
    type: string | null;
    preview: string | null;
  };
  wouldSend: boolean;
  reason: string;
}

export interface SimulatorInput {
  threadId?: string;
  threadType?: string;
  senderId?: string;
  messageType?: string;
  content: string;
}

export interface SimulatorOutput {
  matched: boolean;
  matchedRules: Array<{
    ruleId: string;
    ruleName: string;
    triggerType: string;
    matchDetails: string;
  }>;
  winningRule: {
    ruleId: string;
    ruleName: string;
    actionType: string;
    actionPreview: string;
  } | null;
  action: {
    type: string | null;
    preview: string | null;
  };
  wouldSend: boolean;
  reason: string;
}

// ── Validation ─────────────────────────────────────────────────────

const VALID_TRIGGER_TYPES = ["keyword_contains", "keyword_regex", "message_type", "thread_type", "sender_id"] as const;
const VALID_ACTION_TYPES = ["fixed_reply", "route_to_hermes", "ignore"] as const;

function validateRule(input: RuleInput): string | null {
  if (!input.name || input.name.trim().length === 0) {
    return "Rule name is required";
  }
  if (!VALID_TRIGGER_TYPES.includes(input.triggerType as typeof VALID_TRIGGER_TYPES[number])) {
    return `Invalid triggerType: ${input.triggerType}. Must be one of: ${VALID_TRIGGER_TYPES.join(", ")}`;
  }
  if (!VALID_ACTION_TYPES.includes(input.actionType as typeof VALID_ACTION_TYPES[number])) {
    return `Invalid actionType: ${input.actionType}. Must be one of: ${VALID_ACTION_TYPES.join(", ")}`;
  }

  // Validate conditions based on triggerType
  if (input.triggerType === "keyword_contains" || input.triggerType === "keyword_regex") {
    const keywords = input.conditions.keywords as unknown;
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0 || !keywords.every((k: unknown) => typeof k === "string")) {
      return "conditions.keywords must be a non-empty array of strings for keyword triggers";
    }
  }

  if (input.triggerType === "keyword_regex") {
    const keywords = input.conditions.keywords as string[];
    for (const kw of keywords) {
      try {
        new RegExp(kw);
      } catch {
        return `Invalid regex in conditions.keywords: "${kw}"`;
      }
    }
  }

  if (input.triggerType === "message_type") {
    if (!input.conditions.messageType || typeof input.conditions.messageType !== "string") {
      return "conditions.messageType must be a string for message_type trigger";
    }
  }

  if (input.triggerType === "thread_type") {
    if (!input.conditions.threadType || typeof input.conditions.threadType !== "string") {
      return "conditions.threadType must be a string for thread_type trigger";
    }
  }

  if (input.triggerType === "sender_id") {
    if (!input.conditions.senderId || typeof input.conditions.senderId !== "string") {
      return "conditions.senderId must be a string for sender_id trigger";
    }
  }

  // Validate actionConfig based on actionType
  if (input.actionType === "fixed_reply") {
    if (!input.actionConfig.reply || typeof input.actionConfig.reply !== "string" || input.actionConfig.reply.trim().length === 0) {
      return "actionConfig.reply must be a non-empty string for fixed_reply action";
    }
  }

  // Validate priority range
  if (input.priority !== undefined && (input.priority < 0 || input.priority > 9999)) {
    return "priority must be between 0 and 9999";
  }

  return null; // valid
}

// ── DB helpers ─────────────────────────────────────────────────────

function dbToOutput(rule: {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  triggerType: string;
  conditions: string;
  actionType: string;
  actionConfig: string;
  targetThreadIds: string | null;
  cooldownSeconds: number | null;
  matchCount: number;
  lastMatchedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}): RuleOutput {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    priority: rule.priority,
    triggerType: rule.triggerType,
    conditions: safeJson(rule.conditions) ?? {},
    actionType: rule.actionType,
    actionConfig: safeJson(rule.actionConfig) ?? {},
    targetThreadIds: safeJsonArray(rule.targetThreadIds),
    cooldownSeconds: rule.cooldownSeconds,
    matchCount: rule.matchCount,
    lastMatchedAt: rule.lastMatchedAt?.toISOString() ?? null,
    createdBy: rule.createdBy,
    updatedBy: rule.updatedBy,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

function safeJson(val: string | null): Record<string, unknown> | null {
  if (!val) return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function safeJsonArray(val: string | null): string[] | null {
  if (!val) return null;
  try {
    const parsed = JSON.parse(val);
    if (Array.isArray(parsed) && parsed.every((v: unknown) => typeof v === "string")) {
      return parsed as string[];
    }
    return null;
  } catch {
    return null;
  }
}

// ── CRUD ────────────────────────────────────────────────────────────

export async function listRules(enabledOnly = false): Promise<RuleOutput[]> {
  const rules = await prisma.rule.findMany({
    where: enabledOnly ? { enabled: true } : {},
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
  });
  return rules.map(dbToOutput);
}

export async function getRule(id: string): Promise<RuleOutput | null> {
  const rule = await prisma.rule.findUnique({ where: { id } });
  return rule ? dbToOutput(rule) : null;
}

export async function createRule(input: RuleInput): Promise<{ rule: RuleOutput; version: RuleVersionOutput }> {
  const error = validateRule(input);
  if (error) throw new Error(error);

  const rule = await prisma.rule.create({
    data: {
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      enabled: input.enabled ?? true,
      priority: input.priority ?? 100,
      triggerType: input.triggerType,
      conditions: JSON.stringify(input.conditions),
      actionType: input.actionType,
      actionConfig: JSON.stringify(input.actionConfig),
      targetThreadIds: input.targetThreadIds ? JSON.stringify(input.targetThreadIds) : null,
      cooldownSeconds: input.cooldownSeconds ?? null,
      createdBy: input.createdBy ?? null,
      updatedBy: input.updatedBy ?? null,
    },
  });

  // Create initial version
  const version = await createRuleVersion(rule.id, dbToOutput(rule), 1, input.createdBy ?? null, input.changeReason ?? "Initial creation");

  return { rule: dbToOutput(rule), version };
}

export async function updateRule(id: string, input: Partial<RuleInput>): Promise<{ rule: RuleOutput; version: RuleVersionOutput }> {
  const existing = await getRule(id);
  if (!existing) throw new Error("Rule not found");

  // Build update data
  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name.trim();
  if (input.description !== undefined) updateData.description = input.description?.trim() ?? null;
  if (input.enabled !== undefined) updateData.enabled = input.enabled;
  if (input.priority !== undefined) updateData.priority = input.priority;
  if (input.triggerType !== undefined) updateData.triggerType = input.triggerType;
  if (input.conditions !== undefined) updateData.conditions = JSON.stringify(input.conditions);
  if (input.actionType !== undefined) updateData.actionType = input.actionType;
  if (input.actionConfig !== undefined) updateData.actionConfig = JSON.stringify(input.actionConfig);
  if (input.targetThreadIds !== undefined) {
    updateData.targetThreadIds = input.targetThreadIds.length > 0 ? JSON.stringify(input.targetThreadIds) : null;
  }
  if (input.cooldownSeconds !== undefined) updateData.cooldownSeconds = input.cooldownSeconds;
  if (input.updatedBy !== undefined) updateData.updatedBy = input.updatedBy;

  // Re-validate merged result
  const mergedInput: RuleInput = {
    name: (updateData.name as string) ?? existing.name,
    triggerType: (updateData.triggerType as string) ?? existing.triggerType,
    conditions: (input.conditions ?? existing.conditions) as Record<string, unknown>,
    actionType: (updateData.actionType as string) ?? existing.actionType,
    actionConfig: (input.actionConfig ?? existing.actionConfig) as Record<string, unknown>,
    priority: (updateData.priority as number) ?? existing.priority,
  };
  const error = validateRule(mergedInput);
  if (error) throw new Error(error);

  await prisma.rule.update({ where: { id }, data: updateData as never });

  const updated = await getRule(id);
  if (!updated) throw new Error("Rule vanished after update");

  // Compute next version number
  const maxVersion = await prisma.ruleVersion.aggregate({
    where: { ruleId: id },
    _max: { version: true },
  });
  const nextVersion = (maxVersion._max.version ?? 0) + 1;

  const version = await createRuleVersion(id, updated, nextVersion, input.updatedBy ?? null, input.changeReason ?? "Rule updated");

  return { rule: updated, version };
}

export async function enableRule(id: string): Promise<RuleOutput> {
  await prisma.rule.update({ where: { id }, data: { enabled: true } });
  return (await getRule(id))!;
}

export async function disableRule(id: string): Promise<RuleOutput> {
  await prisma.rule.update({ where: { id }, data: { enabled: false } });
  return (await getRule(id))!;
}

// ── Versioning ─────────────────────────────────────────────────────

async function createRuleVersion(
  ruleId: string,
  rule: RuleOutput,
  version: number,
  changedBy: string | null,
  changeReason: string | null,
): Promise<RuleVersionOutput> {
  const snapshot = {
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    priority: rule.priority,
    triggerType: rule.triggerType,
    conditions: rule.conditions,
    actionType: rule.actionType,
    actionConfig: rule.actionConfig,
    targetThreadIds: rule.targetThreadIds,
    cooldownSeconds: rule.cooldownSeconds,
  };

  const ver = await prisma.ruleVersion.create({
    data: {
      ruleId,
      version,
      snapshot: JSON.stringify(snapshot),
      changedBy,
      changeReason,
    },
  });

  return {
    id: ver.id,
    ruleId: ver.ruleId,
    version: ver.version,
    snapshot: safeJson(ver.snapshot) ?? {},
    changedBy: ver.changedBy,
    changeReason: ver.changeReason,
    createdAt: ver.createdAt.toISOString(),
  };
}

export async function getRuleVersions(ruleId: string): Promise<RuleVersionOutput[]> {
  const versions = await prisma.ruleVersion.findMany({
    where: { ruleId },
    orderBy: { version: "desc" },
  });
  return versions.map((v) => ({
    id: v.id,
    ruleId: v.ruleId,
    version: v.version,
    snapshot: safeJson(v.snapshot) ?? {},
    changedBy: v.changedBy,
    changeReason: v.changeReason,
    createdAt: v.createdAt.toISOString(),
  }));
}

// ── Execution tracking ─────────────────────────────────────────────

export async function getRuleExecutions(ruleId: string, limit = 50): Promise<RuleExecutionOutput[]> {
  const execs = await prisma.ruleExecution.findMany({
    where: { ruleId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return execs.map((e) => ({
    id: e.id,
    ruleId: e.ruleId,
    messageId: e.messageId,
    threadId: e.threadId,
    matched: e.matched,
    actionTaken: e.actionTaken,
    result: e.result,
    errorCode: e.errorCode,
    errorMessage: e.errorMessage,
    metadata: safeJson(e.metadata),
    createdAt: e.createdAt.toISOString(),
  }));
}

export async function recordRuleExecution(params: {
  ruleId: string | null;
  messageId?: string;
  threadId?: string;
  matched: boolean;
  actionTaken?: string;
  result?: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}): Promise<RuleExecutionOutput> {
  const exec = await prisma.ruleExecution.create({
    data: {
      ruleId: params.ruleId ?? null,
      messageId: params.messageId ?? null,
      threadId: params.threadId ?? null,
      matched: params.matched,
      actionTaken: params.actionTaken ?? null,
      result: params.result ?? null,
      errorCode: params.errorCode ?? null,
      errorMessage: params.errorMessage ?? null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  });
  return {
    id: exec.id,
    ruleId: exec.ruleId,
    messageId: exec.messageId,
    threadId: exec.threadId,
    matched: exec.matched,
    actionTaken: exec.actionTaken,
    result: exec.result,
    errorCode: exec.errorCode,
    errorMessage: exec.errorMessage,
    metadata: safeJson(exec.metadata),
    createdAt: exec.createdAt.toISOString(),
  };
}

// ── Core evaluator ─────────────────────────────────────────────────

export async function evaluateRules(ctx: MessageContext): Promise<EvaluateResult> {
  const rules = await listRules(true); // enabled only
  const matchedRules: EvaluateResult["matchedRules"] = [];

  for (const rule of rules) {
    // ── Target thread filter ──────────────────────────
    if (rule.targetThreadIds && rule.targetThreadIds.length > 0) {
      if (!rule.targetThreadIds.includes(ctx.threadId)) continue;
    }

    // ── Trigger evaluation ────────────────────────────
    const matchResult = evaluateTrigger(rule, ctx);
    if (!matchResult.matched) continue;

    matchedRules.push({
      rule,
      matchDetails: matchResult.details,
    });
  }

  // Sort by priority (lower number = higher priority)
  matchedRules.sort((a, b) => a.rule.priority - b.rule.priority);

  const winningRule = matchedRules.length > 0 ? matchedRules[0]!.rule : null;

  let action: EvaluateResult["action"] = { type: null, preview: null };
  let reason = "no_rules_matched";

  if (winningRule) {
    action.type = winningRule.actionType;
    reason = `rule_matched:${winningRule.name}`;

    if (winningRule.actionType === "fixed_reply") {
      const reply = winningRule.actionConfig.reply as string;
      action.preview = typeof reply === "string" ? reply.slice(0, 200) : null;
      reason = `rule_matched:${winningRule.name} → fixed_reply`;
    } else if (winningRule.actionType === "ignore") {
      action.preview = "[ignore]";
      reason = `rule_matched:${winningRule.name} → ignore`;
    } else if (winningRule.actionType === "route_to_hermes") {
      action.preview = "[route to Hermes]";
      reason = `rule_matched:${winningRule.name} → route_to_hermes`;
    }
  }

  return {
    matched: matchedRules.length > 0,
    matchedRules,
    winningRule,
    action,
    wouldSend: action.type === "fixed_reply" && !getCurrentEffectiveDryRun(),
    reason,
  };
}

function evaluateTrigger(
  rule: RuleOutput,
  ctx: MessageContext,
): { matched: boolean; details: string } {
  const cond = rule.conditions;

  switch (rule.triggerType) {
    case "keyword_contains": {
      const keywords = cond.keywords as string[] | undefined;
      if (!keywords || keywords.length === 0) {
        return { matched: false, details: "no keywords configured" };
      }
      const caseSensitive = cond.caseSensitive === true;
      const target = caseSensitive ? ctx.content : ctx.content.toLowerCase();
      for (const kw of keywords) {
        const search = caseSensitive ? kw : kw.toLowerCase();
        if (target.includes(search)) {
          return { matched: true, details: `keyword "${kw}" found` };
        }
      }
      return { matched: false, details: "no keyword matched" };
    }

    case "keyword_regex": {
      const keywords = cond.keywords as string[] | undefined;
      if (!keywords || keywords.length === 0) {
        return { matched: false, details: "no regex patterns configured" };
      }
      for (const pattern of keywords) {
        try {
          const re = new RegExp(pattern, cond.caseSensitive === true ? "" : "i");
          if (re.test(ctx.content)) {
            return { matched: true, details: `regex /${pattern}/ matched` };
          }
        } catch {
          // Invalid regex — skip
        }
      }
      return { matched: false, details: "no regex matched" };
    }

    case "message_type": {
      const expected = cond.messageType as string | undefined;
      const matched = expected !== undefined && ctx.messageType === expected;
      return {
        matched,
        details: matched
          ? `message type is "${expected}"`
          : `message type "${ctx.messageType}" ≠ "${expected}"`,
      };
    }

    case "thread_type": {
      const expected = cond.threadType as string | undefined;
      const matched = expected !== undefined && ctx.threadType === expected;
      return {
        matched,
        details: matched
          ? `thread type is "${expected}"`
          : `thread type "${ctx.threadType}" ≠ "${expected}"`,
      };
    }

    case "sender_id": {
      const expected = cond.senderId as string | undefined;
      const matched = expected !== undefined && ctx.senderId === expected;
      return {
        matched,
        details: matched
          ? `sender ID matches`
          : `sender ID "${ctx.senderId ?? "unknown"}" ≠ "${expected}"`,
      };
    }

    default:
      return { matched: false, details: `unknown trigger type: ${rule.triggerType}` };
  }
}

// ── Simulator — never sends real Zalo messages ─────────────────────

export async function simulateRule(input: SimulatorInput): Promise<SimulatorOutput> {
  const ctx: MessageContext = {
    threadId: input.threadId ?? "sim-thread",
    threadType: input.threadType ?? "user",
    senderId: input.senderId ?? "sim-user",
    content: input.content,
    messageType: input.messageType ?? "text",
  };

  const result = await evaluateRules(ctx);

  return {
    matched: result.matched,
    matchedRules: result.matchedRules.map((mr) => ({
      ruleId: mr.rule.id,
      ruleName: mr.rule.name,
      triggerType: mr.rule.triggerType,
      matchDetails: mr.matchDetails,
    })),
    winningRule: result.winningRule
      ? {
          ruleId: result.winningRule.id,
          ruleName: result.winningRule.name,
          actionType: result.winningRule.actionType,
          actionPreview: result.action.preview ?? "[no preview]",
        }
      : null,
    action: result.action,
    wouldSend: false, // Simulator NEVER sends
    reason: `simulator_dry_run: ${result.reason}`,
  };
}
