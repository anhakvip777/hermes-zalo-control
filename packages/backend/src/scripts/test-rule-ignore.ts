// =============================================================================
// Batch 11.1 Step 3 — Ignore rule test
// =============================================================================
import { handleIncomingMessage } from "../services/incoming-dispatcher.service.js";
import type { NormalizedMessage } from "../services/zalo-receive.js";

const msg: NormalizedMessage = {
  zaloMessageId: `test-dm-spam-${Date.now()}`,
  threadId: "6792540503378312397",
  threadType: "user",
  threadName: "Anh Việt",
  senderId: "test-sender-dm",
  senderName: "Anh Việt",
  content: "spam-test",
  messageType: "text",
  isSelf: false,
  isFromBot: false,
  rawMetadata: JSON.stringify({ test: true }),
};

async function main() {
  console.log("[test] Sending simulated DM: spam-test");
  const result = await handleIncomingMessage(msg, null);
  console.log("[test] Dispatcher result:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("[test] Error:", err);
  process.exit(1);
});
