-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'zalo_message',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "cronExpression" TEXT,
    "scheduledAt" DATETIME,
    "nextRunAt" DATETIME,
    "messageContent" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetName" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'user',
    "originalCommand" TEXT,
    "repeatEnabled" BOOLEAN NOT NULL DEFAULT false,
    "repeatCron" TEXT,
    "pausedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ScheduleExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "scheduleVersion" INTEGER NOT NULL,
    "scheduleJobId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'scheduled',
    "plannedRunAt" DATETIME NOT NULL,
    "actualRunAt" DATETIME,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "targetId" TEXT NOT NULL,
    "targetName" TEXT,
    "messageContent" TEXT NOT NULL,
    "zaloMessageId" TEXT,
    "errorMessage" TEXT,
    "errorCode" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" DATETIME,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScheduleExecution_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduleRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "scheduleVersion" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedBy" TEXT NOT NULL DEFAULT 'user',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduleRevision_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduleJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "scheduleVersion" INTEGER NOT NULL,
    "queueJobId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'scheduled',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "scheduledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "ScheduleJob_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zaloMessageId" TEXT,
    "threadId" TEXT NOT NULL,
    "threadType" TEXT NOT NULL DEFAULT 'group',
    "senderId" TEXT,
    "senderName" TEXT,
    "content" TEXT NOT NULL,
    "isFromBot" BOOLEAN NOT NULL DEFAULT false,
    "messageType" TEXT DEFAULT 'text',
    "metadata" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ZaloThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL DEFAULT 'group',
    "name" TEXT,
    "avatarUrl" TEXT,
    "memberCount" INTEGER,
    "lastMessageAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentName" TEXT NOT NULL DEFAULT 'hermes',
    "taskType" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "result" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduleId" TEXT,
    "messageId" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "details" TEXT,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" DATETIME,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "expectedCount" INTEGER,
    "actualCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "response" TEXT,
    "messageId" TEXT,
    "checkedInAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Schedule_status_idx" ON "Schedule"("status");

-- CreateIndex
CREATE INDEX "Schedule_nextRunAt_idx" ON "Schedule"("nextRunAt");

-- CreateIndex
CREATE INDEX "Schedule_scheduledAt_idx" ON "Schedule"("scheduledAt");

-- CreateIndex
CREATE INDEX "ScheduleExecution_scheduleId_idx" ON "ScheduleExecution"("scheduleId");

-- CreateIndex
CREATE INDEX "ScheduleExecution_status_idx" ON "ScheduleExecution"("status");

-- CreateIndex
CREATE INDEX "ScheduleExecution_plannedRunAt_idx" ON "ScheduleExecution"("plannedRunAt");

-- CreateIndex
CREATE INDEX "ScheduleRevision_scheduleId_idx" ON "ScheduleRevision"("scheduleId");

-- CreateIndex
CREATE INDEX "ScheduleJob_scheduleId_idx" ON "ScheduleJob"("scheduleId");

-- CreateIndex
CREATE INDEX "ScheduleJob_queueJobId_idx" ON "ScheduleJob"("queueJobId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_zaloMessageId_key" ON "Message"("zaloMessageId");

-- CreateIndex
CREATE INDEX "Message_threadId_idx" ON "Message"("threadId");

-- CreateIndex
CREATE INDEX "Message_zaloMessageId_idx" ON "Message"("zaloMessageId");

-- CreateIndex
CREATE INDEX "Message_receivedAt_idx" ON "Message"("receivedAt");

-- CreateIndex
CREATE INDEX "ZaloThread_type_idx" ON "ZaloThread"("type");

-- CreateIndex
CREATE INDEX "AgentTask_status_idx" ON "AgentTask"("status");

-- CreateIndex
CREATE INDEX "AgentTask_createdAt_idx" ON "AgentTask"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AttendanceSession_status_idx" ON "AttendanceSession"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_sessionId_userId_key" ON "AttendanceRecord"("sessionId", "userId");
