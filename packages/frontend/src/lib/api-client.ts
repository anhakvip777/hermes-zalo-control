import { apiFetch } from "./api";

// =============================================================================
// Types (mirrored from shared — lightweight copies for frontend)
// =============================================================================

export interface Schedule {
  id: string;
  version: number;
  name: string;
  type: string;
  status: string;
  scheduledAt: string | null;
  nextRunAt: string | null;
  cronExpression: string | null;
  messageContent: string;
  targetId: string;
  targetName: string | null;
  createdBy: string;
  originalCommand: string | null;
  repeatEnabled: boolean;
  repeatCron: string | null;
  pausedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleListResponse {
  data: Schedule[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ScheduleExecution {
  id: string;
  scheduleId: string;
  scheduleVersion: number;
  mode: string;
  status: string;
  plannedRunAt: string;
  actualRunAt: string | null;
  finishedAt: string | null;
  targetId: string;
  targetName: string | null;
  messageContent: string;
  zaloMessageId: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  retryCount: number;
  dryRun: boolean;
  metadata: string | null;
  createdAt: string;
}

export interface ScheduleRevision {
  id: string;
  scheduleId: string;
  scheduleVersion: number;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  createdAt: string;
}

export interface ScheduleJob {
  id: string;
  scheduleId: string;
  scheduleVersion: number;
  queueJobId: string | null;
  type: string;
  status: string;
  scheduledAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
  completedAt: string | null;
}

export interface AdminStatus {
  sendingEnabled: boolean;
  schedulesActive: boolean;
  emergencyStop: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface RunResult {
  executionId: string;
  success?: boolean;
  wouldSend?: boolean;
  error?: string;
}

// =============================================================================
// API Client
// =============================================================================

// Schedules
export function listSchedules(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return apiFetch<ScheduleListResponse>(`/api/schedules${qs ? `?${qs}` : ""}`);
}

export function getSchedule(id: string) {
  return apiFetch<{ data: Schedule }>(`/api/schedules/${id}`);
}

export function createSchedule(body: Record<string, unknown>) {
  return apiFetch<{ data: Schedule }>("/api/schedules", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateSchedule(id: string, body: Record<string, unknown>) {
  return apiFetch<{ data: Schedule }>(`/api/schedules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function cancelSchedule(id: string) {
  return apiFetch<{ data: Schedule }>(`/api/schedules/${id}/cancel`, {
    method: "POST",
  });
}

export function pauseSchedule(id: string) {
  return apiFetch<{ data: Schedule }>(`/api/schedules/${id}/pause`, {
    method: "POST",
  });
}

export function resumeSchedule(id: string) {
  return apiFetch<{ data: Schedule }>(`/api/schedules/${id}/resume`, {
    method: "POST",
  });
}

export function runNow(id: string) {
  return apiFetch<{ data: RunResult }>(`/api/schedules/${id}/run-now`, {
    method: "POST",
  });
}

export function runDry(id: string) {
  return apiFetch<{ data: RunResult }>(`/api/schedules/${id}/run-dry`, {
    method: "POST",
  });
}

// Revisions & executions & jobs
export function getScheduleRevisions(id: string) {
  return apiFetch<{ data: ScheduleRevision[] }>(`/api/schedules/${id}/revisions`);
}

export function getScheduleExecutions(id: string) {
  return apiFetch<PaginatedResponse<ScheduleExecution>>(
    `/api/schedules/${id}/executions`,
  );
}

export function listAllExecutions(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return apiFetch<PaginatedResponse<ScheduleExecution>>(
    `/api/executions${qs ? `?${qs}` : ""}`,
  );
}

export function getScheduleJobs(id: string) {
  return apiFetch<{ data: ScheduleJob[] }>(`/api/schedules/${id}/jobs`);
}

// Admin
export function getAdminStatus() {
  return apiFetch<AdminStatus>("/api/admin/status");
}

export function adminPauseSending() {
  return apiFetch<{ success: boolean }>("/api/admin/pause-sending", {
    method: "POST",
  });
}

export function adminResumeSending() {
  return apiFetch<{ success: boolean }>("/api/admin/resume-sending", {
    method: "POST",
  });
}

export function adminEmergencyStop() {
  return apiFetch<{ success: boolean }>("/api/admin/emergency-stop", {
    method: "POST",
  });
}

export function adminClearEmergency() {
  return apiFetch<{ success: boolean }>("/api/admin/clear-emergency", {
    method: "POST",
  });
}

// Runtime Config — dryRun toggle
export interface RuntimeConfigResponse {
  effective: {
    enabled: boolean;
    dryRun: boolean;
    allowedThreads: string[];
    cooldownSeconds: number;
    groupReplyWindowSeconds: number;
    dryRunSource: "env" | "runtime";
  };
  overrides: Array<{ key: string; value: string; updatedBy: string; updatedAt: string }>;
  recentAudit: Array<{
    id: string;
    key: string;
    oldValue: string | null;
    newValue: string;
    changedBy: string;
    reason: string | null;
    backupName: string | null;
    ipAddress: string | null;
    createdAt: string;
  }>;
}

export function getRuntimeConfig() {
  return apiFetch<RuntimeConfigResponse>("/api/system/runtime-config");
}

export function setAutoReplyDryRun(input: { dryRun: boolean; confirmText: string; reason: string }) {
  return apiFetch<{ success: boolean; error?: string; errorCode?: string; backupName?: string }>(
    "/api/system/runtime-config/auto-reply",
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

// Heartbeats
export interface HeartbeatItem {
  name: string;
  status: "ok" | "stale" | "down";
  lastBeatAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  ageSeconds: number | null;
  metadata: Record<string, unknown> | null;
}

export interface HeartbeatsResponse {
  status: "ok" | "degraded" | "unhealthy";
  staleThresholdSeconds: number;
  items: HeartbeatItem[];
}

export function getHeartbeats() {
  return apiFetch<HeartbeatsResponse>("/api/system/heartbeats");
}

// ═══════════════════════════════════════════════════════════════════
// Allowed Thread Review
// ═══════════════════════════════════════════════════════════════════

export interface ThreadReviewEntry {
  threadId: string;
  threadType: "user" | "group" | "unknown";
  displayName: string | null;
  inAllowlist: boolean;
  autoReplyEnabled: boolean;
  groupMentionRequired: boolean;
  allowImageUnderstanding: boolean;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  inbound24h: number;
  outbound24h: number;
  agentTasks24h: number;
  failedTasks24h: number;
  schedulesActive: number;
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  riskReasons: string[];
}

export interface ThreadReviewSummary {
  totalThreads: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  groupCount: number;
  unknownCount: number;
  dryRun: boolean;
}

export interface ThreadReviewResponse {
  threads: ThreadReviewEntry[];
  summary: ThreadReviewSummary;
}

export function getThreadReview() {
  return apiFetch<ThreadReviewResponse>("/api/agent/threads/review");
}

export function getThreadReviewById(threadId: string) {
  return apiFetch<ThreadReviewEntry>(`/api/agent/threads/review/${threadId}`);
}

// ═══════════════════════════════════════════════════════════════════
// Error Summary
// ═══════════════════════════════════════════════════════════════════

export interface ErrorSummaryResponse {
  windowHours: number;
  status: "ok" | "warn" | "error";
  totals: {
    errors: number;
    warnings: number;
    failedAgentTasks: number;
    failedExecutions: number;
    blockedOutbound: number;
    staleHeartbeats: number;
  };
  groups: Array<{
    source: string;
    errorCode: string;
    count: number;
    lastSeenAt: string;
    severity: "low" | "medium" | "high";
  }>;
  recent: Array<{
    source: string;
    errorCode: string;
    message: string;
    seenAt: string;
    severity: "low" | "medium" | "high";
  }>;
}

export function getErrorSummary(hours = 24) {
  return apiFetch<ErrorSummaryResponse>(`/api/system/errors/summary?hours=${hours}`);
}

export function triggerTestAlert() {
  return apiFetch<{ success: boolean; dryRun: boolean; messagePreview: string; fingerprint: string }>(
    "/api/system/errors/test-alert",
    { method: "POST" },
  );
}

// ═══════════════════════════════════════════════════════════════════
// Messages
// ═══════════════════════════════════════════════════════════════════

export interface MessageItem {
  id: string;
  threadId: string;
  threadType: string;
  senderId: string | null;
  senderName: string | null;
  content: string;
  isFromBot: boolean;
  messageType: string;
  role: string;
  relatedMessageId: string | null;
  metadata: string | null;
  receivedAt: string;
  createdAt: string;
  /** ThreadProfile enrichment (Batch T1) */
  thread?: {
    id: string;
    displayName: string | null;
    type: string | null;
    avatarUrl: string | null;
  } | null;
  /** OutboundRecord enrichment (U1) — null when no outbound record found */
  outbound?: {
    id: string;
    decision: string;
    reason: string;
    dryRun: boolean;
    sentMessageId: string | null;
    errorCode: string | null;
    source: string;
    createdAt: string;
  } | null;
}

export interface MessageListResponse {
  data: MessageItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function listMessages(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params).toString();
  return apiFetch<MessageListResponse>(`/api/agent/messages?${q}`);
}

// ═══════════════════════════════════════════════════════════════════
// Health (for system-health page)
// ═══════════════════════════════════════════════════════════════════

export interface HealthDetailResponse {
  status: string;
  timestamp: string;
  uptimeSeconds: number;
  version: string;
  backend: { pid: number; nodeEnv: string; port: number };
  db: { ok: boolean; path: string; sizeBytes: number; criticalTables: Record<string, number | null> };
  zalo: { connected: boolean; listenerStarted: boolean; uid: string | null; lastConnectedAt: string | null; lastError: string | null };
  autoReply: { enabled: boolean; dryRun: boolean; allowedThreadsCount: number; cooldownSeconds: number; activeCooldowns: number };
  worker: { active: boolean; queuedJobs: number; failedJobs24h: number };
  backup: { latestBackupAt: string | null; latestBackupName: string | null; backupCount: number; latestBackupAgeHours: number | null };
  processLock: { locked: boolean; ownerPid: number | null; isOwner: boolean; startedAt: string | null };
  config: { status: string; pass: number; warn: number; error: number };
  messages: { inbound24h: number; outbound24h: number; lastInboundAt: string | null; lastOutboundAt: string | null };
  errors: { failedAgentTasks24h: number; failedExecutions24h: number };
  heartbeats: Record<string, { name: string; status: string; lastBeatAt: string | null; lastError: string | null; ageSeconds: number | null }>;
  allowedThreadsReview: { count: number; highRiskCount: number; groupCount: number; unknownCount: number };
  errorsSummary: { status: string; errors24h: number; warnings24h: number; topErrorCode: string | null; lastErrorAt: string | null };
}

export function getHealthDetail() {
  return apiFetch<HealthDetailResponse>("/api/system/health/detail");
}

// ═══════════════════════════════════════════════════════════════════
// Config Check
// ═══════════════════════════════════════════════════════════════════

export interface ConfigCheckResponse {
  status: string;
  checks: Array<{ name: string; severity: string; message: string; safe: boolean }>;
  summary: { pass: number; warn: number; error: number };
}

export function getConfigCheck() {
  return apiFetch<ConfigCheckResponse>("/api/system/config-check");
}

// ═══════════════════════════════════════════════════════════════════
// Admin Status (for admin-tools)
// ═══════════════════════════════════════════════════════════════════

export function getAdminSettings() {
  return apiFetch<Record<string, unknown>>("/api/admin/settings");
}

// ═══════════════════════════════════════════════════════════════════
// Rule Engine
// ═══════════════════════════════════════════════════════════════════

export interface RuleOutput {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  triggerType: string;
  conditions: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  targetThreadIds: string[] | null;
  cooldownSeconds: number | null;
  matchCount: number;
  lastMatchedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuleVersionOutput {
  id: string;
  ruleId: string;
  version: number;
  snapshot: Record<string, unknown>;
  changedBy: string | null;
  changeReason: string | null;
  createdAt: string;
}

export interface RuleExecutionOutput {
  id: string;
  ruleId: string | null;
  messageId: string | null;
  threadId: string | null;
  matched: boolean;
  actionTaken: string | null;
  result: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface SimulatorOutput {
  matched: boolean;
  matchedRules: Array<{
    ruleId: string;
    ruleName: string;
    triggerType: string;
    matchDetails: string;
  }>;
  winningRule: {
    ruleId: string;
    ruleName: string;
    actionType: string;
    actionPreview: string;
  } | null;
  action: { type: string | null; preview: string | null };
  wouldSend: boolean;
  reason: string;
}

export function listRules() {
  return apiFetch<{ data: RuleOutput[]; total: number }>("/api/rules");
}

export function getRule(id: string) {
  return apiFetch<{ data: RuleOutput }>(`/api/rules/${id}`);
}

export function createRule(body: Record<string, unknown>) {
  return apiFetch<{ data: RuleOutput; version: RuleVersionOutput }>("/api/rules", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateRule(id: string, body: Record<string, unknown>) {
  return apiFetch<{ data: RuleOutput; version: RuleVersionOutput }>(`/api/rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function enableRule(id: string) {
  return apiFetch<{ data: RuleOutput }>(`/api/rules/${id}/enable`, { method: "POST" });
}

export function disableRule(id: string) {
  return apiFetch<{ data: RuleOutput }>(`/api/rules/${id}/disable`, { method: "POST" });
}

export function getRuleVersions(id: string) {
  return apiFetch<{ data: RuleVersionOutput[] }>(`/api/rules/${id}/versions`);
}

export function getRuleExecutions(id: string, limit = 50) {
  return apiFetch<{ data: RuleExecutionOutput[]; total: number }>(`/api/rules/${id}/executions?limit=${limit}`);
}

export function simulateRules(body: Record<string, unknown>) {
  return apiFetch<{ data: SimulatorOutput }>("/api/rules/test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ═══════════════════════════════════════════════════════════════════
// Document Understanding
// ═══════════════════════════════════════════════════════════════════

export interface DocumentOutput {
  id: string;
  fileName: string;
  originalPath: string;
  mimeType: string | null;
  extension: string;
  sizeBytes: number;
  sha256: string;
  status: string;
  markdownPath: string | null;
  textPreview: string | null;
  provider: string;
  errorCode: string | null;
  errorMessage: string | null;
  source: string | null;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentChunkOutput {
  id: string;
  documentId: string;
  chunkIndex: number;
  heading: string | null;
  text: string;
  pageStart: number | null;
  pageEnd: number | null;
  tokenEstimate: number | null;
  metadata: Record<string, unknown> | null;
}

export interface AskResult {
  question: string;
  answer: string;
  chunksUsed: number;
  provider: string;
}

export function ingestDocument(body: Record<string, unknown>) {
  return apiFetch<{ data: DocumentOutput }>("/api/documents/ingest", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listDocuments(limit = 50) {
  return apiFetch<{ data: DocumentOutput[]; total: number }>(`/api/documents?limit=${limit}`);
}

export function getDocument(id: string) {
  return apiFetch<{ data: DocumentOutput }>(`/api/documents/${id}`);
}

export function getDocumentMarkdown(id: string) {
  return apiFetch<{ data: string }>(`/api/documents/${id}/markdown`);
}

export function getDocumentChunks(id: string) {
  return apiFetch<{ data: DocumentChunkOutput[]; total: number }>(`/api/documents/${id}/chunks`);
}

export function askDocument(id: string, question: string) {
  return apiFetch<{ data: AskResult }>(`/api/documents/${id}/ask`, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

// Batch 13: Re-ingest and delete
export function reingestDocument(id: string) {
  return apiFetch<{ data: { documentId: string; jobId: string; status: string; method: string; fileName: string } }>(
    `/api/documents/${id}/reingest`,
    { method: "POST" },
  );
}

export function deleteDocument(id: string) {
  return apiFetch<{ data: { id: string; deleted: boolean } }>(
    `/api/documents/${id}`,
    { method: "DELETE" },
  );
}

// ═══════════════════════════════════════════════════════════════════
// Batch 16 — Zalo Live-Safe Operations Dashboard API
// ═══════════════════════════════════════════════════════════════════

export interface ZaloOpsStatus {
  connected: boolean;
  connectionStatus: string;
  selfUserId: string | null;
  selfDisplayName: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  lastMessageAt: string | null;
  listenerActive: boolean;
  dryRun: boolean;
  dryRunSource: "env" | "runtime";
  allowedThreads: string[];
  cooldownSeconds: number;
  session: {
    exists: boolean;
    age: string | null;
    ageSeconds: number | null;
    path: string | null;
    qrAvailable: boolean;
    qrUpdatedAt: string | null;
    fileSize: number | null;
    updatedAt: string | null;
    quarantinedFiles: string[];
    warning: string | null;
  };
  heartbeats: {
    zaloConnection: { status: string; lastBeatAt: string | null; ageSeconds: number | null };
    zaloListener: { status: string; lastBeatAt: string | null; ageSeconds: number | null };
    messagePipeline: { status: string; lastBeatAt: string | null; ageSeconds: number | null };
  };
  inbound24h: number;
  outbound24h: number;
  failedTasks24h: number;
}

export interface ReconnectResult {
  success: boolean;
  status: string;
  message: string;
  auditId?: string;
}

export interface DisconnectResult {
  success: boolean;
  status: string;
  auditId?: string;
}

export interface QRStatusOutput {
  qrAvailable: boolean;
  qrUpdatedAt: string | null;
  status: string;
  message: string;
}

export interface TestDMResult {
  allowed: boolean;
  reason?: string;
  auditId?: string;
  agentTaskId?: string;
}

export interface RecentEvent {
  type: "inbound" | "outbound" | "reaction" | "document" | "error";
  timestamp: string;
  threadId?: string;
  senderId?: string;
  senderName?: string;
  content?: string;
  detail?: string;
  errorCode?: string;
}

export interface RecentEventsResponse {
  inbound: RecentEvent[];
  outbound: RecentEvent[];
  errors: RecentEvent[];
}

export function getZaloOpsStatus() {
  return apiFetch<ZaloOpsStatus>("/api/zalo/ops/status");
}

export function reconnectZalo(userId?: string) {
  return apiFetch<ReconnectResult>("/api/zalo/ops/reconnect", {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export function disconnectZalo(userId?: string) {
  return apiFetch<DisconnectResult>("/api/zalo/ops/disconnect", {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export function getZaloQRStatus() {
  return apiFetch<QRStatusOutput>("/api/zalo/ops/qr");
}

export function testDM(threadId: string, content?: string, userId?: string) {
  return apiFetch<TestDMResult>("/api/zalo/ops/test-dm", {
    method: "POST",
    body: JSON.stringify({ threadId, content, userId }),
  });
}

export function getRecentEvents() {
  return apiFetch<RecentEventsResponse>("/api/zalo/ops/recent-events");
}

// ═══════════════════════════════════════════════════════════════════
// Batch 17 — Production Readiness Gate
// ═══════════════════════════════════════════════════════════════════

export interface ReadinessCheck {
  id: string;
  label: string;
  category: string;
  status: "pass" | "warn" | "fail";
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  action?: string;
}

export interface ReadinessResult {
  verdict: "READY_FOR_LIVE" | "WARNING_ONLY" | "NOT_READY";
  score: number;
  timestamp: string;
  checks: ReadinessCheck[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
    criticalFail: number;
    highFail: number;
  };
}

export function getProductionReadiness() {
  return apiFetch<ReadinessResult>("/api/system/production-readiness");
}

// ═══════════════════════════════════════════════════════════════════
// Batch 18 — Controlled Live Test Mode
// ═══════════════════════════════════════════════════════════════════

export interface LiveTestStatusResult {
  active: boolean;
  session: {
    id: string;
    threadId: string;
    maxMessages: number;
    sentCount: number;
    ttlSeconds: number;
    expiresAt: string;
    status: string;
    reason: string | null;
    createdBy: string | null;
    createdAt: string;
    remainingMs: number;
  } | null;
  dryRun: boolean;
}

export interface StartLiveTestResult {
  success: boolean;
  sessionId?: string;
  error?: string;
  errorCode?: string;
  expiresAt?: string;
}

export function getLiveTestStatus() {
  return apiFetch<LiveTestStatusResult>("/api/system/live-test/status");
}

export function startLiveTest(input: {
  threadId: string;
  maxMessages: number;
  ttlSeconds: number;
  confirmText: string;
  reason: string;
  createdBy?: string;
}) {
  return apiFetch<StartLiveTestResult>("/api/system/live-test/start", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function stopLiveTest() {
  return apiFetch<{ success: boolean }>("/api/system/live-test/stop", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// ═══════════════════════════════════════════════════════════════════
// P1.3 — Access Control (ZaloPrincipal CRUD + Audit)
// ═══════════════════════════════════════════════════════════════════

export interface ZaloPrincipal {
  id: string;
  principalId: string;
  type: "user" | "group" | "thread";
  role: "form_only" | "basic_chat" | "advanced" | "admin";
  status: "active" | "blocked";
  displayName: string | null;
  threadId: string | null;
  notes: string | null;
  createdBy: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrincipalListResponse {
  items: ZaloPrincipal[];
  total: number;
}

export interface PrincipalAuditEntry {
  id: string;
  principalId: string;
  threadId: string | null;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  actor: string | null;
  reason: string | null;
  createdAt: string;
}

export interface AuditListResponse {
  items: PrincipalAuditEntry[];
  total: number;
}

export function listPrincipals(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return apiFetch<PrincipalListResponse>(`/api/access/principals${qs ? `?${qs}` : ""}`);
}

export function getPrincipal(id: string) {
  return apiFetch<ZaloPrincipal>(`/api/access/principals/${id}`);
}

export function createPrincipal(body: Record<string, unknown>) {
  return apiFetch<ZaloPrincipal>("/api/access/principals", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updatePrincipalRole(id: string, body: Record<string, unknown>) {
  return apiFetch<ZaloPrincipal>(`/api/access/principals/${id}/role`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function updatePrincipalStatus(id: string, body: Record<string, unknown>) {
  return apiFetch<ZaloPrincipal>(`/api/access/principals/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function updatePrincipal(id: string, body: Record<string, unknown>) {
  return apiFetch<ZaloPrincipal>(`/api/access/principals/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function listAudit(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return apiFetch<AuditListResponse>(`/api/access/audit${qs ? `?${qs}` : ""}`);
}
