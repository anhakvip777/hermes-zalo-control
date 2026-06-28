// =============================================================================
// Rule Engine Tests — Batch 11
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanDatabase } from "./shared-setup.js";
import * as ruleEngine from "../services/rule-engine.service.js";

beforeAll(async () => { await cleanDatabase(); });
afterAll(async () => { await cleanDatabase(); });
beforeEach(async () => { await cleanDatabase(); });

// ── Helpers ────────────────────────────────────────────────────────

const keywordRule = {
  name: "Welcome Rule",
  description: "Reply to greetings",
  triggerType: "keyword_contains" as const,
  conditions: { keywords: ["xin chào", "hello", "chào bạn"], caseSensitive: false },
  actionType: "fixed_reply" as const,
  actionConfig: { reply: "Chào bạn! Mình có thể giúp gì?" },
  priority: 10,
  createdBy: "test",
  changeReason: "Test creation",
};

const ignoreRule = {
  name: "Ignore Spam",
  triggerType: "keyword_contains" as const,
  conditions: { keywords: ["spam"] },
  actionType: "ignore" as const,
  actionConfig: {},
  priority: 5,
  createdBy: "test",
};

const routeRule = {
  name: "Route to AI",
  triggerType: "keyword_contains" as const,
  conditions: { keywords: ["ai ơi"] },
  actionType: "route_to_hermes" as const,
  actionConfig: {},
  priority: 20,
  createdBy: "test",
};

const regexRule = {
  name: "Phone Number Detector",
  triggerType: "keyword_regex" as const,
  conditions: { keywords: ["\\d{10,11}"], caseSensitive: false },
  actionType: "ignore" as const,
  actionConfig: {},
  priority: 1,
  createdBy: "test",
};

// ═══════════════════════════════════════════════════════════════════
// 1. CRUD
// ═══════════════════════════════════════════════════════════════════

describe("Rule CRUD", () => {
  it("lists rules (empty initially)", async () => {
    const rules = await ruleEngine.listRules();
    expect(rules).toEqual([]);
  });

  it("creates a keyword_contains rule", async () => {
    const { rule } = await ruleEngine.createRule(keywordRule);
    expect(rule.name).toBe("Welcome Rule");
    expect(rule.triggerType).toBe("keyword_contains");
    expect(rule.conditions.keywords).toEqual(["xin chào", "hello", "chào bạn"]);
    expect(rule.actionType).toBe("fixed_reply");
    expect(rule.actionConfig.reply).toBe("Chào bạn! Mình có thể giúp gì?");
    expect(rule.enabled).toBe(true);
  });

  it("creates with version history", async () => {
    const { rule, version } = await ruleEngine.createRule(keywordRule);
    expect(version.version).toBe(1);
    expect(version.ruleId).toBe(rule.id);
    expect(version.changeReason).toBe("Test creation");

    const versions = await ruleEngine.getRuleVersions(rule.id);
    expect(versions).toHaveLength(1);
  });

  it("rejects invalid triggerType", async () => {
    await expect(
      ruleEngine.createRule({ ...keywordRule, triggerType: "invalid_type" as never }),
    ).rejects.toThrow(/Invalid triggerType/);
  });

  it("rejects empty keywords for keyword_contains", async () => {
    await expect(
      ruleEngine.createRule({
        ...keywordRule,
        conditions: { keywords: [] },
      }),
    ).rejects.toThrow(/keywords must be a non-empty array/);
  });

  it("rejects invalid regex in keywords", async () => {
    await expect(
      ruleEngine.createRule({
        ...regexRule,
        conditions: { keywords: ["[invalid("] },
      }),
    ).rejects.toThrow(/Invalid regex/);
  });

  it("rejects fixed_reply without reply text", async () => {
    await expect(
      ruleEngine.createRule({
        ...keywordRule,
        actionConfig: { reply: "" },
      }),
    ).rejects.toThrow(/reply must be a non-empty string/);
  });

  it("updates rule and creates new version", async () => {
    const { rule } = await ruleEngine.createRule(keywordRule);

    const { rule: updated, version } = await ruleEngine.updateRule(rule.id, {
      name: "Updated Welcome",
      description: "Updated description",
      priority: 5,
      updatedBy: "admin",
      changeReason: "Priority bump",
    });

    expect(updated.name).toBe("Updated Welcome");
    expect(updated.priority).toBe(5);
    expect(version.version).toBe(2);
    expect(version.changeReason).toBe("Priority bump");

    const versions = await ruleEngine.getRuleVersions(rule.id);
    expect(versions).toHaveLength(2);
  });

  it("gets single rule", async () => {
    const { rule } = await ruleEngine.createRule(keywordRule);
    const found = await ruleEngine.getRule(rule.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Welcome Rule");
  });

  it("enables and disables rule", async () => {
    const { rule } = await ruleEngine.createRule({ ...keywordRule, enabled: true });
    expect(rule.enabled).toBe(true);

    const disabled = await ruleEngine.disableRule(rule.id);
    expect(disabled.enabled).toBe(false);

    // Disabled rules not in enabled-only list
    const enabled = await ruleEngine.listRules(true);
    expect(enabled).toHaveLength(0);

    const reenabled = await ruleEngine.enableRule(rule.id);
    expect(reenabled.enabled).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Evaluation
// ═══════════════════════════════════════════════════════════════════

describe("Rule Evaluation", () => {
  it("matches keyword_contains", async () => {
    await ruleEngine.createRule(keywordRule);

    const result = await ruleEngine.evaluateRules({
      threadId: "t1",
      threadType: "user",
      content: "xin chào bạn",
      messageType: "text",
    });

    expect(result.matched).toBe(true);
    expect(result.matchedRules).toHaveLength(1);
    expect(result.winningRule!.name).toBe("Welcome Rule");
    expect(result.action.type).toBe("fixed_reply");
  });

  it("matches case-insensitive by default", async () => {
    await ruleEngine.createRule(keywordRule);

    const result = await ruleEngine.evaluateRules({
      threadId: "t1",
      threadType: "user",
      content: "XIN CHÀO",
      messageType: "text",
    });

    expect(result.matched).toBe(true);
  });

  it("priority chooses highest priority rule", async () => {
    // Higher priority = lower number
    await ruleEngine.createRule({ ...keywordRule, priority: 100 });
    await ruleEngine.createRule({ ...ignoreRule, priority: 1 });

    const result = await ruleEngine.evaluateRules({
      threadId: "t1",
      threadType: "user",
      content: "xin chào spam",
      messageType: "text",
    });

    expect(result.matched).toBe(true);
    // ignoreRule has priority 1 (higher) vs keywordRule 100
    expect(result.winningRule!.actionType).toBe("ignore");
  });

  it("does not match when no keyword found", async () => {
    await ruleEngine.createRule(keywordRule);

    const result = await ruleEngine.evaluateRules({
      threadId: "t1",
      threadType: "user",
      content: "chào buổi sáng",
      messageType: "text",
    });

    expect(result.matched).toBe(false);
  });

  it("matches regex trigger", async () => {
    await ruleEngine.createRule(regexRule);

    const result = await ruleEngine.evaluateRules({
      threadId: "t1",
      threadType: "user",
      content: "số điện thoại: 0987654321",
      messageType: "text",
    });

    expect(result.matched).toBe(true);
    expect(result.winningRule!.name).toBe("Phone Number Detector");
  });

  it("matches message_type trigger", async () => {
    await ruleEngine.createRule({
      name: "Sticker Rule",
      triggerType: "message_type",
      conditions: { messageType: "sticker" },
      actionType: "ignore",
      actionConfig: {},
      createdBy: "test",
    });

    const result = await ruleEngine.evaluateRules({
      threadId: "t1",
      threadType: "user",
      content: "",
      messageType: "sticker",
    });

    expect(result.matched).toBe(true);
    expect(result.winningRule!.triggerType).toBe("message_type");
  });

  it("matches thread_type trigger", async () => {
    await ruleEngine.createRule({
      name: "Group Only",
      triggerType: "thread_type",
      conditions: { threadType: "group" },
      actionType: "ignore",
      actionConfig: {},
      createdBy: "test",
    });

    const groupResult = await ruleEngine.evaluateRules({
      threadId: "g1",
      threadType: "group",
      content: "hello",
      messageType: "text",
    });
    expect(groupResult.matched).toBe(true);

    const dmResult = await ruleEngine.evaluateRules({
      threadId: "u1",
      threadType: "user",
      content: "hello",
      messageType: "text",
    });
    expect(dmResult.matched).toBe(false);
  });

  it("matches sender_id trigger", async () => {
    await ruleEngine.createRule({
      name: "Specific User",
      triggerType: "sender_id",
      conditions: { senderId: "user-123" },
      actionType: "fixed_reply",
      actionConfig: { reply: "Hello specific user!" },
      createdBy: "test",
    });

    const matchResult = await ruleEngine.evaluateRules({
      threadId: "t1",
      threadType: "user",
      senderId: "user-123",
      content: "anything",
      messageType: "text",
    });
    expect(matchResult.matched).toBe(true);

    const noMatch = await ruleEngine.evaluateRules({
      threadId: "t1",
      threadType: "user",
      senderId: "user-456",
      content: "anything",
      messageType: "text",
    });
    expect(noMatch.matched).toBe(false);
  });

  it("respects targetThreadIds filter", async () => {
    await ruleEngine.createRule({
      ...keywordRule,
      targetThreadIds: ["thread-A"],
    });

    const inAllowed = await ruleEngine.evaluateRules({
      threadId: "thread-A",
      threadType: "user",
      content: "xin chào",
      messageType: "text",
    });
    expect(inAllowed.matched).toBe(true);

    const notAllowed = await ruleEngine.evaluateRules({
      threadId: "thread-B",
      threadType: "user",
      content: "xin chào",
      messageType: "text",
    });
    expect(notAllowed.matched).toBe(false);
  });

  it("disabled rule does not match", async () => {
    const { rule } = await ruleEngine.createRule(keywordRule);
    await ruleEngine.disableRule(rule.id);

    const result = await ruleEngine.evaluateRules({
      threadId: "t1",
      threadType: "user",
      content: "xin chào",
      messageType: "text",
    });

    expect(result.matched).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Simulator
// ═══════════════════════════════════════════════════════════════════

describe("Rule Simulator", () => {
  it("simulator returns matched rule", async () => {
    await ruleEngine.createRule(keywordRule);

    const result = await ruleEngine.simulateRule({
      content: "xin chào bạn",
      threadId: "test-thread",
      threadType: "user",
    });

    expect(result.matched).toBe(true);
    expect(result.matchedRules).toHaveLength(1);
    expect(result.winningRule!.ruleName).toBe("Welcome Rule");
    expect(result.winningRule!.actionType).toBe("fixed_reply");
  });

  it("simulator never sends (wouldSend=false)", async () => {
    await ruleEngine.createRule(keywordRule);

    const result = await ruleEngine.simulateRule({
      content: "xin chào",
    });

    expect(result.wouldSend).toBe(false);
    expect(result.reason).toContain("simulator_dry_run");
  });

  it("simulator handles no match", async () => {
    const result = await ruleEngine.simulateRule({
      content: "random message",
    });

    expect(result.matched).toBe(false);
    expect(result.winningRule).toBeNull();
    expect(result.action.type).toBeNull();
  });

  it("simulator with multiple matching rules returns highest priority", async () => {
    await ruleEngine.createRule({ ...keywordRule, priority: 100 });
    await ruleEngine.createRule({ ...ignoreRule, priority: 1 });

    const result = await ruleEngine.simulateRule({
      content: "xin chào spam",
    });

    expect(result.matched).toBe(true);
    expect(result.winningRule!.ruleName).toBe("Ignore Spam"); // priority 1 wins
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Action types
// ═══════════════════════════════════════════════════════════════════

describe("Rule Action Types", () => {
  it("ignore action returns ignore preview", async () => {
    await ruleEngine.createRule(ignoreRule);

    const result = await ruleEngine.evaluateRules({
      threadId: "t1",
      threadType: "user",
      content: "this is spam",
      messageType: "text",
    });

    expect(result.matched).toBe(true);
    expect(result.action.type).toBe("ignore");
    expect(result.action.preview).toBe("[ignore]");
  });

  it("route_to_hermes returns route preview", async () => {
    await ruleEngine.createRule(routeRule);

    const result = await ruleEngine.evaluateRules({
      threadId: "t1",
      threadType: "user",
      content: "ai ơi giúp mình",
      messageType: "text",
    });

    expect(result.matched).toBe(true);
    expect(result.action.type).toBe("route_to_hermes");
    expect(result.action.preview).toBe("[route to Hermes]");
  });

  it("fixed_reply returns reply preview", async () => {
    await ruleEngine.createRule(keywordRule);

    const result = await ruleEngine.evaluateRules({
      threadId: "t1",
      threadType: "user",
      content: "xin chào",
      messageType: "text",
    });

    expect(result.matched).toBe(true);
    expect(result.action.type).toBe("fixed_reply");
    expect(result.action.preview).toBe("Chào bạn! Mình có thể giúp gì?");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Execution recording
// ═══════════════════════════════════════════════════════════════════

describe("Rule Execution Recording", () => {
  it("records matched execution", async () => {
    const { rule } = await ruleEngine.createRule(keywordRule);

    const exec = await ruleEngine.recordRuleExecution({
      ruleId: rule.id,
      threadId: "t1",
      messageId: "msg-1",
      matched: true,
      actionTaken: "fixed_reply",
      result: "dry_run",
    });

    expect(exec.matched).toBe(true);
    expect(exec.actionTaken).toBe("fixed_reply");
    expect(exec.result).toBe("dry_run");
  });

  it("records unmatched execution", async () => {
    const exec = await ruleEngine.recordRuleExecution({
      ruleId: null,
      threadId: "t1",
      matched: false,
      actionTaken: null,
      result: "no_rules_configured",
    });

    expect(exec.matched).toBe(false);
    expect(exec.ruleId).toBeNull();
  });

  it("retrieves executions for a rule", async () => {
    const { rule } = await ruleEngine.createRule(keywordRule);

    await ruleEngine.recordRuleExecution({
      ruleId: rule.id,
      matched: true,
      actionTaken: "fixed_reply",
      result: "dry_run",
    });

    await ruleEngine.recordRuleExecution({
      ruleId: rule.id,
      matched: true,
      actionTaken: "fixed_reply",
      result: "sent",
    });

    const execs = await ruleEngine.getRuleExecutions(rule.id);
    expect(execs).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Edge Cases
// ═══════════════════════════════════════════════════════════════════

describe("Rule Edge Cases", () => {
  it("updating rule re-validates", async () => {
    const { rule } = await ruleEngine.createRule(keywordRule);

    await expect(
      ruleEngine.updateRule(rule.id, {
        triggerType: "keyword_contains",
        conditions: { keywords: [] },
        updatedBy: "test",
      }),
    ).rejects.toThrow(/keywords must be/);
  });

  it("update returns version history", async () => {
    const { rule } = await ruleEngine.createRule(keywordRule);
    const { version: v2 } = await ruleEngine.updateRule(rule.id, {
      name: "Updated",
      updatedBy: "admin",
      changeReason: "Name change",
    });
    expect(v2.version).toBe(2);
    expect(v2.changeReason).toBe("Name change");
  });

  it("version history is returned in desc order", async () => {
    const { rule } = await ruleEngine.createRule(keywordRule);
    await ruleEngine.updateRule(rule.id, { name: "v2", updatedBy: "admin" });
    await ruleEngine.updateRule(rule.id, { name: "v3", updatedBy: "admin" });

    const versions = await ruleEngine.getRuleVersions(rule.id);
    expect(versions).toHaveLength(3);
    expect(versions[0]!.version).toBe(3);
    expect(versions[2]!.version).toBe(1);
  });

  it("404 for non-existent rule", async () => {
    const result = await ruleEngine.getRule("nonexistent");
    expect(result).toBeNull();
  });
});
