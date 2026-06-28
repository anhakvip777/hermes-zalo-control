import { prisma } from "../db.js";

// =============================================================================
// Default app settings
// =============================================================================

const DEFAULTS: Record<string, string> = {
  "global.sending_enabled": "true",
  "global.schedules_active": "true",
  "global.emergency_stop": "false",
  "retry.max_attempts": "3",
  "retry.base_delay_ms": "1000",
};

// =============================================================================
// Get a single setting
// =============================================================================

export async function getSetting(key: string): Promise<string> {
  const setting = await prisma.appSetting.findUnique({ where: { key } });
  return setting?.value ?? DEFAULTS[key] ?? "";
}

// =============================================================================
// Get a boolean setting
// =============================================================================

export async function getBoolSetting(key: string): Promise<boolean> {
  const value = await getSetting(key);
  return value === "true";
}

// =============================================================================
// Get many settings
// =============================================================================

export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const settings = await prisma.appSetting.findMany({
    where: { key: { in: keys } },
  });
  const result: Record<string, string> = {};
  for (const key of keys) {
    result[key] = settings.find((s) => s.key === key)?.value ?? DEFAULTS[key] ?? "";
  }
  return result;
}

// =============================================================================
// Set a setting
// =============================================================================

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value, updatedAt: new Date() },
    create: { key, value },
  });
}

// =============================================================================
// Global status checkers (used by worker in Phase 3)
// =============================================================================

export async function isSendingEnabled(): Promise<boolean> {
  // Emergency stop overrides everything
  const emergencyStop = await getBoolSetting("global.emergency_stop");
  if (emergencyStop) return false;
  return getBoolSetting("global.sending_enabled");
}

export async function areSchedulesActive(): Promise<boolean> {
  const emergencyStop = await getBoolSetting("global.emergency_stop");
  if (emergencyStop) return false;
  return getBoolSetting("global.schedules_active");
}

export async function isEmergencyStop(): Promise<boolean> {
  return getBoolSetting("global.emergency_stop");
}

// =============================================================================
// Admin actions
// =============================================================================

export async function pauseSending(): Promise<void> {
  await setSetting("global.sending_enabled", "false");
}

export async function resumeSending(): Promise<void> {
  await setSetting("global.sending_enabled", "true");
}

export async function emergencyStop(): Promise<void> {
  await setSetting("global.emergency_stop", "true");
  await setSetting("global.sending_enabled", "false");
  await setSetting("global.schedules_active", "false");
}

export async function clearEmergencyStop(): Promise<void> {
  await setSetting("global.emergency_stop", "false");
  await setSetting("global.sending_enabled", "true");
  await setSetting("global.schedules_active", "true");
}

// =============================================================================
// Get full admin status
// =============================================================================

export async function getAdminStatus() {
  const [sendingEnabled, schedulesActive, emergencyStop] = await Promise.all([
    isSendingEnabled(),
    areSchedulesActive(),
    isEmergencyStop(),
  ]);

  return {
    sendingEnabled,
    schedulesActive,
    emergencyStop,
  };
}

// =============================================================================
// Initialize defaults on first run
// =============================================================================

export async function initializeDefaultSettings(): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await prisma.appSetting.upsert({
      where: { key },
      update: {}, // Don't overwrite existing
      create: { key, value },
    });
  }
}
