-- CreateTable
CREATE TABLE "ToolCallRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentName" TEXT NOT NULL DEFAULT 'hermes',
    "toolName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "threadType" TEXT NOT NULL DEFAULT 'user',
    "principalId" TEXT,
    "role" TEXT NOT NULL,
    "executionStatus" TEXT NOT NULL DEFAULT 'requested',
    "deliveryStatus" TEXT NOT NULL DEFAULT 'not_applicable',
    "idempotencyKey" TEXT,
    "idempotencyKeySource" TEXT,
    "argsRedacted" TEXT,
    "resultRedacted" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "evidence" TEXT,
    "outboundRecordId" TEXT,
    "zaloActionRecordId" TEXT,
    "agentTaskId" TEXT,
    "scheduleId" TEXT,
    "relatedMessageId" TEXT,
    "durationMs" INTEGER,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ZaloActionRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actionType" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "threadType" TEXT NOT NULL DEFAULT 'user',
    "principalId" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'system',
    "targetMsgId" TEXT,
    "payloadRedacted" TEXT,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "decision" TEXT NOT NULL DEFAULT 'allow',
    "reason" TEXT NOT NULL,
    "executionStatus" TEXT NOT NULL DEFAULT 'requested',
    "deliveryStatus" TEXT NOT NULL DEFAULT 'not_applicable',
    "providerResultId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "idempotencyKey" TEXT,
    "toolCallRecordId" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ToolCallRecord_threadId_idx" ON "ToolCallRecord"("threadId");

-- CreateIndex
CREATE INDEX "ToolCallRecord_toolName_idx" ON "ToolCallRecord"("toolName");

-- CreateIndex
CREATE INDEX "ToolCallRecord_executionStatus_idx" ON "ToolCallRecord"("executionStatus");

-- CreateIndex
CREATE INDEX "ToolCallRecord_createdAt_idx" ON "ToolCallRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ToolCallRecord_idempotencyKey_key" ON "ToolCallRecord"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ZaloActionRecord_threadId_createdAt_idx" ON "ZaloActionRecord"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "ZaloActionRecord_actionType_idx" ON "ZaloActionRecord"("actionType");

-- CreateIndex
CREATE INDEX "ZaloActionRecord_executionStatus_idx" ON "ZaloActionRecord"("executionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ZaloActionRecord_idempotencyKey_key" ON "ZaloActionRecord"("idempotencyKey");
