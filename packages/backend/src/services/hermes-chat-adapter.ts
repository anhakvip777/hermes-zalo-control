// =============================================================================
// HermesChatAdapter — interface for pluggable AI reply generation
// =============================================================================

import { spawn } from "node:child_process";
import { config } from "../config.js";

export interface ChatContext {
  threadId: string;
  threadType: "user" | "group";
  senderId: string;
  senderName?: string;
  content: string;
  recentMessages?: string[];
  scheduleContext?: string;
}

export interface ChatReply {
  reply: string;
  confidence?: number;
}

export interface HermesChatAdapter {
  generateReply(input: ChatContext): Promise<ChatReply>;
}

// =============================================================================
// MockHermesChatAdapter — echoes back for safe testing
// =============================================================================

export class MockHermesChatAdapter implements HermesChatAdapter {
  async generateReply(input: ChatContext): Promise<ChatReply> {
    const reply = `Bạn vừa nói: "${input.content}"`;
    return { reply, confidence: 1.0 };
  }
}

// =============================================================================
// RealHermesChatAdapter — HTTP POST or CLI spawn
// =============================================================================

export class RealHermesChatAdapter implements HermesChatAdapter {
  private readonly mode: "http" | "cli";
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly cliBin: string;
  private readonly cliTimeoutMs: number;

  constructor(opts: {
    mode: "http" | "cli";
    endpoint?: string;
    timeoutMs?: number;
    cliBin?: string;
    cliTimeoutMs?: number;
  }) {
    this.mode = opts.mode;
    this.endpoint = opts.endpoint ?? "";
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.cliBin = opts.cliBin ?? "";
    this.cliTimeoutMs = opts.cliTimeoutMs ?? 60000;
  }

  async generateReply(input: ChatContext): Promise<ChatReply> {
    if (this.mode === "cli") {
      return this.generateViaCLI(input);
    }
    return this.generateViaHTTP(input);
  }

  // ── HTTP mode ──────────────────────────────────────────────────

  private async generateViaHTTP(input: ChatContext): Promise<ChatReply> {
    if (!this.endpoint) {
      throw new Error("HERMES_ENDPOINT_MISSING");
    }

    const payload = {
      threadId: input.threadId,
      threadType: input.threadType,
      senderId: input.senderId,
      senderName: input.senderName ?? "",
      content: input.content,
      recentMessages: input.recentMessages ?? [],
      timestamp: new Date().toISOString(),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Hermes endpoint returned ${response.status}`);
      }

      const data = (await response.json()) as { reply?: string; confidence?: number; error?: string };

      if (data.error) {
        throw new Error(`Hermes error: ${data.error}`);
      }

      const reply = typeof data.reply === "string" ? data.reply : "";
      const confidence = typeof data.confidence === "number" ? data.confidence : undefined;

      return { reply, confidence };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`Hermes endpoint timeout after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── CLI mode ───────────────────────────────────────────────────

  private buildCLIPrompt(input: ChatContext): string {
    const prefix = [
      "Bạn là trợ lý Zalo. Trả lời ngắn gọn, thân thiện bằng tiếng Việt.",
      "Không nhắc đến hệ thống nội bộ, token, API key, session hoặc cấu hình.",
      "Bạn không được bịa rằng hệ thống đã đặt lịch, đã gửi nhắc nhở, bị lỗi gửi tin,",
      "không gửi được, hoặc đã thực hiện tác vụ nếu không có dữ liệu thật từ schedule/execution.",
      "Nếu người dùng hỏi về lịch/nhắc nhở mà bạn chưa có dữ liệu,",
      "hãy nói cần kiểm tra hệ thống hoặc hỏi lại ngắn gọn.",
      "Nếu không chắc, hãy hỏi lại ngắn gọn.",
    ].join(" ");

    const context = `[Zalo ${input.threadType} từ ${input.senderName || "người dùng"}]`;

    let fullPrompt = `${prefix}\n\n${context}\n${input.content}`;

    // Inject conversation history if provided
    if (input.recentMessages && input.recentMessages.length > 0) {
      const historyStr = input.recentMessages
        .slice(-20) // Last 20 messages max for prompt size
        .join("\n");
      fullPrompt = `${prefix}\n\n[LỊCH SỬ TRÒ CHUYỆN]\n${historyStr}\n[/LỊCH SỬ]\n\n${context}\n${input.content}`;
    }

    // Inject schedule context if provided (prevents Hermes from calling tools)
    if (input.scheduleContext) {
      fullPrompt = fullPrompt.replace(
        `${context}\n${input.content}`,
        `${input.scheduleContext}\n\n${context}\n${input.content}`,
      );
    }

    return fullPrompt;
  }

  private parseCLIStdout(stdout: string): string {
    const lines = stdout.split("\n");
    const replyLines: string[] = [];
    for (const line of lines) {
      // Skip session_id line
      if (line.startsWith("session_id:")) continue;
      replyLines.push(line);
    }
    return replyLines.join("\n").trim();
  }

  private estimateConfidence(reply: string): number {
    const lower = reply.toLowerCase();
    // Error/leak indicators → very low
    if (
      lower.includes("api key") ||
      lower.includes("token") ||
      lower.includes("session") ||
      lower.includes("error") ||
      lower.includes("exception") ||
      lower.includes("failed")
    ) {
      return 0.3;
    }
    // Very short or generic → low
    if (reply.length < 10 || reply === "..." || lower === "ok") {
      return 0.5;
    }
    // Has Vietnamese characters → higher confidence
    const hasVietnamese =
      /[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(
        reply,
      );
    return hasVietnamese ? 0.9 : 0.85;
  }

  private generateViaCLI(input: ChatContext): Promise<ChatReply> {
    return new Promise((resolve, reject) => {
      if (!this.cliBin) {
        reject(new Error("HERMES_CLI_MISSING"));
        return;
      }

      const prompt = this.buildCLIPrompt(input);
      // Log preview only (max 100 chars, no private data)
      const preview = prompt.replace(/\n/g, " ").slice(0, 100);
      console.log(`[hermes-cli] calling: ${this.cliBin} chat -q "${preview}..." -Q`);

      const child = spawn(this.cliBin, ["chat", "-q", prompt, "-Q"], {
        shell: false,
        timeout: this.cliTimeoutMs,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });

      child.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") {
          reject(new Error("HERMES_CLI_MISSING"));
        } else {
          reject(new Error(`HERMES_CLI_ERROR: ${err.message}`));
        }
      });

      child.on("close", (code: number | null, signal: string | null) => {
        if (signal === "SIGTERM" || signal === "SIGKILL") {
          reject(new Error(`HERMES_CLI_TIMEOUT after ${this.cliTimeoutMs}ms`));
          return;
        }

        if (code !== 0) {
          const stderrPreview = stderr.slice(0, 200);
          reject(new Error(`HERMES_CLI_FAILED exit=${code}: ${stderrPreview}`));
          return;
        }

        const reply = this.parseCLIStdout(stdout);
        const confidence = this.estimateConfidence(reply);

        console.log(
          `[hermes-cli] reply: "${reply.slice(0, 60)}${reply.length > 60 ? "..." : ""}" (confidence=${confidence})`,
        );

        resolve({ reply, confidence });
      });
    });
  }
}

// =============================================================================
// Adapter Factory — singleton, driven by config
// =============================================================================

let adapter: HermesChatAdapter | null = null;

export function getHermesChatAdapter(): HermesChatAdapter {
  if (!adapter) {
    const cfg = config.hermesChat;

    if (cfg.adapter === "real") {
      adapter = new RealHermesChatAdapter({
        mode: cfg.mode,
        endpoint: cfg.endpoint,
        timeoutMs: cfg.timeoutMs,
        cliBin: cfg.cliBin,
        cliTimeoutMs: cfg.cliTimeoutMs,
      });
    } else {
      adapter = new MockHermesChatAdapter();
    }
  }

  return adapter;
}

export function setHermesChatAdapter(a: HermesChatAdapter): void {
  adapter = a;
}

export function resetHermesChatAdapter(): void {
  adapter = null;
}
