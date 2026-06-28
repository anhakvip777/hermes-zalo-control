// =============================================================================
// Document Ingestion Tests — Batch 12.1 (Process Isolation)
// =============================================================================
// Fix Batch 12.1 changes:
// - ingestDocument creates Document + Job (queued), returns immediately
// - NO background processing in API — worker picks up queued jobs
// - TXT/MD/CSV: direct text processing (called by worker, not API)
// - Docling: spawn with hard timeout (called by worker, not API)

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { cleanDatabase } from "./shared-setup.js";
import { mkdir, rm, writeFile } from "node:fs/promises";

// ── Mock config ───────────────────────────────────────────────────
const { mockDocConfig } = vi.hoisted(() => ({
  mockDocConfig: {
    document: {
      enabled: true,
      allowedBaseDir: "/tmp/hermes-media/documents",
      processedDir: "/tmp/hermes-media/documents/processed",
      maxSizeMB: 50,
      allowedExtensions: ["pdf", "docx", "pptx", "xlsx", "txt", "md", "html", "csv", "png", "jpg", "jpeg", "webp"],
      doclingBin: "/usr/bin/true",
      doclingTimeoutMs: 5000,
      doclingKillGraceMs: 1000,
      doclingMaxOutputBytes: 1048576,
      chunkSize: 1200,
      chunkOverlap: 150,
    },
  },
}));

vi.mock("../config.js", () => ({ config: mockDocConfig }));

vi.mock("../db.js", async () => {
  const actual = await vi.importActual("../db.js");
  return actual;
});

import * as docService from "../services/document-ingestion.service.js";

const BASE_DIR = "/tmp/hermes-media/documents";

beforeAll(async () => {
  await cleanDatabase();
  await mkdir(BASE_DIR, { recursive: true });
  await mkdir(`${BASE_DIR}/processed`, { recursive: true });
});
afterAll(async () => {
  await cleanDatabase();
});
beforeEach(async () => {
  await cleanDatabase();
});

// ═══════════════════════════════════════════════════════════════════
// 1. Path validation
// ═══════════════════════════════════════════════════════════════════

describe("Path validation", () => {
  it("validates safe path", () => {
    expect(docService.validateDocumentPath(`${BASE_DIR}/test.md`).valid).toBe(true);
  });
  it("blocks path traversal via ..", () => {
    const r = docService.validateDocumentPath(`${BASE_DIR}/../etc/passwd`);
    expect(r.valid).toBe(false);
  });
  it("blocks empty path", () => {
    expect(docService.validateDocumentPath("").valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. File metadata validation
// ═══════════════════════════════════════════════════════════════════

describe("File metadata validation", () => {
  it("allows txt extension", () => {
    expect(docService.validateFileMetadata("test.txt", 100, "txt").valid).toBe(true);
  });
  it("allows pdf extension", () => {
    expect(docService.validateFileMetadata("report.pdf", 500000, "pdf").valid).toBe(true);
  });
  it("blocks .env", () => {
    const r = docService.validateFileMetadata(".env", 100, "env");
    expect(r.valid).toBe(false);
  });
  it("blocks session", () => {
    const r = docService.validateFileMetadata("session.json", 100, "json");
    expect(r.valid).toBe(false);
  });
  it("blocks oversize", () => {
    const r = docService.validateFileMetadata("test.pdf", 51 * 1024 * 1024, "pdf");
    expect(r.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Ingest API — enqueue only (NO background processing)
// ═══════════════════════════════════════════════════════════════════

describe("Ingest API (enqueue only)", () => {
  it("returns immediately with documentId + jobId + status=queued", async () => {
    await writeFile(`${BASE_DIR}/api-test.txt`, "# Test\nNội dung.\n", "utf-8");

    const result = await docService.ingestDocument(`${BASE_DIR}/api-test.txt`);
    expect(result.documentId).toBeDefined();
    expect(result.jobId).toBeDefined();
    expect(result.status).toBe("queued");       // NOT "processing"
    expect(result.method).toBe("direct");
    expect(result.fileName).toBe("api-test.txt");
  });

  it("returns queued for PDF (does not call docling)", async () => {
    await writeFile(`${BASE_DIR}/api-test.pdf`, "%PDF-1.4 fake", "utf-8");

    const start = Date.now();
    const result = await docService.ingestDocument(`${BASE_DIR}/api-test.pdf`);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);  // Must return FAST (< 500ms)
    expect(result.status).toBe("queued");
    expect(result.method).toBe("docling");
  });

  it("document record has status=processing (ready for worker)", async () => {
    await writeFile(`${BASE_DIR}/doc-status.txt`, "test", "utf-8");
    const result = await docService.ingestDocument(`${BASE_DIR}/doc-status.txt`);

    const doc = await docService.getDocument(result.documentId);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe("processing"); // Document is "processing", job is "queued"
  });

  it("job record has status=queued", async () => {
    await writeFile(`${BASE_DIR}/job-status.txt`, "test", "utf-8");
    const result = await docService.ingestDocument(`${BASE_DIR}/job-status.txt`);

    const jobs = await docService.getDocumentJobs(result.documentId);
    expect(jobs.length).toBe(1);
    expect(jobs[0]!.status).toBe("queued");
  });

  it("errors when disabled", async () => {
    const orig = mockDocConfig.document.enabled;
    mockDocConfig.document.enabled = false;
    try {
      await expect(
        docService.ingestDocument(`${BASE_DIR}/test.txt`),
      ).rejects.toThrow(/disabled/);
    } finally {
      mockDocConfig.document.enabled = orig;
    }
  });

  it("errors for non-existent file", async () => {
    await expect(
      docService.ingestDocument(`${BASE_DIR}/ghost.txt`),
    ).rejects.toThrow(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Document CRUD
// ═══════════════════════════════════════════════════════════════════

describe("Document CRUD", () => {
  it("lists empty", async () => {
    expect(await docService.listDocuments()).toEqual([]);
  });
  it("returns null for missing", async () => {
    expect(await docService.getDocument("nonexistent")).toBeNull();
  });
  it("returns empty chunks for missing", async () => {
    expect(await docService.getDocumentChunks("nonexistent")).toEqual([]);
  });
  it("returns empty jobs for missing", async () => {
    expect(await docService.getDocumentJobs("nonexistent")).toEqual([]);
  });
  it("ask errors on missing", async () => {
    await expect(
      docService.askDocument("nonexistent", "q?"),
    ).rejects.toThrow("not found");
  });
});
