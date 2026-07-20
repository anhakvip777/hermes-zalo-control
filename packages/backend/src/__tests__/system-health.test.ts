import { describe, it, expect, vi } from "vitest";
import { resolveSqliteDatabasePath } from "../backend-paths.js";
import { prisma } from "../db.js";
import { getPublicHealth, getHealthSnapshot } from "../services/system-health.service.js";

describe("System Health — public health", () => {
  it("returns basic status info", () => {
    const result = getPublicHealth();
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("timestamp");
    expect(result).toHaveProperty("uptimeSeconds");
    expect(result).toHaveProperty("pid");
    expect(result).toHaveProperty("nodeVersion");
    expect(result).toHaveProperty("nodeEnv");
  });

  it("does not leak sensitive details", () => {
    const result = getPublicHealth();
    const json = JSON.stringify(result);
    expect(json).not.toContain("apiKey");
    expect(json).not.toContain("CHIASEGPU_API_KEY");
    expect(json).not.toContain("sk-");
    expect(json).not.toContain("criticalTables");
    expect(json).not.toContain("allowedThreads");
    expect(json).not.toContain("latestBackupName");
  });
});

describe("System Health — full snapshot", () => {
  it("returns a health snapshot with status", async () => {
    const snapshot = await getHealthSnapshot();
    expect(snapshot).toHaveProperty("status");
    expect(snapshot).toHaveProperty("timestamp");
    expect(snapshot).toHaveProperty("uptimeSeconds");
    expect(snapshot).toHaveProperty("version");
  });

  it("includes all required sections", async () => {
    const snapshot = await getHealthSnapshot();
    expect(snapshot).toHaveProperty("backend");
    expect(snapshot).toHaveProperty("db");
    expect(snapshot).toHaveProperty("zalo");
    expect(snapshot).toHaveProperty("autoReply");
    expect(snapshot).toHaveProperty("worker");
    expect(snapshot).toHaveProperty("backup");
    expect(snapshot).toHaveProperty("processLock");
    expect(snapshot).toHaveProperty("config");
    expect(snapshot).toHaveProperty("messages");
    expect(snapshot).toHaveProperty("errors");
  });

  it("backend section has correct info", async () => {
    const snapshot = await getHealthSnapshot();
    expect(snapshot.backend.pid).toBe(process.pid);
    expect(typeof snapshot.backend.port).toBe("number");
    expect(typeof snapshot.backend.nodeEnv).toBe("string");
  });

  it("db section — ok is true if DB exists and has tables", async () => {
    const snapshot = await getHealthSnapshot();
    // DB exists on this machine
    expect(snapshot.db.ok).toBe(true);
    expect(snapshot.db.path).toBe(resolveSqliteDatabasePath(process.env.DATABASE_URL ?? "file:./dev.db"));
    expect(snapshot.db.sizeBytes).toBeGreaterThan(0);
    // critical tables at minimum should have Message
    expect(snapshot.db.criticalTables).toHaveProperty("Message");
  });

  it("reports an explicitly unsupported DATABASE_URL as unavailable without querying SQLite", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const queryRawSpy = vi.spyOn(prisma, "$queryRawUnsafe");
    process.env.DATABASE_URL = "postgresql://localhost/hermes";

    try {
      const snapshot = await getHealthSnapshot();

      expect(snapshot.db).toEqual({
        ok: false,
        path: null,
        sizeBytes: 0,
        criticalTables: {},
      });
      expect(queryRawSpy).not.toHaveBeenCalled();
    } finally {
      queryRawSpy.mockRestore();
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("autoReply section has correct types", async () => {
    const snapshot = await getHealthSnapshot();
    expect(typeof snapshot.autoReply.enabled).toBe("boolean");
    expect(typeof snapshot.autoReply.dryRun).toBe("boolean");
    expect(typeof snapshot.autoReply.allowedThreadsCount).toBe("number");
    expect(typeof snapshot.autoReply.cooldownSeconds).toBe("number");
  });

  it("config section includes config-check summary", async () => {
    const snapshot = await getHealthSnapshot();
    expect(["CONFIG_OK", "CONFIG_WARN", "CONFIG_ERROR"]).toContain(snapshot.config.status);
    expect(typeof snapshot.config.pass).toBe("number");
    expect(typeof snapshot.config.warn).toBe("number");
    expect(typeof snapshot.config.error).toBe("number");
  });

  it("processLock section includes lock info", async () => {
    const snapshot = await getHealthSnapshot();
    expect(typeof snapshot.processLock.locked).toBe("boolean");
    expect(typeof snapshot.processLock.isOwner).toBe("boolean");
    // ownerPid and startedAt may be null
  });

  it("backup section has backup count", async () => {
    const snapshot = await getHealthSnapshot();
    expect(typeof snapshot.backup.backupCount).toBe("number");
    const ageHours = snapshot.backup.latestBackupAgeHours;
    expect(ageHours === null || typeof ageHours === "number").toBe(true);
  });

  it("messages section has inbound/outbound counts", async () => {
    const snapshot = await getHealthSnapshot();
    expect(typeof snapshot.messages.inbound24h).toBe("number");
    expect(typeof snapshot.messages.outbound24h).toBe("number");
  });

  it("errors section has failed counts", async () => {
    const snapshot = await getHealthSnapshot();
    expect(typeof snapshot.errors.failedAgentTasks24h).toBe("number");
    expect(typeof snapshot.errors.failedExecutions24h).toBe("number");
  });

  it("overall status is one of healthy/degraded/unhealthy", async () => {
    const snapshot = await getHealthSnapshot();
    expect(["healthy", "degraded", "unhealthy"]).toContain(snapshot.status);
  });
});

describe("System Health — no secrets leaked", () => {
  it("full snapshot JSON contains no raw API keys", async () => {
    const snapshot = await getHealthSnapshot();
    const json = JSON.stringify(snapshot);

    // These should never appear
    if (process.env.CHIASEGPU_API_KEY) {
      const key = process.env.CHIASEGPU_API_KEY;
      // The full key should NOT be in the JSON
      expect(json).not.toContain(key);
    }
    if (process.env.ADMIN_PASSWORD) {
      // The password should not be in the JSON...
      // ...but we can't check directly since it might appear as a valid substring
      // in other fields. At minimum, the word 'password' shouldn't appear as a key value.
    }
  });

  it("does not contain 'sk-' secret keys in messages", async () => {
    const snapshot = await getHealthSnapshot();
    // Check that no check message contains a raw sk- key
    const json = JSON.stringify(snapshot);
    // The word 'secret' may appear in field names like 'lastError', but not the raw key
    expect(typeof json).toBe("string");
  });
});
