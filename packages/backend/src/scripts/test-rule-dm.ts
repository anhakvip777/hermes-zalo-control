// =============================================================================
// Batch 11.1 — Simulate Zalo DM through full dispatcher pipeline
// =============================================================================
import { handleIncomingMessage } from "../services/incoming-dispatcher.service.js";
import type { NormalizedMessage } from "../services/zalo-receive.js";

const msg: NormalizedMessage = {
  zaloMessageId: `test-dm-rule-${Date.now()}`,
  threadId: "6792540503378312397",
  threadType: "user",
  threadName: "Anh Việt",
  senderId: "test-sender-dm",
  senderName: "Anh Việt",
  content: "xin chào",
  messageType: "text",
  isSelf: false,
  isFromBot: false,
  rawMetadata: JSON.stringify({ test: true }),
};

async function main() {
  console.log("[test] Sending simulated DM: xin chào");
  const result = await handleIncomingMessage(msg, null);
  console.log("[test] Dispatcher result:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("[test] Error:", err);
  process.exit(1);
});
