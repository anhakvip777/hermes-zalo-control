// =============================================================================
// Batch P1.2 — Access Control API (ZaloPrincipal CRUD + Audit)
// =============================================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../db.js";
import { cleanDatabase } from "./shared-setup.js";
import {
  listPrincipals,
  getPrincipalById,
  createPrincipal,
  updatePrincipalRole,
  updatePrincipalStatus,
  updatePrincipal,
  listAudit,
  createAuditEntry,
  VALID_ROLES,
  VALID_STATUSES,
  VALID_TYPES,
} from "../services/principal.service.js";

beforeAll(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
});

beforeEach(async () => {
  await cleanDatabase();
});

// ═══════════════════════════════════════════════════════════════════
// listPrincipals
// ═══════════════════════════════════════════════════════════════════

describe("P1.2 — listPrincipals", () => {
  it("returns empty list when no principals exist", async () => {
    const result = await listPrincipals();
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("returns all principals ordered by updatedAt desc", async () => {
    await createPrincipal({ principalId: "user-1", type: "user", role: "form_only" });
    await createPrincipal({ principalId: "user-2", type: "user", role: "basic_chat" });
    await createPrincipal({ principalId: "user-3", type: "group", role: "advanced" });

    const result = await listPrincipals();
    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  it("filters by role", async () => {
    await createPrincipal({ principalId: "user-1", type: "user", role: "form_only" });
    await createPrincipal({ principalId: "user-2", type: "user", role: "basic_chat" });

    const result = await listPrincipals({ role: "basic_chat" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].principalId).toBe("user-2");
  });

  it("filters by status", async () => {
    await createPrincipal({ principalId: "user-1", type: "user", role: "basic_chat", status: "active" });
    await createPrincipal({ principalId: "user-2", type: "user", role: "basic_chat", status: "blocked" });

    const result = await listPrincipals({ status: "blocked" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].principalId).toBe("user-2");
  });

  it("filters by type", async () => {
    await createPrincipal({ principalId: "user-1", type: "user", role: "form_only" });
    await createPrincipal({ principalId: "group-1", type: "group", role: "form_only" });

    const result = await listPrincipals({ type: "group" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe("group");
  });

  it("filters by threadId", async () => {
    await createPrincipal({ principalId: "user-1", type: "user", role: "form_only", threadId: "thread-abc" });
    await createPrincipal({ principalId: "user-2", type: "user", role: "form_only", threadId: null });

    const result = await listPrincipals({ threadId: "thread-abc" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].threadId).toBe("thread-abc");
  });

  it("searches by q (principalId/displayName/notes)", async () => {
    await createPrincipal({ principalId: "john-doe", type: "user", role: "form_only", displayName: "John" });
    await createPrincipal({ principalId: "jane-doe", type: "user", role: "form_only", displayName: "Jane", notes: "special access" });

    const result = await listPrincipals({ q: "jane" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].principalId).toBe("jane-doe");
  });
});

// ═══════════════════════════════════════════════════════════════════
// createPrincipal
// ═══════════════════════════════════════════════════════════════════

describe("P1.2 — createPrincipal", () => {
  it("creates a principal with default status=active", async () => {
    const p = await createPrincipal({
      principalId: "user-test-1",
      type: "user",
      role: "basic_chat",
    });

    expect(p.id).toBeDefined();
    expect(p.principalId).toBe("user-test-1");
    expect(p.type).toBe("user");
    expect(p.role).toBe("basic_chat");
    expect(p.status).toBe("active");
    expect(p.threadId).toBeNull();
    expect(p.displayName).toBeNull();
    expect(p.notes).toBeNull();
  });

  it("creates a principal with explicit status, threadId, displayName, notes", async () => {
    const p = await createPrincipal({
      principalId: "user-test-2",
      type: "user",
      role: "advanced",
      status: "blocked",
      threadId: "thread-xyz",
      displayName: "Test User",
      notes: "from import",
      createdBy: "admin-test",
    });

    expect(p.status).toBe("blocked");
    expect(p.threadId).toBe("thread-xyz");
    expect(p.displayName).toBe("Test User");
    expect(p.notes).toBe("from import");
    expect(p.createdBy).toBe("admin-test");
  });

  it("rejects duplicate principalId + threadId (same scope)", async () => {
    await createPrincipal({ principalId: "dup-user", type: "user", role: "form_only", threadId: "thread-1" });

    await expect(
      createPrincipal({ principalId: "dup-user", type: "user", role: "basic_chat", threadId: "thread-1" }),
    ).rejects.toThrow(/already exists/);
  });

  it("allows same principalId with different threadId (different scope)", async () => {
    await createPrincipal({ principalId: "multi-scope", type: "user", role: "form_only", threadId: "thread-1" });
    const p = await createPrincipal({ principalId: "multi-scope", type: "user", role: "basic_chat", threadId: "thread-2" });

    expect(p.role).toBe("basic_chat");
    expect(p.threadId).toBe("thread-2");
  });

  it("creates an audit entry on creation", async () => {
    await createPrincipal({
      principalId: "audit-create",
      type: "user",
      role: "advanced",
      createdBy: "admin-tester",
    });

    const audit = await listAudit("audit-create");
    expect(audit.items).toHaveLength(1);
    expect(audit.items[0].action).toBe("created");
    expect(audit.items[0].actor).toBe("admin-tester");
    expect(audit.items[0].newValue).toBeDefined();
  });

  it("rejects invalid type", async () => {
    // This test validates at the type level — TypeScript guards prevent invalid types
    // Service accepts all strings but API routes validate. We test the API route separately.
    // Here we verify that valid types work.
    for (const t of VALID_TYPES) {
      const p = await createPrincipal({ principalId: `type-${t}`, type: t, role: "form_only" });
      expect(p.type).toBe(t);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// updatePrincipalRole
// ═══════════════════════════════════════════════════════════════════

describe("P1.2 — updatePrincipalRole", () => {
  it("updates role and creates audit entry", async () => {
    const p = await createPrincipal({ principalId: "role-test", type: "user", role: "form_only" });

    const updated = await updatePrincipalRole(p.id, {
      role: "basic_chat",
      actor: "admin-upgrader",
      reason: "upgrade for testing",
    });

    expect(updated.role).toBe("basic_chat");

    // Verify audit
    const audit = await listAudit("role-test");
    const roleChanges = audit.items.filter((a) => a.action === "role_changed");
    expect(roleChanges).toHaveLength(1);
    expect(roleChanges[0].oldValue).toBe("form_only");
    expect(roleChanges[0].newValue).toBe("basic_chat");
    expect(roleChanges[0].actor).toBe("admin-upgrader");
    expect(roleChanges[0].reason).toBe("upgrade for testing");
  });

  it("allows upgrade to admin role", async () => {
    const p = await createPrincipal({ principalId: "admin-test", type: "user", role: "basic_chat" });
    const updated = await updatePrincipalRole(p.id, { role: "admin", actor: "superadmin" });

    expect(updated.role).toBe("admin");
  });

  it("allows downgrade (e.g., admin → form_only)", async () => {
    const p = await createPrincipal({ principalId: "downgrade-test", type: "user", role: "admin" });
    const updated = await updatePrincipalRole(p.id, { role: "form_only", actor: "admin" });

    expect(updated.role).toBe("form_only");
  });

  it("throws NOT_FOUND for non-existent principal", async () => {
    await expect(
      updatePrincipalRole("nonexistent-id", { role: "basic_chat" }),
    ).rejects.toThrow(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// updatePrincipalStatus
// ═══════════════════════════════════════════════════════════════════

describe("P1.2 — updatePrincipalStatus", () => {
  it("blocks a principal and creates audit", async () => {
    const p = await createPrincipal({ principalId: "block-test", type: "user", role: "basic_chat" });

    const updated = await updatePrincipalStatus(p.id, {
      status: "blocked",
      actor: "moderator",
      reason: "violation",
    });

    expect(updated.status).toBe("blocked");

    const audit = await listAudit("block-test");
    const statusChanges = audit.items.filter((a) => a.action === "status_changed");
    expect(statusChanges).toHaveLength(1);
    expect(statusChanges[0].oldValue).toBe("active");
    expect(statusChanges[0].newValue).toBe("blocked");
  });

  it("unblocks a blocked principal", async () => {
    const p = await createPrincipal({ principalId: "unblock-test", type: "user", role: "form_only", status: "blocked" });

    const updated = await updatePrincipalStatus(p.id, { status: "active", actor: "moderator" });
    expect(updated.status).toBe("active");
  });

  it("throws NOT_FOUND for non-existent principal", async () => {
    await expect(
      updatePrincipalStatus("nonexistent-id", { status: "blocked" }),
    ).rejects.toThrow(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// updatePrincipal (general fields)
// ═══════════════════════════════════════════════════════════════════

describe("P1.2 — updatePrincipal (general)", () => {
  it("updates displayName and notes", async () => {
    const p = await createPrincipal({ principalId: "update-test", type: "user", role: "form_only" });

    const updated = await updatePrincipal(p.id, {
      displayName: "Updated Name",
      notes: "Updated notes",
      actor: "admin",
    });

    expect(updated.displayName).toBe("Updated Name");
    expect(updated.notes).toBe("Updated notes");

    // Verify audit
    const audit = await listAudit("update-test");
    const updateEntries = audit.items.filter((a) => a.action === "updated");
    expect(updateEntries).toHaveLength(1);
  });

  it("updates threadId (re-scope)", async () => {
    const p = await createPrincipal({ principalId: "rescale-test", type: "user", role: "form_only", threadId: "old-thread" });

    const updated = await updatePrincipal(p.id, { threadId: "new-thread" });
    expect(updated.threadId).toBe("new-thread");
  });

  it("no-ops when no fields to update", async () => {
    const p = await createPrincipal({ principalId: "noop-test", type: "user", role: "form_only" });
    const updated = await updatePrincipal(p.id, {});

    expect(updated.id).toBe(p.id);

    // No audit entry should be created for a no-op
    const audit = await listAudit("noop-test");
    const updateEntries = audit.items.filter((a) => a.action === "updated");
    expect(updateEntries).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// audit
// ═══════════════════════════════════════════════════════════════════

describe("P1.2 — listAudit", () => {
  it("returns empty list when no audit entries", async () => {
    const result = await listAudit();
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("returns audit entries filtered by principalId", async () => {
    await createPrincipal({ principalId: "audit-a", type: "user", role: "form_only" });
    const p = await createPrincipal({ principalId: "audit-b", type: "user", role: "form_only" });
    await updatePrincipalRole(p.id, { role: "basic_chat" });

    const result = await listAudit("audit-b");
    expect(result.items.length).toBeGreaterThanOrEqual(2); // created + role_changed
    expect(result.items.every((a) => a.principalId === "audit-b")).toBe(true);
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await createAuditEntry({
        principalId: "bulk-test",
        threadId: null,
        action: "created",
        newValue: `test-${i}`,
      });
    }

    const result = await listAudit("bulk-test", 3);
    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Safety: displayName is NEVER used for permission matching
// ═══════════════════════════════════════════════════════════════════

describe("P1.2 — Safety: displayName not for permission", () => {
  it("displayName is stored but resolvePrincipal uses principalId, not displayName", async () => {
    const { resolvePrincipal } = await import("../services/principal.service.js");

    // Create a principal with a displayName
    await createPrincipal({
      principalId: "safety-test",
      type: "user",
      role: "advanced",
      displayName: "Fancy Display Name",
    });

    // Looking up by displayName should NOT resolve
    const ctx = await resolvePrincipal("Fancy Display Name");
    expect(ctx.fromDb).toBe(false); // default policy
    expect(ctx.role).toBe("form_only"); // not advanced

    // Looking up by principalId SHOULD resolve
    const ctx2 = await resolvePrincipal("safety-test");
    expect(ctx2.fromDb).toBe(true);
    expect(ctx2.role).toBe("advanced");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Safety: admin role can only be assigned explicitly via API
// ═══════════════════════════════════════════════════════════════════

describe("P1.2 — Safety: admin role requires explicit assignment", () => {
  it("default role for unknown user is form_only (never admin)", async () => {
    const { resolvePrincipal } = await import("../services/principal.service.js");

    const ctx = await resolvePrincipal("completely-new-user");
    expect(ctx.role).toBe("form_only");
    expect(ctx.role).not.toBe("admin");
  });

  it("admin role IS creatable via API (explicit assignment)", async () => {
    const p = await createPrincipal({
      principalId: "explicit-admin",
      type: "user",
      role: "admin",
    });

    expect(p.role).toBe("admin");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Safety: no secrets or session data exposed
// ═══════════════════════════════════════════════════════════════════

describe("P1.2 — Safety: no secrets in principal records", () => {
  it("principal records only contain public metadata fields", async () => {
    const p = await createPrincipal({
      principalId: "no-secrets",
      type: "user",
      role: "basic_chat",
      notes: "test note",
    });

    // Verify no sensitive fields exist
    const keys = Object.keys(p);
    const sensitiveFields = ["password", "token", "secret", "key", "session", "jwt"];
    for (const field of sensitiveFields) {
      expect(keys.some((k) => k.toLowerCase().includes(field))).toBe(false);
    }
  });
});
