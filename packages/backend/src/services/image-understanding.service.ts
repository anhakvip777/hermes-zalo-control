// =============================================================================
// ImageUnderstandingService — OCR/Vision analysis of downloaded images
// =============================================================================

import { existsSync, statSync, readFileSync } from "node:fs";
import { config } from "../config.js";

export interface VisionResult {
  success: boolean;
  description?: string;
  ocrText?: string;
  confidence?: number;
  provider?: string;
  model?: string;
  error?: string;
}

/**
 * Analyze an image using the configured vision provider.
 *
 * Providers:
 * - "hermes": Uses the vision_analyze tool equivalent via local API call
 * - "direct": Uses ChiaseGPU API directly for vision-capable models
 *
 * Returns { description, ocrText, confidence, provider, model }.
 */
export async function analyzeImage(
  imagePath: string,
  prompt?: string,
): Promise<VisionResult> {
  if (!existsSync(imagePath)) {
    return { success: false, error: "FILE_NOT_FOUND" };
  }

  const provider = config.vision.provider;

  try {
    if (provider === "hermes") {
      return await analyzeViaHermes(imagePath, prompt);
    }

    // Fallback: basic analysis (file exists check only)
    const stats = statSync(imagePath);
    return {
      success: true,
      description: `Image file found: ${imagePath} (${stats.size} bytes). OCR not available with current provider "${provider}".`,
      ocrText: "",
      confidence: 0.1,
      provider: "none",
      model: "none",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `VISION_ERROR: ${msg.slice(0, 200)}` };
  }
}

/**
 * Analyze image via Hermes dedicated vision endpoint.
 * Calls a local HTTP API or uses built-in analysis.
 */
async function analyzeViaHermes(
  imagePath: string,
  prompt?: string,
): Promise<VisionResult> {
  try {
    const stats = statSync(imagePath);
    const defaultPrompt = prompt ?? [
      "Phân tích ảnh này thành 2 phần riêng biệt:",
      "",
      "MÔ TẢ: [mô tả ngắn gọn cảnh vật, màu sắc, vị trí, bối cảnh]",
      "",
      "CHỮ TRONG ẢNH:",
      "- [liệt kê từng dòng chữ THẬT SỰ xuất hiện trong ảnh]",
      "- Nếu dòng không đọc rõ → ghi chính xác \"[không đọc rõ]\"",
      "- Nếu đọc được một phần → ghi phần đọc được + \"[đọc được một phần]\", VD: \"ĐỊA CHỈ: 123 Nguyễn... [đọc được một phần]\"",
      "- KHÔNG dùng \"một phần:\" hay \"có thể là:\" — chỉ 2 format trên",
      "",
      "QUAN TRỌNG: CHỮ TRONG ẢNH chỉ chứa chữ thật, không mô tả cảnh.",
    ].join("\n");

    const fullPrompt = prompt ?? defaultPrompt;

    // Try ChiaseGPU API with vision-capable model
    const visionModel = config.vision.model || "gpt-5.4";
    const apiKey = process.env.CHIASEGPU_API_KEY || "";

    if (apiKey && config.vision.provider === "hermes") {
      console.log(`[vision] Attempting ChiaseGPU API call with model=${visionModel} keyLen=${apiKey.length}`);
      try {
        // Convert image to base64 for API
        const imageBuffer = readFileSync(imagePath);
        const base64Image = imageBuffer.toString("base64");
        const mimeType = imagePath.endsWith(".png") ? "image/png"
          : imagePath.endsWith(".webp") ? "image/webp"
          : "image/jpeg";

        const response = await fetch("https://llm.chiasegpu.vn/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: visionModel,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: fullPrompt,
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${mimeType};base64,${base64Image}`,
                    },
                  },
                ],
              },
            ],
            max_tokens: 500,
            temperature: 0.3,
          }),
          signal: AbortSignal.timeout(30000),
        });

        console.log(`[vision] ChiaseGPU response: status=${response.status} ok=${response.ok}`);

        if (response.ok) {
          const json = await response.json() as any;
          const reply = json?.choices?.[0]?.message?.content ?? "";
          console.log(`[vision] ChiaseGPU reply: "${reply.slice(0, 100)}..."`);
          const parsed = parseVisionResponse(reply);
          return {
            success: true,
            description: parsed.description,
            ocrText: parsed.ocrText,
            confidence: 0.85,
            provider: "chiasegpu",
            model: visionModel,
          };
        } else {
          const errorText = await response.text().catch(() => "");
          console.error(`[vision] ChiaseGPU error response (${response.status}): ${errorText.slice(0, 200)}`);
        }
      } catch (apiErr: unknown) {
        // API call failed, fall through to basic analysis
        console.error(`[vision] ChiaseGPU API call failed: ${apiErr instanceof Error ? apiErr.message : String(apiErr)}`);
      }
    }

    // Basic fallback: no vision API available
    return {
      success: true,
      description: `Hình ảnh đã được tải về (${stats.size} bytes, định dạng ${imagePath.split(".").pop()?.toUpperCase() ?? "???"}). Không có provider vision để phân tích nội dung.`,
      ocrText: "",
      confidence: 0.1,
      provider: "none",
      model: "none",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `ANALYSIS_ERROR: ${msg.slice(0, 200)}` };
  }
}

/**
 * Parse vision API response into description and ocrText.
 * Model is prompted to return structured output with two sections:
 * MÔ TẢ: ... (description)
 * CHỮ TRONG ẢNH: ... (OCR text)
 */
function parseVisionResponse(reply: string): { description: string; ocrText: string } {
  // Try to split on "CHỮ TRONG ẢNH" marker (case insensitive)
  const ocrMarker = /CHỮ\s+TRONG\s+ẢNH\s*[:\-]/i;
  const match = reply.match(ocrMarker);

  if (match && match.index !== undefined) {
    const description = reply.slice(0, match.index).trim()
      .replace(/^MÔ\s+TẢ\s*[:\-]\s*/i, "") // Strip "MÔ TẢ:" prefix
      .trim();

    let ocrText = reply.slice(match.index! + match[0].length).trim();

    // Clean up OCR: extract lines that look like actual text (not descriptions)
    const lines = ocrText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    const ocrLines: string[] = [];
    for (const line of lines) {
      // Skip description-like lines (màu đỏ, phía sau là...)
      if (/^(màu|chữ|nền|phía|phông|font|cỡ|đậm|nhạt|in|viết)\s/i.test(line) && line.length < 60) {
        continue;
      }
      // Skip lines that are clearly descriptions not OCR
      if (/^(đây|đó|trong|ngoài|bên|giữa|trên|dưới|sau|trước)/i.test(line) && line.length > 30) {
        continue;
      }
      // Strip bullet markers
      const cleaned = line.replace(/^[\-\*\•\d\.]+\s*/, "");
      if (cleaned.length > 0) {
        ocrLines.push(cleaned);
      }
    }

    // If no OCR lines found, try quoted text extraction
    if (ocrLines.length === 0) {
      const quoteMatches = reply.match(/[""]([^""]{3,})[""]/g);
      if (quoteMatches) {
        return {
          description,
          ocrText: quoteMatches.map(q => q.replace(/[""]/g, "")).join("\n"),
        };
      }
    }

    return { description, ocrText: ocrLines.join("\n") };
  }

  // Fallback: full reply is description
  return { description: reply, ocrText: "" };
}

/**
 * Extract potential OCR text from the description. (Legacy — prefer parseVisionResponse)
 */
function extractOcrFromDescription(description: string): string {
  const parsed = parseVisionResponse(description);
  return parsed.ocrText;
}

/**
 * Quick check if a response contains meaningful OCR content.
 */
export function hasOcrContent(visionResult: VisionResult): boolean {
  return !!(visionResult.ocrText && visionResult.ocrText.trim().length > 0);
}
