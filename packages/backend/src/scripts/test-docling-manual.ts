// =============================================================================
// Batch 12 — Manual test: ingest + ask
// =============================================================================

// MUST set env BEFORE any imports (config reads at module load time)
process.env.DOCUMENT_INGEST_ENABLED = "true";
process.env.DOCUMENT_DOCLING_BIN = process.env.HOME + "/venvs/docling/bin/docling";

import { ingestDocument, getDocument, askDocument } from "../services/document-ingestion.service.js";

async function main() {
  const filePath = "/tmp/hermes-media/documents/test.md";

  console.log("[test] Ingesting:", filePath);
  try {
    const ingest = await ingestDocument(filePath, { source: "manual" });
    console.log("[test] Ingested! documentId:", ingest.documentId, "jobId:", ingest.jobId, "status:", ingest.status);

    // Wait for worker to process
    console.log("[test] Waiting for worker...");
    await new Promise(r => setTimeout(r, 3000));

    const doc = await getDocument(ingest.documentId);
    if (!doc) {
      console.error("[test] Document not found after ingest");
      return;
    }
    console.log("[test] Document status:", doc.status, "preview:", doc.textPreview?.slice(0, 100));

    if (doc.status !== "completed") {
      console.error("[test] Document not completed, status:", doc.status);
      return;
    }

    console.log("\n[test] Asking: Lịch học lúc mấy giờ?");
    const result = await askDocument(doc.id, "Lịch học lúc mấy giờ?");
    console.log("[test] Answer:", result.answer);
    console.log("[test] Chunks:", result.chunksUsed, "provider:", result.provider);

    console.log("\n[test] Asking: Môn Toán học lúc nào?");
    const result2 = await askDocument(doc.id, "Môn Toán học lúc nào?");
    console.log("[test] Answer:", result2.answer);

    console.log("\n[test] Asking: Ai là tổng thống Mỹ?");
    const result3 = await askDocument(doc.id, "Ai là tổng thống Mỹ?");
    console.log("[test] Answer:", result3.answer);
  } catch (err: unknown) {
    console.error("[test] Error:", err instanceof Error ? err.message : String(err));
  }
}

main();
