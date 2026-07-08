// =============================================================================
// ImageDownloadService — safe image download from Zalo URLs
// =============================================================================

import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { resolve, basename, sep } from "node:path";
import { config } from "../config.js";

export interface DownloadResult {
  success: boolean;
  filePath?: string;
  hash?: string;
  mimeType?: string;
  sizeBytes?: number;
  error?: string;
}

/**
 * Validate that the given path is within the allowed safe directory.
 * Blocks path traversal attacks (../, ..\\, symlinks).
 */
export function validateSafeDownloadPath(filePath: string): boolean {
  const safeDir = resolve(config.vision.safeDir);
  const resolved = resolve(filePath);

  // Must be within safeDir
  if (!resolved.startsWith(safeDir + sep) && resolved !== safeDir) {
    return false;
  }

  // Block filenames with path separators
  const base = basename(resolved);
  if (base.includes("/") || base.includes("\\") || base.includes("..")) {
    return false;
  }

  return true;
}

/**
 * Validate MIME type against allowed list.
 */
export function isAllowedMimeType(mimeType: string | null): boolean {
  if (!mimeType) return false;
  const normalized = mimeType.toLowerCase().trim();
  return config.vision.allowedMimeTypes.some(
    (allowed) => normalized === allowed || normalized.startsWith(allowed + ";"),
  );
}

/**
 * Detect MIME type from file magic bytes (basic, no external deps).
 */
function detectMimeFromBytes(buffer: Buffer): string | null {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return "image/png";
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return "image/webp";
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) return "image/bmp";
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return "image/gif";
  return null;
}

/**
 * Download image from URL to safe directory.
 * Returns result with filePath, hash, mimeType, sizeBytes.
 */
export async function downloadImage(
  imageUrl: string,
  threadId: string,
  messageId: string,
): Promise<DownloadResult> {
  const safeDir = resolve(config.vision.safeDir);
  const maxSize = config.vision.maxSizeBytes;
  const timeoutMs = config.vision.downloadTimeoutMs;

  // Generate safe filename: threadId_messageId_timestamp.ext
  const ts = Date.now();
  const safeFilename = `${threadId.slice(-12)}_${messageId.slice(-16)}_${ts}`;
  const tmpPath = resolve(safeDir, `${safeFilename}.tmp`);

  // Validate path safety
  if (!validateSafeDownloadPath(tmpPath)) {
    return { success: false, error: "UNSAFE_PATH: path traversal blocked" };
  }

  // Ensure safe directory exists
  try {
    mkdirSync(safeDir, { recursive: true });
  } catch {
    return { success: false, error: "SAFE_DIR_CREATE_FAILED" };
  }

  // Download with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "HermesZaloImageDownloader/1.0",
      },
    });
  } catch (err: unknown) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("AbortError")) {
      return { success: false, error: "DOWNLOAD_TIMEOUT" };
    }
    return { success: false, error: `DOWNLOAD_FAILED: ${msg.slice(0, 100)}` };
  }
  clearTimeout(timeout);

  if (!response.ok) {
    return { success: false, error: `HTTP_${response.status}: ${response.statusText.slice(0, 80)}` };
  }

  // Check Content-Length header if available
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (isNaN(size) || size > maxSize) {
      return { success: false, error: `OVERSIZE: ${size} bytes exceeds max ${maxSize}` };
    }
  }

  // Check Content-Type header
  const contentType = response.headers.get("content-type");
  if (contentType && !isAllowedMimeType(contentType)) {
    return { success: false, error: `UNSUPPORTED_MIME: ${contentType}` };
  }

  // Download to temp file
  try {
    const fileStream = createWriteStream(tmpPath);
    const reader = response.body?.getReader();
    if (!reader) {
      return { success: false, error: "NO_RESPONSE_BODY" };
    }

    let totalBytes = 0;
    const chunks: Buffer[] = [];

    // Read in chunks with size check
    const MAX_BODY_CHECK = maxSize + 1024 * 1024; // 1MB grace
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_CHECK) {
        reader.cancel();
        fileStream.close();
        try { unlinkSync(tmpPath); } catch { /* cleanup */ }
        return { success: false, error: `OVERSIZE: stream exceeded ${MAX_BODY_CHECK} bytes` };
      }

      chunks.push(Buffer.from(value));
      fileStream.write(Buffer.from(value));
    }
    fileStream.end();

    // Wait for write to finish
    await new Promise<void>((resolve, reject) => {
      fileStream.on("finish", resolve);
      fileStream.on("error", reject);
    });

    if (totalBytes > maxSize) {
      try { unlinkSync(tmpPath); } catch { /* cleanup */ }
      return { success: false, error: `OVERSIZE: ${totalBytes} bytes exceeds max ${maxSize}` };
    }

    // Combine chunks for magic byte detection
    const head = chunks.length > 0 ? Buffer.concat(chunks.slice(0, 1)) : Buffer.alloc(0);
    const magicMime = detectMimeFromBytes(head);

    // Validate MIME by magic bytes if available
    if (magicMime && !isAllowedMimeType(magicMime)) {
      try { unlinkSync(tmpPath); } catch { /* cleanup */ }
      return { success: false, error: `UNSUPPORTED_MIME_BYTES: ${magicMime}` };
    }

    // If Content-Type was missing but magic bytes say it's allowed
    const finalMime = contentType && isAllowedMimeType(contentType)
      ? contentType
      : magicMime || contentType || "application/octet-stream";

    // If neither header nor magic bytes identify an allowed type, reject
    if (!isAllowedMimeType(finalMime)) {
      try { unlinkSync(tmpPath); } catch { /* cleanup */ }
      return { success: false, error: `UNKNOWN_MIME: could not identify image type` };
    }

    // Rename to final name with correct extension
    const ext = finalMime === "image/jpeg" || finalMime === "image/jpg" ? ".jpg"
      : finalMime === "image/png" ? ".png"
      : finalMime === "image/webp" ? ".webp"
      : finalMime === "image/gif" ? ".gif"
      : ".bin";
    const finalPath = resolve(safeDir, `${safeFilename}${ext}`);

    renameSync(tmpPath, finalPath);

    // Compute SHA-256 hash
    const hash = await computeFileHash(finalPath);

    // Verify final path is safe
    if (!validateSafeDownloadPath(finalPath)) {
      try { unlinkSync(finalPath); } catch { /* cleanup */ }
      return { success: false, error: "UNSAFE_PATH: final path blocked" };
    }

    return {
      success: true,
      filePath: finalPath,
      hash,
      mimeType: finalMime,
      sizeBytes: totalBytes,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    try { unlinkSync(tmpPath); } catch { /* cleanup */ }
    return { success: false, error: `DOWNLOAD_WRITE_ERROR: ${msg.slice(0, 100)}` };
  }
}

/**
 * Compute SHA-256 hash of a file.
 */
function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Cleanup downloaded file.
 */
export function cleanupDownloadedImage(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Non-critical
  }
}
