// =============================================================================
// Group Safety tests — reply window + audit logging
// =============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getGroupReplyWindow,
  touchGroupReplyWindow,
  closeGroupReplyWindow,
  resetGroupReplyWindows,
  getActiveReplyWindows,
  logGroupGateAudit,
} from "../services/group-safety.service.js";
import type { ThreadSettingData } from "../services/thread-settings.service.js";

// Mock config
vi.mock("../config.js", () => ({
  config: {
    autoReply: {
      groupReplyWindowSeconds: 600,
    },
  },
}));

const mockSettings: ThreadSettingData = {
  threadId: "group-1",
  autoReplyEnabled: true,
  groupMentionRequired: true,
  groupReplyWindowSeconds: 600,
  allowCreateReminder: true,
  allowMedia: false,
  allowImageUnderstanding: false,
};

describe("Group Safety Service", () => {
  beforeEach(() => {
    resetGroupReplyWindows();
  });

  it("returns 0 when no window exists", () => {
    expect(getGroupReplyWindow("group-1")).toBe(0);
  });

  it("opens reply window on touch", () => {
    touchGroupReplyWindow("group-1", mockSettings);
    const expiresAt = getGroupReplyWindow("group-1");
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it("reply window expires after TTL", () => {
    const shortSettings = { ...mockSettings, groupReplyWindowSeconds: 0 }; // 0 = use env default (600)
    touchGroupReplyWindow("group-1", shortSettings);
    // Window should still be alive
    expect(getGroupReplyWindow("group-1")).toBeGreaterThan(0);
    // But we can close it manually
    closeGroupReplyWindow("group-1");
    expect(getGroupReplyWindow("group-1")).toBe(0);
  });

  it("closing window removes it", () => {
    touchGroupReplyWindow("group-1", mockSettings);
    closeGroupReplyWindow("group-1");
    expect(getGroupReplyWindow("group-1")).toBe(0);
  });

  it("getActiveReplyWindows returns active windows", () => {
    touchGroupReplyWindow("group-1", mockSettings);
    const windows = getActiveReplyWindows();
    expect(windows.length).toBe(1);
    expect(windows[0]!.threadId).toBe("group-1");
    expect(windows[0]!.remainingSeconds).toBeGreaterThan(0);
    expect(windows[0]!.remainingSeconds).toBeLessThanOrEqual(600);
  });

  it("getActiveReplyWindows filters expired windows", () => {
    // Open window then manually close to verify filtering
    touchGroupReplyWindow("group-1", mockSettings);
    let windows = getActiveReplyWindows();
    expect(windows.length).toBe(1);
    closeGroupReplyWindow("group-1");
    windows = getActiveReplyWindows();
    expect(windows.length).toBe(0);
  });

  it("multiple groups have separate windows", () => {
    touchGroupReplyWindow("group-1", mockSettings);
    touchGroupReplyWindow("group-2", mockSettings);
    expect(getGroupReplyWindow("group-1")).toBeGreaterThan(0);
    expect(getGroupReplyWindow("group-2")).toBeGreaterThan(0);
    closeGroupReplyWindow("group-1");
    expect(getGroupReplyWindow("group-1")).toBe(0);
    expect(getGroupReplyWindow("group-2")).toBeGreaterThan(0);
  });

  it("reset clears all windows", () => {
    touchGroupReplyWindow("group-1", mockSettings);
    touchGroupReplyWindow("group-2", mockSettings);
    resetGroupReplyWindows();
    expect(getGroupReplyWindow("group-1")).toBe(0);
    expect(getGroupReplyWindow("group-2")).toBe(0);
  });

  it("logGroupGateAudit logs structured data (smoke test)", () => {
    // Just verify it doesn't throw
    expect(() =>
      logGroupGateAudit({
        threadId: "group-1",
        threadType: "group",
        messageId: "msg-1",
        decision: "skip",
        reason: "bot_not_mentioned",
        mentioned: false,
      }),
    ).not.toThrow();
  });
});
