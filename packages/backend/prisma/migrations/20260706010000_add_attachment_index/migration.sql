-- Phase 3.5A: media/attachment memory indexing (additive, non-destructive).
-- New Attachment table only. No existing table/column/data is dropped or modified.

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "zaloMessageId" TEXT,
    "threadId" TEXT NOT NULL,
    "threadType" TEXT NOT NULL DEFAULT 'user',
    "senderId" TEXT,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileName" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "sourceUrlRedacted" TEXT,
    "storageKey" TEXT,
    "extractedText" TEXT,
    "description" TEXT,
    "extractionStatus" TEXT NOT NULL DEFAULT 'pending',
    "redactionApplied" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "model" TEXT,
    "confidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");

-- CreateIndex
CREATE INDEX "Attachment_threadId_createdAt_idx" ON "Attachment"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "Attachment_sha256_idx" ON "Attachment"("sha256");

-- CreateIndex
CREATE INDEX "Attachment_kind_idx" ON "Attachment"("kind");

-- CreateIndex
CREATE INDEX "Attachment_extractionStatus_idx" ON "Attachment"("extractionStatus");
