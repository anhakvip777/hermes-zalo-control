// =============================================================================
// ZaloTtsService — text-to-speech via edge-tts CLI, outputs to safe directory
// =============================================================================

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { config } from "../config.js";

const EDGE_TTS_BIN = "/home/anhakvip777/ai-agents/hermes-agent/venv/bin/edge-tts";
const DEFAULT_MAX_TEXT_LENGTH = 2000;
const MAX_TTS_TIMEOUT_MS = 30000;

function getVoiceOutputDir(): string {
  const base = config.zalo.mediaAllowedBaseDir || "/tmp/hermes-media";
  return join(base, "voice");
}

export interface TtsOptions {
  text: string;
  voice?: string;        // e.g. "vi-VN-NamMinhNeural", default "vi-VN-HoaiMyNeural"
  rate?: string;         // e.g. "+0%", "+20%", "-10%"
  pitch?: string;        // e.g. "+0Hz"
}

export interface TtsResult {
  success: boolean;
  audioPath?: string;
  duration?: number;      // seconds (approximate, from file size)
  textHash?: string;
  error?: string;
  errorCode?: string;
}

export class ZaloTtsService {
  private outputDir: string;

  constructor(outputDir?: string) {
    this.outputDir = outputDir ?? getVoiceOutputDir();
    mkdirSync(this.outputDir, { recursive: true });
  }

  /**
   * Generate speech audio from text using edge-tts.
   * Output is always .mp3 in the safe directory.
   */
  async generateSpeech(opts: TtsOptions): Promise<TtsResult> {
    const { text, voice = "vi-VN-NamMinhNeural", rate = "+0%", pitch = "+0Hz" } = opts;

    // ── Validate input ──────────────────────────────────────────────────
    const trimmed = text.trim();
    if (!trimmed) {
      return { success: false, error: "Text is empty", errorCode: "TTS_EMPTY_TEXT" };
    }

    const maxLen = DEFAULT_MAX_TEXT_LENGTH;
    if (trimmed.length > maxLen) {
      return {
        success: false,
        error: `Text too long: ${trimmed.length} chars (max ${maxLen})`,
        errorCode: "TTS_TEXT_TOO_LONG",
      };
    }

    // ── Generate filename ───────────────────────────────────────────────
    const hash = createHash("sha256").update(trimmed).digest("hex").slice(0, 12);
    const filename = `tts-${Date.now()}-${hash}.mp3`;
    const outputPath = resolve(this.outputDir, filename);

    // ── Run edge-tts ────────────────────────────────────────────────────
    try {
      await execPromise(EDGE_TTS_BIN, [
        "--text", trimmed,
        "--voice", voice,
        "--rate", rate,
        "--pitch", pitch,
        "--write-media", outputPath,
      ], { timeout: MAX_TTS_TIMEOUT_MS });
    } catch (err: any) {
      return {
        success: false,
        error: `TTS generation failed: ${err?.message || "unknown error"}`,
        errorCode: "TTS_GENERATION_FAILED",
      };
    }

    // ── Verify output ───────────────────────────────────────────────────
    if (!existsSync(outputPath)) {
      return {
        success: false,
        error: "TTS output file not created",
        errorCode: "TTS_GENERATION_FAILED",
      };
    }

    const stats = statSync(outputPath);
    if (stats.size === 0) {
      return {
        success: false,
        error: "TTS output file is empty",
        errorCode: "TTS_GENERATION_FAILED",
      };
    }

    // Approximate duration: MP3 at ~16 KB/s (128 kbps) = ~16000 bytes per second
    const duration = stats.size / 16000;

    return {
      success: true,
      audioPath: outputPath,
      duration: Math.round(duration * 10) / 10, // 1 decimal
      textHash: hash,
    };
  }
}

// Singleton
let ttsInstance: ZaloTtsService | null = null;
export function getTtsService(): ZaloTtsService {
  if (!ttsInstance) ttsInstance = new ZaloTtsService();
  return ttsInstance;
}

/**
 * Convert audio to M4A (AAC) optimized for Zalo voice messages.
 * Matches openzca's normalizeVoiceForPublish: 44100 Hz, AAC, 64k, mono, +faststart.
 */
export async function convertToM4a(mp3Path: string): Promise<string | null> {
  const { resolve } = await import("node:path");
  const { existsSync } = await import("node:fs");
  if (!existsSync(mp3Path)) return null;

  const m4aPath = mp3Path.replace(/\.mp3$/i, ".m4a");
  if (existsSync(m4aPath)) return m4aPath;

  return new Promise((resolvePromise) => {
    execFile(
      "ffmpeg",
      [
        "-y", "-v", "error",
        "-i", mp3Path,
        "-vn",
        "-map_metadata", "-1",
        "-ac", "1",
        "-ar", "44100",
        "-c:a", "aac",
        "-b:a", "64k",
        "-movflags", "+faststart",
        m4aPath,
      ],
      { timeout: 15000 },
      (err) => {
        if (err) {
          console.error(`M4A conversion failed: ${err.message}`);
          resolvePromise(null);
        } else if (existsSync(m4aPath)) {
          resolvePromise(m4aPath);
        } else {
          resolvePromise(null);
        }
      },
    );
  });
}

// ═══════════════════════════════════════════════════════════════════
// Promise wrapper for child_process.execFile
// ═══════════════════════════════════════════════════════════════════

function execPromise(
  command: string,
  args: string[],
  opts?: { timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(
      command,
      args,
      { timeout: opts?.timeout ?? 30000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = err.killed ? "TTS process timed out" : err.message;
          reject(new Error(msg));
          return;
        }
        resolvePromise({ stdout: stdout.toString(), stderr: stderr.toString() });
      },
    );
  });
}
