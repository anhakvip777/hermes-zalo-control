import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BACKEND_ROOT,
  BACKUPS_DIR,
  PRISMA_DIR,
  resolveSqliteDatabasePath,
} from "../backend-paths.js";

describe("backend path resolution", () => {
  it("derives package-owned directories from the module location", () => {
    const expectedBackendRoot = resolve(import.meta.dirname, "../..");

    expect(BACKEND_ROOT).toBe(expectedBackendRoot);
    expect(PRISMA_DIR).toBe(resolve(expectedBackendRoot, "prisma"));
    expect(BACKUPS_DIR).toBe(resolve(expectedBackendRoot, "backups"));
  });

  it("resolves a relative SQLite URL from the Prisma schema directory without consulting cwd", () => {
    const cwd = vi.spyOn(process, "cwd").mockImplementation(() => {
      throw new Error("process.cwd() must not be consulted");
    });

    try {
      expect(resolveSqliteDatabasePath("file:./test.db")).toBe(resolve(PRISMA_DIR, "test.db"));
    } finally {
      cwd.mockRestore();
    }
  });

  it("preserves an absolute SQLite path", () => {
    const absolutePath = resolve(PRISMA_DIR, "isolated-test.db");

    expect(resolveSqliteDatabasePath(`file:${absolutePath}`)).toBe(absolutePath);
  });

  it.each(["", "file:", "file::memory:", "postgresql://localhost/hermes"])(
    "returns null for a non-file-backed database URL (%j)",
    (databaseUrl) => {
      expect(resolveSqliteDatabasePath(databaseUrl)).toBeNull();
    },
  );
});
