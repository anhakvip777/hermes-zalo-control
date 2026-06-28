// =============================================================================
// Document Ingestion Service — Docling-powered document understanding
// =============================================================================

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, access, stat, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, extname, resolve, normalize, relative, dirname } from "node:path";
import { config } from "../config.js";
import { prisma } from "../db.js";

const execAsync = promisify(exec);

// ── Types ──────────────────────────────────────────────────────────

export interface DocumentOutput {
  id: string;
  fileName: string;
  originalPath: string;
  mimeType: string | null;
  extension: string;
  sizeBytes: number;
  sha256: string;
  status: string;
  markdownPath: string | null;
  textPreview: string | null;
  provider: string;
  errorCode: string | null;
  errorMessage: string | null;
  source: string | null;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentChunkOutput {
  id: string;
  documentId: string;
  chunkIndex: number;
  heading: string | null;
  text: string;
  pageStart: number | null;
  pageEnd: number | null;
  tokenEstimate: number | null;
  metadata: Record<string, unknown> | null;
}

export interface AskResult {
  question: string;
  answer: string;
  chunksUsed: number;
  provider: string;
}

// ── Blocked path patterns ──────────────────────────────────────────

const BLOCKED_NAME_PATTERNS = [
  /^\.env/i, /\.env$/i,
  /session/i, /credentials/i, /backup/i,
  /token/i, /secret/i, /key$/i, /\.key$/i,
  /passwd/i, /shadow/i,
];

// ── Validation ─────────────────────────────────────────────────────

export function validateDocumentPath(filePath: string): { valid: boolean; error?: string } {
  if (!filePath || filePath.trim().length === 0) {
    return { valid: false, error: "Path is empty" };
  }

  // Double-dot check (must check BEFORE resolve, which normalizes ../)
  const normalized = normalize(filePath);
  if (normalized.includes("..")) {
    return { valid: false, error: "Path traversal detected (..)" };
  }

  const resolved = resolve(normalized);
  const baseDir = resolve(config.document.allowedBaseDir);

  // Path traversal check (resolved must be inside base dir)
  if (!resolved.startsWith(baseDir + "/") && resolved !== baseDir) {
    return { valid: false, error: `Path outside allowed base directory: ${baseDir}` };
  }

  return { valid: true };
}

export function validateFileMetadata(
  filePath: string,
  sizeBytes: number,
  extension: string,
): { valid: boolean; error?: string } {
  // File name check (must come before extension check so blocked names
  // like .env or session.json are caught even if extension is valid)
  const fileName = basename(filePath);
  for (const pattern of BLOCKED_NAME_PATTERNS) {
    if (pattern.test(fileName)) {
      return { valid: false, error: `Blocked file name pattern: ${fileName}` };
    }
  }

  // Extension check
  const ext = extension.toLowerCase().replace(/^\./, "");
  if (!config.document.allowedExtensions.includes(ext)) {
    return {
      valid: false,
      error: `Extension ".${ext}" not allowed. Allowed: ${config.document.allowedExtensions.join(", ")}`,
    };
  }

  // Size check
  const maxBytes = config.document.maxSizeMB * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    return {
      valid: false,
      error: `File too large: ${(sizeBytes / 1024 / 1024).toFixed(1)}MB > ${config.document.maxSizeMB}MB`,
    };
  }

  return { valid: true };
}

// ── MIME type detection ────────────────────────────────────────────

function detectMimeType(extension: string): string {
  const mimeMap: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain",
    md: "text/markdown",
    html: "text/html",
    csv: "text/csv",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  return mimeMap[extension.toLowerCase()] ?? "application/octet-stream";
}

// ── DB helpers ─────────────────────────────────────────────────────

function dbDocToOutput(doc: {
  id: string; fileName: string; originalPath: string; mimeType: string | null;
  extension: string; sizeBytes: number; sha256: string; status: string;
  markdownPath: string | null; textPreview: string | null; provider: string;
  errorCode: string | null; errorMessage: string | null; source: string | null;
  threadId: string | null; createdAt: Date; updatedAt: Date;
}): DocumentOutput {
  return {
    id: doc.id, fileName: doc.fileName, originalPath: doc.originalPath,
    mimeType: doc.mimeType, extension: doc.extension, sizeBytes: doc.sizeBytes,
    sha256: doc.sha256, status: doc.status, markdownPath: doc.markdownPath,
    textPreview: doc.textPreview, provider: doc.provider,
    errorCode: doc.errorCode, errorMessage: doc.errorMessage,
    source: doc.source, threadId: doc.threadId,
    createdAt: doc.createdAt.toISOString(), updatedAt: doc.updatedAt.toISOString(),
  };
}

// ── CRUD ────────────────────────────────────────────────────────────

export async function listDocuments(limit = 50): Promise<DocumentOutput[]> {
  const docs = await prisma.document.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return docs.map(dbDocToOutput);
}

export async function getDocument(id: string): Promise<DocumentOutput | null> {
  const doc = await prisma.document.findUnique({ where: { id } });
  return doc ? dbDocToOutput(doc) : null;
}

export async function getDocumentMarkdown(id: string): Promise<string | null> {
  const doc = await prisma.document.findUnique({ where: { id }, select: { markdownPath: true } });
  if (!doc?.markdownPath) return null;
  try {
    return await readFile(doc.markdownPath, "utf-8");
  } catch {
    return null;
  }
}

export async function getDocumentChunks(id: string): Promise<DocumentChunkOutput[]> {
  const chunks = await prisma.documentChunk.findMany({
    where: { documentId: id },
    orderBy: { chunkIndex: "asc" },
  });
  return chunks.map((c) => ({
    id: c.id, documentId: c.documentId, chunkIndex: c.chunkIndex,
    heading: c.heading, text: c.text, pageStart: c.pageStart,
    pageEnd: c.pageEnd, tokenEstimate: c.tokenEstimate,
    metadata: safeJson(c.metadata),
  }));
}

// ── Ingestion pipeline ─────────────────────────────────────────────

export async function ingestDocument(
  filePath: string,
  options?: { source?: string; threadId?: string; messageId?: string },
): Promise<DocumentOutput> {
  const cfg = config.document;

  if (!cfg.enabled) {
    throw new Error("Document ingestion is disabled (DOCUMENT_INGEST_ENABLED=false)");
  }

  // 1. Validate path
  const pathCheck = validateDocumentPath(filePath);
  if (!pathCheck.valid) throw new Error(pathCheck.error);

  // 2. Read file metadata
  const resolved = resolve(filePath);
  let fileStat;
  try {
    fileStat = await stat(resolved);
  } catch {
    throw new Error(`File not found: ${resolved}`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`Not a regular file: ${resolved}`);
  }

  const fileName = basename(resolved);
  const extension = extname(resolved).slice(1).toLowerCase();
  const sizeBytes = fileStat.size;

  // 3. Validate metadata
  const metaCheck = validateFileMetadata(resolved, sizeBytes, extension);
  if (!metaCheck.valid) throw new Error(metaCheck.error);

  // 4. Compute SHA256
  const fileBuffer = await readFile(resolved);
  const sha256 = createHash("sha256").update(fileBuffer).digest("hex");

  // 5. Create document record
  const mimeType = detectMimeType(extension);
  const doc = await prisma.document.create({
    data: {
      fileName,
      originalPath: resolved,
      mimeType,
      extension,
      sizeBytes,
      sha256,
      status: "processing",
      provider: "docling",
      source: options?.source ?? null,
      threadId: options?.threadId ?? null,
      messageId: options?.messageId ?? null,
    },
  });

  // 6. Create ingestion job
  const job = await prisma.documentIngestionJob.create({
    data: {
      documentId: doc.id,
      status: "processing",
      startedAt: new Date(),
    },
  });

  // 7. Run Docling
  try {
    await mkdir(cfg.processedDir, { recursive: true });

    const doclingBin = cfg.doclingBin;
    console.log(`[docling] config: enabled=${cfg.enabled} bin=${cfg.doclingBin} baseDir=${cfg.allowedBaseDir} processedDir=${cfg.processedDir}`);
    const outputFile = `${cfg.processedDir}/${doc.id}.md`;

    console.log(`[docling] running: ${doclingBin} "${resolved}" --to md --output "${cfg.processedDir}"`);
    const cmd = `${doclingBin} ${resolved} --to md --output ${cfg.processedDir}`;
    const { stdout: doclingStdout, stderr: doclingStderr } = await execAsync(cmd, { 
      timeout: 120_000, maxBuffer: 10 * 1024 * 1024,
      cwd: cfg.processedDir,
    });

    if (doclingStderr && !doclingStderr.includes("INFO")) {
      console.warn(`[docling] stderr: ${doclingStderr.slice(0, 200)}`);
    }

    // Docling outputs as <input-basename>.md in the output directory
    // Docling always appends .md; if input already has .md, output is <name>.md (not doubled)
    const outputName = fileName.endsWith(".md") ? fileName : `${fileName}.md`;
    const doclingOutput = `${cfg.processedDir}/${outputName}`;

    let markdownContent: string | null = null;
    let actualOutputPath: string | null = null;

    // Retry up to 3 times with 500ms delay (file may not be flushed immediately)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        markdownContent = await readFile(doclingOutput, "utf-8");
        actualOutputPath = doclingOutput;
        break;
      } catch {
        if (attempt < 2) await new Promise(r => setTimeout(r, 500));
      }
    }

    if (!markdownContent) {
      // Docling might have succeeded but output is in a different location
      throw new Error("Docling produced no readable markdown output");
    }

    // 8. Update document record
    const textPreview = markdownContent.slice(0, 500);
    await prisma.document.update({
      where: { id: doc.id },
      data: {
        status: "completed",
        markdownPath: actualOutputPath,
        textPreview,
      },
    });

    // 9. Create chunks
    const chunks = splitIntoChunks(markdownContent, cfg.chunkSize, cfg.chunkOverlap);
    for (let i = 0; i < chunks.length; i++) {
      await prisma.documentChunk.create({
        data: {
          documentId: doc.id,
          chunkIndex: i,
          heading: chunks[i]!.heading ?? null,
          text: chunks[i]!.text,
          tokenEstimate: Math.ceil(chunks[i]!.text.length / 4),
          metadata: JSON.stringify({
            source: "docling",
            charStart: chunks[i]!.charStart,
            charEnd: chunks[i]!.charEnd,
          }),
        },
      });
    }

    console.log(`[docling] ingested: ${fileName} → ${doc.id} (${chunks.length} chunks, ${sizeBytes}B)`);

    // 10. Mark job completed
    await prisma.documentIngestionJob.update({
      where: { id: job.id },
      data: { status: "completed", finishedAt: new Date() },
    });

    const updated = await prisma.document.findUnique({ where: { id: doc.id } });
    return dbDocToOutput(updated!);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[docling] ingestion failed for ${fileName}: ${errorMsg}`);

    await prisma.document.update({
      where: { id: doc.id },
      data: {
        status: "failed",
        errorCode: "DOCLING_FAILED",
        errorMessage: errorMsg.slice(0, 500),
      },
    });

    await prisma.documentIngestionJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorCode: "DOCLING_FAILED",
        errorMessage: errorMsg.slice(0, 500),
        finishedAt: new Date(),
      },
    });

    throw err;
  }
}

// ── Chunking ───────────────────────────────────────────────────────

interface Chunk {
  text: string;
  heading: string | null;
  charStart: number;
  charEnd: number;
}

function splitIntoChunks(text: string, chunkSize: number, overlap: number): Chunk[] {
  const chunks: Chunk[] = [];
  let pos = 0;
  let index = 0;

  while (pos < text.length) {
    const end = Math.min(pos + chunkSize, text.length);
    let chunkText = text.slice(pos, end);

    // Try to break at a paragraph or sentence boundary
    if (end < text.length) {
      const breakPoints = ["\n\n", "\n", ". ", "? ", "! "];
      for (const bp of breakPoints) {
        const lastBreak = chunkText.lastIndexOf(bp);
        if (lastBreak > chunkSize * 0.5) {
          chunkText = chunkText.slice(0, lastBreak + bp.length);
          break;
        }
      }
    }

    // Detect heading
    const headingMatch = chunkText.match(/^#{1,6}\s+(.+)/m);
    const heading = headingMatch ? headingMatch[1]!.trim() : null;

    chunks.push({
      text: chunkText.trim(),
      heading,
      charStart: pos,
      charEnd: pos + chunkText.length,
    });

    pos = pos + chunkText.length - overlap;
    index++;
  }

  return chunks;
}

// ── Ask document ───────────────────────────────────────────────────

export async function askDocument(
  docId: string,
  question: string,
): Promise<AskResult> {
  const doc = await getDocument(docId);
  if (!doc) throw new Error("Document not found");

  if (doc.status !== "completed") {
    throw new Error(`Document status is "${doc.status}" — ingestion not complete`);
  }

  // 1. Get chunks
  const chunks = await getDocumentChunks(docId);
  if (chunks.length === 0) {
    return {
      question,
      answer: "Tài liệu này chưa có nội dung để tra cứu (chưa có chunks).",
      chunksUsed: 0,
      provider: "local",
    };
  }

  // 2. Simple keyword scoring
  const questionLower = question.toLowerCase();
  const questionWords = questionLower.split(/\s+/).filter((w) => w.length > 1);

  const scoredChunks = chunks.map((chunk) => {
    const textLower = chunk.text.toLowerCase();
    let score = 0;
    for (const word of questionWords) {
      const count = (textLower.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
      score += count;
    }
    // Bonus for heading match
    if (chunk.heading && questionWords.some((w) => chunk.heading!.toLowerCase().includes(w))) {
      score += 5;
    }
    return { chunk, score };
  });

  scoredChunks.sort((a, b) => b.score - a.score);

  // Take top 5 chunks
  const topChunks = scoredChunks.slice(0, 5).filter((c) => c.score > 0);

  if (topChunks.length === 0) {
    return {
      question,
      answer: "Không tìm thấy thông tin liên quan đến câu hỏi trong tài liệu này.",
      chunksUsed: 0,
      provider: "local",
    };
  }

  // 3. Build context
  const contextParts = topChunks.map((sc, i) => {
    const h = sc.chunk.heading ? `[${sc.chunk.heading}] ` : "";
    return `[Đoạn ${i + 1}] ${h}${sc.chunk.text}`;
  });

  const context = contextParts.join("\n\n---\n\n");

  // 4. Call Hermes CLI for answer
  try {
    const { exec } = await import("node:child_process");
    const execAsync2 = promisify(exec);

    const prompt = `Bạn là trợ lý đọc tài liệu. Chỉ trả lời dựa trên nội dung tài liệu bên dưới. Nếu tài liệu không có thông tin, nói "Tài liệu không đề cập đến thông tin này." Trả lời ngắn gọn, bằng tiếng Việt.

TÀI LIỆU:
${context}

CÂU HỎI: ${question}`;

    const hermesBin = process.env.HERMES_CLI_PATH ?? "hermes";
    const hermesCmd = `${hermesBin} chat -q "${prompt.replace(/"/g, '\\"')}" -Q`;
    const { stdout } = await execAsync2(hermesCmd, { timeout: 60_000, maxBuffer: 50 * 1024 });

    const answer = stdout.trim() || "Không thể tạo câu trả lời.";

    return {
      question,
      answer,
      chunksUsed: topChunks.length,
      provider: "hermes-cli",
    };
  } catch {
    // Fallback: return best chunk as answer
    const bestChunk = topChunks[0]!;
    return {
      question,
      answer: `Dựa trên tài liệu: ${bestChunk.chunk.text.slice(0, 500)}`,
      chunksUsed: topChunks.length,
      provider: "keyword",
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function safeJson(val: string | null): Record<string, unknown> | null {
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}
