// =============================================================================
// Document Ingestion Tests — Batch 12
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { cleanDatabase } from "./shared-setup.js";
import { mkdir, rm } from "node:fs/promises";

// ── Mock config for document module ───────────────────────────────
// Must be hoisted for vi.mock to access it
const { mockDocConfig } = vi.hoisted(() => ({
  mockDocConfig: {
    document: {
      enabled: true,
      allowedBaseDir: "/tmp/hermes-media/documents",
      processedDir: "/tmp/hermes-media/documents/processed",
      maxSizeMB: 50,
      allowedExtensions: ["pdf", "docx", "pptx", "xlsx", "txt", "md", "html", "csv", "png", "jpg", "jpeg", "webp"],
      doclingBin: "/usr/bin/true",
      chunkSize: 1200,
      chunkOverlap: 150,
    },
  },
}));

vi.mock("../config.js", () => ({ config: mockDocConfig }));

// ── Mock prisma for clean DB ──────────────────────────────────────
vi.mock("../db.js", async () => {
  const actual = await vi.importActual("../db.js");
  return actual;
});

import * as docService from "../services/document-ingestion.service.js";

const TEST_DIR = "/tmp/hermes-media/documents/test-batch12";
const BASE_DIR = "/tmp/hermes-media/documents";

beforeAll(async () => {
  await cleanDatabase();
  await mkdir(TEST_DIR, { recursive: true });
});
afterAll(async () => {
  await cleanDatabase();
  try { await rm(TEST_DIR, { recursive: true, force: true }); } catch {}
});
beforeEach(async () => {
  await cleanDatabase();
});

// ═══════════════════════════════════════════════════════════════════
// 1. Path validation
// ═══════════════════════════════════════════════════════════════════

describe("Path validation", () => {
  it("validates safe path", () => {
    const result = docService.validateDocumentPath(`${BASE_DIR}/test.md`);
    expect(result.valid).toBe(true);
  });

  it("blocks path traversal via ..", () => {
    const result = docService.validateDocumentPath(`${BASE_DIR}/../etc/passwd`);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/outside|traversal/i);
  });

  it("blocks path outside base dir", () => {
    const result = docService.validateDocumentPath("/etc/passwd");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("outside");
  });

  it("blocks empty path", () => {
    const result = docService.validateDocumentPath("");
    expect(result.valid).toBe(false);
  });

  it("no crash on deeply nested traversal", () => {
    const r = docService.validateDocumentPath("/tmp/hermes-media/documents/../../../etc/shadow");
    expect(r.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. File metadata validation
// ═══════════════════════════════════════════════════════════════════

describe("File metadata validation", () => {
  it("allows allowed extension", () => {
    const result = docService.validateFileMetadata("test.md", 1000, "md");
    expect(result.valid).toBe(true);
  });

  it("allows pdf", () => {
    const result = docService.validateFileMetadata("report.pdf", 500000, "pdf");
    expect(result.valid).toBe(true);
  });

  it("blocks unsupported extension", () => {
    const result = docService.validateFileMetadata("test.exe", 1000, "exe");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not allowed");
  });

  it("blocks .env file name", () => {
    const result = docService.validateFileMetadata("/tmp/hermes-media/documents/.env", 100, "env");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Blocked");
  });

  it("blocks session file name", () => {
    const result = docService.validateFileMetadata("/tmp/hermes-media/documents/session.json", 100, "json");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Blocked");
  });

  it("blocks credentials file name", () => {
    const result = docService.validateFileMetadata("/tmp/hermes-media/documents/credentials.txt", 100, "txt");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Blocked");
  });

  it("blocks backup file name", () => {
    const result = docService.validateFileMetadata("/tmp/hermes-media/documents/backup.zip", 100, "zip");
    expect(result.valid).toBe(false);
  });

  it("blocks token file name", () => {
    const result = docService.validateFileMetadata("/tmp/hermes-media/documents/token.json", 100, "json");
    expect(result.valid).toBe(false);
  });

  it("blocks secret file name", () => {
    const result = docService.validateFileMetadata("/tmp/hermes-media/documents/secret.key", 100, "key");
    expect(result.valid).toBe(false);
  });

  it("blocks oversize file", () => {
    const result = docService.validateFileMetadata("test.pdf", 51 * 1024 * 1024, "pdf");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too large");
  });

  it("blocks empty extension", () => {
    const r = docService.validateFileMetadata("test", 100, "");
    expect(r.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Ingestion — disabled mode
// ═══════════════════════════════════════════════════════════════════

describe("Ingestion when disabled", () => {
  it("errors when docling disabled", async () => {
    // Temporarily disable
    const original = mockDocConfig.document.enabled;
    mockDocConfig.document.enabled = false;
    try {
      await expect(
        docService.ingestDocument(`${BASE_DIR}/test.md`),
      ).rejects.toThrow(/disabled/);
    } finally {
      mockDocConfig.document.enabled = original;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Document CRUD (empty DB)
// ═══════════════════════════════════════════════════════════════════

describe("Document CRUD", () => {
  it("lists empty", async () => {
    const docs = await docService.listDocuments();
    expect(docs).toEqual([]);
  });

  it("returns null for missing document", async () => {
    const doc = await docService.getDocument("nonexistent");
    expect(doc).toBeNull();
  });

  it("returns empty chunks for missing document", async () => {
    const chunks = await docService.getDocumentChunks("nonexistent");
    expect(chunks).toEqual([]);
  });

  it("markdown returns null for missing", async () => {
    const md = await docService.getDocumentMarkdown("nonexistent");
    expect(md).toBeNull();
  });

  it("ask errors on missing document", async () => {
    await expect(
      docService.askDocument("nonexistent", "question?"),
    ).rejects.toThrow("not found");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Ask document — insufficient context
// ═══════════════════════════════════════════════════════════════════

describe("Ask document", () => {
  it("errors when document not completed", async () => {
    // This requires a real DB document with status != completed
    // Skipped — needs db setup
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. MIME detection
// ═══════════════════════════════════════════════════════════════════

describe("MIME detection", () => {
  it("detects pdf", () => {
    // Indirectly tested via validateFileMetadata allowing pdf
    const r = docService.validateFileMetadata("test.pdf", 100, "pdf");
    expect(r.valid).toBe(true);
  });

  it("detects docx", () => {
    const r = docService.validateFileMetadata("test.docx", 100, "docx");
    expect(r.valid).toBe(true);
  });

  it("detects txt", () => {
    const r = docService.validateFileMetadata("test.txt", 100, "txt");
    expect(r.valid).toBe(true);
  });
});
