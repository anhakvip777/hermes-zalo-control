// =============================================================================
// Document Ingestion Service — Docling-powered document understanding
// =============================================================================
// Fix Batch 12.1: Process isolation — Docling runs as spawned child process
// with hard timeout. TXT/MD/CSV ingested directly without Docling.
// API returns documentId/jobId immediately, processing continues in background.

import { spawn, type ChildProcess } from "node:child_process";
import { readFile, access, stat, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, extname, resolve, normalize, sep } from "node:path";
import { config } from "../config.js";
import { prisma } from "../db.js";

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

export interface DocumentJobOutput {
  id: string;
  documentId: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

// ── Extensions that don't need Docling / ML conversion ─────────────
const DIRECT_TEXT_EXTENSIONS = new Set(["txt", "md", "csv"]);

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
  if (!resolved.startsWith(baseDir + sep) && resolved !== baseDir) {
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

export async function getDocumentJobs(docId: string): Promise<DocumentJobOutput[]> {
  const jobs = await prisma.documentIngestionJob.findMany({
    where: { documentId: docId },
    orderBy: { createdAt: "desc" },
  });
  return jobs.map((j) => ({
    id: j.id,
    documentId: j.documentId,
    status: j.status,
    errorCode: j.errorCode,
    errorMessage: j.errorMessage,
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
  }));
}

// ── Ingestion pipeline (non-blocking) ──────────────────────────────

export interface IngestResult {
  documentId: string;
  jobId: string;
  status: "queued";
  method: "direct" | "docling";
  fileName: string;
}

/**
 * Main ingest entry point — validates, creates DB records, and returns immediately.
 * Processing happens in background (direct for TXT/MD/CSV, spawned Docling for PDF/etc).
 * NEVER blocks the HTTP request waiting for Docling.
 */
export async function ingestDocument(
  filePath: string,
  options?: { source?: string; threadId?: string; messageId?: string },
): Promise<IngestResult> {
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

  // 5. Determine method
  const isDirectText = DIRECT_TEXT_EXTENSIONS.has(extension);
  const mimeType = detectMimeType(extension);

  // 6. Create document record
  const doc = await prisma.document.create({
    data: {
      fileName,
      originalPath: resolved,
      mimeType,
      extension,
      sizeBytes,
      sha256,
      status: "processing",
      provider: isDirectText ? "direct" : "docling",
      source: options?.source ?? null,
      threadId: options?.threadId ?? null,
      messageId: options?.messageId ?? null,
    },
  });

  // 7. Create ingestion job (status=queued — picked up by document worker)
  const job = await prisma.documentIngestionJob.create({
    data: {
      documentId: doc.id,
      status: "queued",
    },
  });

  console.log(`[docling] ingest queued: ${fileName} → ${doc.id} job=${job.id} method=${isDirectText ? "direct" : "docling"}`);

  return {
    documentId: doc.id,
    jobId: job.id,
    status: "queued",
    method: isDirectText ? "direct" : "docling",
    fileName,
  };
}

// ── Background processing ──────────────────────────────────────────

async function processDocumentBackground(
  docId: string,
  jobId: string,
  resolvedPath: string,
  fileName: string,
  extension: string,
  sizeBytes: number,
  fileBuffer: Buffer,
  isDirectText: boolean,
): Promise<void> {
  try {
    if (isDirectText) {
      await processDirectText(docId, jobId, fileName, sizeBytes, fileBuffer);
    } else {
      await runDoclingWithSpawn(docId, jobId, resolvedPath, fileName, extension, sizeBytes);
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[docling] processing failed for ${fileName}: ${errorMsg}`);

    await prisma.document.update({
      where: { id: docId },
      data: {
        status: "failed",
        errorCode: "PROCESSING_FAILED",
        errorMessage: errorMsg.slice(0, 500),
      },
    });

    await prisma.documentIngestionJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorCode: "PROCESSING_FAILED",
        errorMessage: errorMsg.slice(0, 500),
        finishedAt: new Date(),
      },
    });
  }
}

// ── Direct text ingestion (TXT, MD, CSV) ───────────────────────────

export async function processDirectText(
  docId: string,
  jobId: string,
  fileName: string,
  sizeBytes: number,
  fileBuffer: Buffer,
): Promise<void> {
  const markdownContent = fileBuffer.toString("utf-8");
  const cfg = config.document;

  // Write markdown copy to processed dir
  await mkdir(cfg.processedDir, { recursive: true });
  const outputPath = `${cfg.processedDir}/${docId}.md`;
  await writeFile(outputPath, markdownContent, "utf-8");

  // Create chunks FIRST (before marking document completed)
  const chunks = splitIntoChunks(markdownContent, cfg.chunkSize, cfg.chunkOverlap);
  for (let i = 0; i < chunks.length; i++) {
    await prisma.documentChunk.create({
      data: {
        documentId: docId,
        chunkIndex: i,
        heading: chunks[i]!.heading ?? null,
        text: chunks[i]!.text,
        tokenEstimate: Math.ceil(chunks[i]!.text.length / 4),
        metadata: JSON.stringify({
          source: "direct",
          charStart: chunks[i]!.charStart,
          charEnd: chunks[i]!.charEnd,
        }),
      },
    });
  }

  // Update document (only after chunks succeed)
  const textPreview = markdownContent.slice(0, 500);
  await prisma.document.update({
    where: { id: docId },
    data: {
      status: "completed",
      markdownPath: outputPath,
      textPreview,
    },
  });

  // Mark job completed
  await prisma.documentIngestionJob.update({
    where: { id: jobId },
    data: { status: "completed", finishedAt: new Date() },
  });

  console.log(`[docling] direct ingest completed: ${fileName} → ${docId} (${chunks.length} chunks, ${sizeBytes}B)`);
}

// ── Docling spawn (with hard timeout, process isolation) ───────────

export function runDoclingWithSpawn(
  docId: string,
  jobId: string,
  resolvedPath: string,
  fileName: string,
  extension: string,
  sizeBytes: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cfg = config.document;
    const doclingBin = cfg.doclingBin;
    const timeoutMs = cfg.doclingTimeoutMs;
    const killGraceMs = cfg.doclingKillGraceMs;
    const maxOutputBytes = cfg.doclingMaxOutputBytes;

    console.log(`[docling] spawning: ${doclingBin} "${resolvedPath}" --to md --output "${cfg.processedDir}" (timeout=${timeoutMs}ms)`);

    let child: ChildProcess;
    let stdoutBuf = "";
    let stderrBuf = "";
    let killed = false;

    const timeoutId = setTimeout(() => {
      console.warn(`[docling] timeout after ${timeoutMs}ms, killing process tree for ${docId}`);
      killed = true;
      if (child.pid) {
        try { process.kill(-child.pid, "SIGTERM"); } catch { /* already dead */ }
      }
      child.kill("SIGTERM");

      // Grace period then SIGKILL
      setTimeout(() => {
        if (child.exitCode === null) {
          console.warn(`[docling] SIGTERM grace expired, sending SIGKILL for ${docId}`);
          if (child.pid) {
            try { process.kill(-child.pid, "SIGKILL"); } catch { /* already dead */ }
          }
          child.kill("SIGKILL");
        }
      }, killGraceMs);
    }, timeoutMs);

    try {
      child = spawn(doclingBin, [resolvedPath, "--to", "md", "--output", cfg.processedDir, "--no-ocr"], {
        cwd: cfg.processedDir,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true, // create new process group for process.kill(-pid)
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      return reject(new Error(`Failed to spawn docling: ${(err as Error).message}`));
    }

    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      if (stdoutBuf.length < maxOutputBytes) {
        stdoutBuf += chunk;
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      if (stderrBuf.length < maxOutputBytes) {
        stderrBuf += chunk;
      }
    });

    child.on("error", async (err: Error) => {
      clearTimeout(timeoutId);
      await failJob(docId, jobId, fileName, "DOCLING_SPAWN_ERROR", err.message);
      reject(err);
    });

    child.on("close", async (code: number | null, signal: string | null) => {
      clearTimeout(timeoutId);

      if (killed) {
        await failJob(docId, jobId, fileName, "DOCLING_TIMEOUT", `Docling killed after ${timeoutMs}ms timeout`);
        return reject(new Error("Docling timed out"));
      }

      if (code !== 0) {
        const errMsg = `Docling exit code ${code}${signal ? ` signal ${signal}` : ""}. stderr: ${stderrBuf.slice(0, 200)}`;
        await failJob(docId, jobId, fileName, "DOCLING_FAILED", errMsg);
        return reject(new Error(errMsg));
      }

      // Success — read output
      try {
        const baseName = fileName.includes(".") ? fileName.slice(0, fileName.lastIndexOf(".")) : fileName;
        const outputName = `${baseName}.md`;
        const doclingOutput = `${cfg.processedDir}/${outputName}`;
        const fallbackOutput = `${cfg.processedDir}/${fileName}.md`;

        let markdownContent: string | null = null;
        let actualOutputPath: string | null = null;

        // Retry up to 3 times with delay
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            markdownContent = await readFile(doclingOutput, "utf-8");
            actualOutputPath = doclingOutput;
            break;
          } catch {
            if (doclingOutput !== fallbackOutput) {
              try {
                markdownContent = await readFile(fallbackOutput, "utf-8");
                actualOutputPath = fallbackOutput;
                break;
              } catch { /* continue */ }
            }
            if (attempt < 2) await new Promise(r => setTimeout(r, 500));
          }
        }

        if (!markdownContent) {
          await failJob(docId, jobId, fileName, "DOCLING_NO_OUTPUT", "Docling ran successfully but produced no readable markdown");
          return reject(new Error("No markdown output"));
        }

        // Update document
        const textPreview = markdownContent.slice(0, 500);
        await prisma.document.update({
          where: { id: docId },
          data: { status: "completed", markdownPath: actualOutputPath, textPreview },
        });

        // Create chunks
        const chunks = splitIntoChunks(markdownContent, cfg.chunkSize, cfg.chunkOverlap);
        for (let i = 0; i < chunks.length; i++) {
          await prisma.documentChunk.create({
            data: {
              documentId: docId,
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

        await prisma.documentIngestionJob.update({
          where: { id: jobId },
          data: { status: "completed", finishedAt: new Date() },
        });

        console.log(`[docling] spawn completed: ${fileName} → ${docId} (${chunks.length} chunks, ${sizeBytes}B)`);
        resolve();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await failJob(docId, jobId, fileName, "DOCLING_POSTPROCESS_FAILED", msg);
        reject(err instanceof Error ? err : new Error(msg));
      }
    });
  });
}

async function failJob(
  docId: string,
  jobId: string,
  fileName: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  console.error(`[docling] job failed for ${fileName}: ${errorCode} — ${errorMessage}`);
  try {
    await prisma.document.update({
      where: { id: docId },
      data: {
        status: "failed",
        errorCode,
        errorMessage: errorMessage.slice(0, 500),
      },
    });
    await prisma.documentIngestionJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorCode,
        errorMessage: errorMessage.slice(0, 500),
        finishedAt: new Date(),
      },
    });
  } catch (dbErr: unknown) {
    console.error(`[docling] failed to update DB for ${docId}: ${(dbErr as Error).message}`);
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

    const advance = chunkText.length - overlap;
    if (advance <= 0) break; // Prevent infinite loop for small texts
    pos = pos + advance;
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
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    const prompt = `Bạn là trợ lý đọc tài liệu. Chỉ trả lời dựa trên nội dung tài liệu bên dưới. Nếu tài liệu không có thông tin, nói "Tài liệu không đề cập đến thông tin này." Trả lời ngắn gọn, bằng tiếng Việt.

TÀI LIỆU:
${context}

CÂU HỎI: ${question}`;

    const hermesBin = process.env.HERMES_CLI_PATH ?? "hermes";
    const hermesCmd = `${hermesBin} chat -q "${prompt.replace(/"/g, '\\"')}" -Q`;
    const { stdout } = await execAsync(hermesCmd, { timeout: 60_000, maxBuffer: 50 * 1024 });

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
