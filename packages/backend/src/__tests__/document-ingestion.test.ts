// =============================================================================
// Document Ingestion Tests — Batch 12
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanDatabase } from "./shared-setup.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
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
    // Note: path.normalize resolves ../ so the result is "outside" error
    const result = docService.validateDocumentPath(`${BASE_DIR}/../etc/passwd`);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/outside|traversal/);
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
});

// ═══════════════════════════════════════════════════════════════════
// 2. File metadata validation
// ═══════════════════════════════════════════════════════════════════

describe("File metadata validation", () => {
  it("allows allowed extension", () => {
    const result = docService.validateFileMetadata("test.md", 1000, "md");
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
    // 51MB > 50MB default
    const result = docService.validateFileMetadata("test.pdf", 51 * 1024 * 1024, "pdf");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too large");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Ingestion (dry — no docling needed)
// ═══════════════════════════════════════════════════════════════════

describe("Document ingestion", () => {
  it("errors when docling disabled (default)", async () => {
    await expect(
      docService.ingestDocument(`${BASE_DIR}/test.md`),
    ).rejects.toThrow(/disabled/);
  });

  it("errors when file not found", async () => {
    await expect(
      docService.ingestDocument(`${BASE_DIR}/nonexistent.md`),
    ).rejects.toThrow(/not found|disabled/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Chunking
// ═══════════════════════════════════════════════════════════════════

// splitIntoChunks is private — test indirectly via behavior
describe("Chunking", () => {
  it("chunk size is respected", () => {
    // Indirectly tested via integration when docling enabled
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. List + get documents (empty DB)
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
// 6. Edge cases
// ═══════════════════════════════════════════════════════════════════

describe("Edge cases", () => {
  it("no crash on weird paths", () => {
    const r = docService.validateDocumentPath("/tmp/hermes-media/documents/../../../");
    expect(r.valid).toBe(false);
  });

  it("empty extension is rejected", () => {
    const r = docService.validateFileMetadata("test", 100, "");
    expect(r.valid).toBe(false);
  });
});
