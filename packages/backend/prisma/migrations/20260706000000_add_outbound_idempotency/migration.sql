-- Phase 4A: persistent outbound idempotency (additive, non-destructive).
-- Adds nullable idempotencyKey (+ unique index) and inboundMessageId to OutboundRecord.
-- SQLite treats NULLs as distinct in a unique index, so existing rows (all NULL) never collide.
-- No data is dropped or modified.

-- AlterTable
ALTER TABLE "OutboundRecord" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "OutboundRecord" ADD COLUMN "inboundMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OutboundRecord_idempotencyKey_key" ON "OutboundRecord"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboundRecord_inboundMessageId_idx" ON "OutboundRecord"("inboundMessageId");
