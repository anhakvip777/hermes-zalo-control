// =============================================================================
// Document Ingestion Tests — Batch 12.1 (Process Isolation) — Light version
// =============================================================================
// Heavy OOM-prone tests split into separate file with reduced Prisma usage.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { cleanDatabase } from "./shared-setup.js";
import { mkdir, writeFile } from "node:fs/promises";

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

describe("TXT direct ingestion (light)", () => {
  it("returns immediately with documentId + jobId + method=direct", async () => {
    const testPath = `${BASE_DIR}/direct-test.txt`;
    await writeFile(testPath, "# Test\n\nNội dung test.\n", "utf-8");

    const result = await docService.ingestDocument(testPath);
    expect(result.documentId).toBeDefined();
    expect(result.jobId).toBeDefined();
    expect(result.status).toBe("queued");
    expect(result.method).toBe("direct");
    expect(result.fileName).toBe("direct-test.txt");
  });

  it("MD ingestion returns method=direct", async () => {
    const testPath = `${BASE_DIR}/readme.md`;
    await writeFile(testPath, "## Hello\n\nWorld.\n", "utf-8");

    const result = await docService.ingestDocument(testPath);
    expect(result.method).toBe("direct");
  });
});

describe("Docling spawn isolation (light)", () => {
  it("returns immediately for PDF (doesn't block)", async () => {
    const testPath = `${BASE_DIR}/isolation-test.pdf`;
    await writeFile(testPath, "%PDF-1.4 fake", "utf-8");

    const start = Date.now();
    const result = await docService.ingestDocument(testPath);
    const elapsed = Date.now() - start;

    // Must return in < 1s (not waiting for docling)
    expect(elapsed).toBeLessThan(1000);
    expect(result.documentId).toBeDefined();
    expect(result.jobId).toBeDefined();
    expect(result.method).toBe("docling");
  });

  it("ingest fails for non-existent file", async () => {
    await expect(
      docService.ingestDocument(`${BASE_DIR}/ghost.pdf`),
    ).rejects.toThrow(/not found/i);
  });
});
