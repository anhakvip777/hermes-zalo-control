import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanDatabase } from "./shared-setup.js";
import * as settings from "../services/settings.service.js";

beforeAll(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
});

beforeEach(async () => {
  await cleanDatabase();
});

describe("Settings Service", () => {
  it("getSetting returns default for unset key", async () => {
    const val = await settings.getSetting("global.sending_enabled");
    expect(val).toBe("true");
  });

  it("setSetting and getSetting round-trip", async () => {
    await settings.setSetting("global.sending_enabled", "false");
    const val = await settings.getSetting("global.sending_enabled");
    expect(val).toBe("false");
  });

  it("getBoolSetting returns boolean", async () => {
    expect(await settings.getBoolSetting("global.sending_enabled")).toBe(true);
    await settings.setSetting("global.sending_enabled", "false");
    expect(await settings.getBoolSetting("global.sending_enabled")).toBe(false);
  });

  it("isSendingEnabled respects global and emergency stop", async () => {
    expect(await settings.isSendingEnabled()).toBe(true);
    await settings.pauseSending();
    expect(await settings.isSendingEnabled()).toBe(false);
    await settings.resumeSending();
    expect(await settings.isSendingEnabled()).toBe(true);
  });

  it("emergency stop disables everything", async () => {
    await settings.emergencyStop();
    expect(await settings.isEmergencyStop()).toBe(true);
    expect(await settings.isSendingEnabled()).toBe(false);
    expect(await settings.areSchedulesActive()).toBe(false);
  });

  it("clear emergency stop restores all", async () => {
    await settings.emergencyStop();
    await settings.clearEmergencyStop();
    expect(await settings.isEmergencyStop()).toBe(false);
    expect(await settings.isSendingEnabled()).toBe(true);
    expect(await settings.areSchedulesActive()).toBe(true);
  });

  it("getAdminStatus returns all booleans", async () => {
    await settings.initializeDefaultSettings();
    const status = await settings.getAdminStatus();
    expect(status).toEqual({
      sendingEnabled: true,
      schedulesActive: true,
      emergencyStop: false,
    });
  });

  it("pauseSending only affects sending, not schedules", async () => {
    await settings.initializeDefaultSettings();
    await settings.pauseSending();
    expect(await settings.isSendingEnabled()).toBe(false);
    expect(await settings.areSchedulesActive()).toBe(true);
  });

  it("initializeDefaultSettings does not overwrite existing", async () => {
    await settings.setSetting("global.sending_enabled", "false");
    await settings.initializeDefaultSettings();
    const val = await settings.getSetting("global.sending_enabled");
    expect(val).toBe("false");
  });

  it("getSettings returns multiple keys with defaults", async () => {
    await settings.initializeDefaultSettings();
    await settings.setSetting("global.sending_enabled", "true");
    const result = await settings.getSettings([
      "global.sending_enabled",
      "global.emergency_stop",
      "retry.max_attempts",
    ]);
    expect(result["global.sending_enabled"]).toBe("true");
    expect(result["global.emergency_stop"]).toBe("false");
    expect(result["retry.max_attempts"]).toBe("3");
  });
});
