// =============================================================================
// Batch P1.1 — Zalo Principal Permission Gate (RBAC)
// =============================================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../db.js";
import { cleanDatabase } from "./shared-setup.js";
import {
  resolvePrincipal,
  checkPermission,
  isBlocked,
  logPermissionDecision,
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
// resolvePrincipal — lookup & default policy
// ═══════════════════════════════════════════════════════════════════

describe("P1.1 — resolvePrincipal (lookup + default policy)", () => {
  it("unknown user without DB record → form_only (default)", async () => {
    const ctx = await resolvePrincipal("unknown-user-999");
    expect(ctx.role).toBe("form_only");
    expect(ctx.status).toBe("active");
    expect(ctx.fromDb).toBe(false);
    expect(ctx.principal).toBeNull();
  });

  it("unknown user with threadId → still form_only default", async () => {
    const ctx = await resolvePrincipal("unknown-user-999", "thread-abc");
    expect(ctx.role).toBe("form_only");
    expect(ctx.fromDb).toBe(false);
  });

  it("empty senderId → form_only default, no crash", async () => {
    const ctx = await resolvePrincipal("");
    expect(ctx.role).toBe("form_only");
    expect(ctx.status).toBe("active");
    expect(ctx.fromDb).toBe(false);
  });

  it("global principal match (threadId=null in DB)", async () => {
    await prisma.zaloPrincipal.create({
      data: {
        principalId: "user-global",
        role: "basic_chat",
        status: "active",
        threadId: null,
      },
    });
    const ctx = await resolvePrincipal("user-global", "some-thread");
    expect(ctx.role).toBe("basic_chat");
    expect(ctx.fromDb).toBe(true);
  });

  it("thread-scoped principal overrides global", async () => {
    await prisma.zaloPrincipal.create({
      data: {
        principalId: "user-scoped",
        role: "basic_chat",
        status: "active",
        threadId: null, // global
      },
    });
    await prisma.zaloPrincipal.create({
      data: {
        principalId: "user-scoped",
        role: "advanced",
        status: "active",
        threadId: "thread-x", // scoped — higher priority
      },
    });

    const globalCtx = await resolvePrincipal("user-scoped", "thread-y");
    expect(globalCtx.role).toBe("basic_chat"); // global fallback

    const scopedCtx = await resolvePrincipal("user-scoped", "thread-x");
    expect(scopedCtx.role).toBe("advanced"); // thread-scoped wins
  });

  it("blocked principal returns status=blocked", async () => {
    await prisma.zaloPrincipal.create({
      data: {
        principalId: "user-blocked",
        role: "basic_chat",
        status: "blocked",
      },
    });
    const ctx = await resolvePrincipal("user-blocked");
    expect(ctx.status).toBe("blocked");
    expect(ctx.role).toBe("basic_chat");
    expect(ctx.fromDb).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// checkPermission — role matrix
// ═══════════════════════════════════════════════════════════════════

describe("P1.1 — checkPermission (role matrix)", () => {
  it("form_only allows fixed_reply", () => {
    const r = checkPermission("form_only", "fixed_reply");
    expect(r.allowed).toBe(true);
  });

  it("form_only allows rule_match", () => {
    const r = checkPermission("form_only", "rule_match");
    expect(r.allowed).toBe(true);
  });

  it("form_only denies hermes_chat", () => {
    const r = checkPermission("form_only", "hermes_chat");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("permission_denied");
    expect(r.requiredRole).toBe("basic_chat");
  });

  it("form_only denies document_ask", () => {
    const r = checkPermission("form_only", "document_ask");
    expect(r.allowed).toBe(false);
    expect(r.requiredRole).toBe("advanced");
  });

  it("basic_chat allows hermes_chat", () => {
    const r = checkPermission("basic_chat", "hermes_chat");
    expect(r.allowed).toBe(true);
  });

  it("basic_chat allows ocr_followup", () => {
    const r = checkPermission("basic_chat", "ocr_followup");
    expect(r.allowed).toBe(true);
  });

  it("basic_chat denies document_ask", () => {
    const r = checkPermission("basic_chat", "document_ask");
    expect(r.allowed).toBe(false);
    expect(r.requiredRole).toBe("advanced");
  });

  it("basic_chat denies create_reminder", () => {
    const r = checkPermission("basic_chat", "create_reminder");
    expect(r.allowed).toBe(false);
    expect(r.requiredRole).toBe("advanced");
  });

  it("advanced allows document_ask", () => {
    const r = checkPermission("advanced", "document_ask");
    expect(r.allowed).toBe(true);
  });

  it("advanced allows create_reminder", () => {
    const r = checkPermission("advanced", "create_reminder");
    expect(r.allowed).toBe(true);
  });

  it("advanced denies manage_rules", () => {
    const r = checkPermission("advanced", "manage_rules");
    expect(r.allowed).toBe(false);
    expect(r.requiredRole).toBe("admin");
  });

  it("admin allows manage_rules", () => {
    const r = checkPermission("admin", "manage_rules");
    expect(r.allowed).toBe(true);
  });

  it("admin allows runtime_settings", () => {
    const r = checkPermission("admin", "runtime_settings");
    expect(r.allowed).toBe(true);
  });

  it("admin allows live_test", () => {
    const r = checkPermission("admin", "live_test");
    expect(r.allowed).toBe(true);
  });

  it("admin allows all actions", () => {
    for (const action of [
      "fixed_reply", "rule_match", "faq",
      "hermes_chat", "ocr_followup",
      "document_ask", "create_reminder", "context_memory",
      "manage_rules", "manage_principals", "runtime_settings",
      "live_test", "view_errors", "document_ingest",
    ]) {
      const r = checkPermission("admin", action);
      expect(r.allowed).toBe(true);
    }
  });

  it("unknown action defaults to allowed", () => {
    const r = checkPermission("form_only", "some_unknown_action_xyz");
    expect(r.allowed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// isBlocked
// ═══════════════════════════════════════════════════════════════════

describe("P1.1 — isBlocked", () => {
  it("returns true for 'blocked'", () => {
    expect(isBlocked("blocked")).toBe(true);
  });

  it("returns false for 'active'", () => {
    expect(isBlocked("active")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Safety: displayName NOT used for permission
// ═══════════════════════════════════════════════════════════════════

describe("P1.1 — displayName safety", () => {
  it("displayName is NEVER checked in resolvePrincipal", async () => {
    // Create principal with displayName "admin" but role form_only
    await prisma.zaloPrincipal.create({
      data: {
        principalId: "user-tricky",
        role: "form_only",
        status: "active",
        displayName: "Admin User", // misleading displayName
      },
    });
    const ctx = await resolvePrincipal("user-tricky");
    // Should be form_only, NOT admin — displayName ignored
    expect(ctx.role).toBe("form_only");
    expect(ctx.role).not.toBe("admin");
  });

  it("senderId is the only key for permission matching", async () => {
    await prisma.zaloPrincipal.create({
      data: {
        principalId: "real-user-1",
        role: "advanced",
        status: "active",
        displayName: "Someone",
      },
    });
    // Different senderId with same displayName → should not match
    const ctx = await resolvePrincipal("different-sender-2");
    expect(ctx.role).toBe("form_only"); // default, not advanced
    expect(ctx.fromDb).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Audit logging
// ═══════════════════════════════════════════════════════════════════

describe("P1.1 — logPermissionDecision", () => {
  it("does not throw on valid input", () => {
    expect(() =>
      logPermissionDecision({
        allowed: false,
        reason: "permission_denied",
        currentRole: "form_only",
        requiredRole: "basic_chat",
        action: "hermes_chat",
        senderId: "user-1",
        threadId: "thread-1",
      }),
    ).not.toThrow();
  });

  it("does not throw when threadType omitted", () => {
    expect(() =>
      logPermissionDecision({
        allowed: false,
        reason: "permission_denied",
        currentRole: "form_only",
        action: "hermes_chat",
        senderId: "user-1",
        threadId: "thread-1",
      }),
    ).not.toThrow();
  });

  it("skips logging for allowed decisions", () => {
    // Should not log for allowed — just verify no throw
    expect(() =>
      logPermissionDecision({
        allowed: true,
        currentRole: "advanced",
        action: "document_ask",
        senderId: "user-1",
        threadId: "thread-1",
      }),
    ).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════
// DB operations sanity
// ═══════════════════════════════════════════════════════════════════

describe("P1.1 — ZaloPrincipal CRUD", () => {
  it("can create and read a principal", async () => {
    const created = await prisma.zaloPrincipal.create({
      data: {
        principalId: "crud-test-user",
        role: "advanced",
        status: "active",
        threadId: "t1",
        notes: "test note",
        createdBy: "admin",
      },
    });
    expect(created.id).toBeTruthy();
    expect(created.principalId).toBe("crud-test-user");
    expect(created.role).toBe("advanced");

    const found = await prisma.zaloPrincipal.findUnique({
      where: { id: created.id },
    });
    expect(found?.role).toBe("advanced");
  });

  it("enforces unique(principalId, threadId)", async () => {
    await prisma.zaloPrincipal.create({
      data: { principalId: "dup-test", role: "basic_chat", threadId: "t1" },
    });
    await expect(
      prisma.zaloPrincipal.create({
        data: { principalId: "dup-test", role: "advanced", threadId: "t1" },
      }),
    ).rejects.toThrow();
  });
});
