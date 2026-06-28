// =============================================================================
// Batch 13 Tests — Document UI Polish + Zalo File Ingestion
// =============================================================================

import { describe, it, expect } from "vitest";
import { validateDocumentPath, validateFileMetadata } from "../services/document-ingestion.service.js";
import { normalizeMessage } from "../services/zalo-receive.js";

// ═══════════════════════════════════════════════════════════════════
// Zalo File Detection
// ═══════════════════════════════════════════════════════════════════

describe("Zalo file message detection", () => {
  it("detects chat.file type with attach data", () => {
    const raw = {
      type: "Group",
      threadId: "thread-1",
      data: {
        type: "chat.file",
        msgType: "chat.file",
        content: { href: "https://zalo.example.com/file.pdf" },
        attach: {
          href: "https://zalo.example.com/file.pdf",
          fileName: "document.pdf",
          fileSize: 1024,
        },
      },
    };
    const msg = normalizeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.messageType).toBe("file");
    expect(msg!.fileUrl).toBe("https://zalo.example.com/file.pdf");
    expect(msg!.fileName).toBe("document.pdf");
    expect(msg!.fileExtension).toBe("pdf");
  });

  it("detects chat.document type", () => {
    const raw = {
      type: "Group",
      threadId: "thread-1",
      data: {
        type: "chat.document",
        content: "https://zalo.example.com/report.docx",
        attach: {
          href: "https://zalo.example.com/report.docx",
          fileName: "report.docx",
        },
      },
    };
    const msg = normalizeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.messageType).toBe("file");
    expect(msg!.fileExtension).toBe("docx");
  });

  it("detects file from content URL string", () => {
    const raw = {
      type: "Group",
      threadId: "thread-1",
      data: {
        type: "chat.file",
        content: "https://zalo.example.com/data.csv",
      },
    };
    const msg = normalizeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.messageType).toBe("file");
    expect(msg!.fileUrl).toBe("https://zalo.example.com/data.csv");
  });

  it("does NOT misclassify text messages as file", () => {
    const raw = {
      type: "User",
      threadId: "dm-1",
      data: {
        type: "chat.message",
        content: "Hello, this is a text message",
      },
    };
    const msg = normalizeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.messageType).not.toBe("file");
    expect(msg!.messageType).not.toBe("image");
  });

  it("extracts extension from filename", () => {
    const raw = {
      type: "Group",
      threadId: "thread-1",
      data: {
        type: "chat.file",
        attach: {
          href: "https://zalo.example.com/file",
          fileName: "TaiLieu.PDF",
        },
      },
    };
    const msg = normalizeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.fileExtension).toBe("pdf");
  });

  it("handles file without extension", () => {
    const raw = {
      type: "Group",
      threadId: "thread-1",
      data: {
        type: "chat.file",
        attach: {
          href: "https://zalo.example.com/file",
          fileName: "README",
        },
      },
    };
    const msg = normalizeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.fileExtension).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// File validation guards
// ═══════════════════════════════════════════════════════════════════

describe("File validation guards", () => {
  it("allows valid extensions", () => {
    const result = validateFileMetadata("/tmp/documents/test.pdf", 1024, "pdf");
    expect(result.valid).toBe(true);
  });

  it("allows docx extension", () => {
    const result = validateFileMetadata("/tmp/documents/report.docx", 2048, "docx");
    expect(result.valid).toBe(true);
  });

  it("allows txt extension", () => {
    const result = validateFileMetadata("/tmp/documents/notes.txt", 100, "txt");
    expect(result.valid).toBe(true);
  });

  it("blocks unsupported extension", () => {
    const result = validateFileMetadata("/tmp/documents/virus.exe", 1024, "exe");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not allowed");
  });

  it("blocks oversized files", () => {
    // 51MB file with 50MB limit
    const result = validateFileMetadata("/tmp/documents/big.pdf", 51 * 1024 * 1024, "pdf");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too large");
  });

  it("blocks sensitive filenames", () => {
    const result = validateFileMetadata("/tmp/documents/.env", 100, "txt");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Blocked");
  });

  it("blocks session filenames", () => {
    const result = validateFileMetadata("/tmp/documents/session.json", 200, "json");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Blocked");
  });

  it("blocks path traversal", () => {
    const result = validateDocumentPath("/tmp/hermes-media/documents/../../../etc/passwd");
    expect(result.valid).toBe(false);
    // Normalize resolves ../ before the check, so it becomes "outside allowed base directory"
    expect(result.error).toContain("outside allowed");
  });

  it("blocks path outside safe dir", () => {
    const result = validateDocumentPath("/etc/hosts");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("outside allowed");
  });

  it("allows valid path inside safe dir", () => {
    const result = validateDocumentPath("/tmp/hermes-media/documents/valid.pdf");
    expect(result.valid).toBe(true);
  });
});
