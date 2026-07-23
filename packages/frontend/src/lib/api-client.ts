import { ApiError, apiFetch } from "./api";

function invalidResponse(endpoint: string, body: unknown): never {
  throw new ApiError(0, `Invalid response from ${endpoint}`, body, "INVALID_RESPONSE");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidTimestamp(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const parsed = new Date(timestamp);
  const milliseconds = Number((match[7] ?? "").padEnd(3, "0"));
  return parsed.getUTCFullYear() === Number(match[1]) &&
    parsed.getUTCMonth() + 1 === Number(match[2]) &&
    parsed.getUTCDate() === Number(match[3]) &&
    parsed.getUTCHours() === Number(match[4]) &&
    parsed.getUTCMinutes() === Number(match[5]) &&
    parsed.getUTCSeconds() === Number(match[6]) &&
    parsed.getUTCMilliseconds() === milliseconds;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

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

function isRuntimeConfigResponse(value: unknown): value is RuntimeConfigResponse {
  if (!isRecord(value) || !isRecord(value.effective) || !Array.isArray(value.overrides) || !Array.isArray(value.recentAudit)) return false;
  const effective = value.effective;
  return typeof effective.enabled === "boolean" &&
    typeof effective.dryRun === "boolean" &&
    Array.isArray(effective.allowedThreads) && effective.allowedThreads.every((thread) => typeof thread === "string") &&
    typeof effective.cooldownSeconds === "number" && Number.isFinite(effective.cooldownSeconds) &&
    typeof effective.groupReplyWindowSeconds === "number" && Number.isFinite(effective.groupReplyWindowSeconds) &&
    (effective.dryRunSource === "env" || effective.dryRunSource === "runtime");
}

export async function getRuntimeConfig() {
  const result = await apiFetch<unknown>("/api/system/runtime-config");
  if (!isRuntimeConfigResponse(result)) invalidResponse("/api/system/runtime-config", result);
  return result;
}

export function setAutoReplyDryRun(input: { dryRun: boolean; confirmText: string; reason: string }) {
  return apiFetch<{ success: boolean; error?: string; errorCode?: string; backupName?: string }>(
    "/api/system/runtime-config/auto-reply",
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

// Heartbeats
export interface HeartbeatItem {
  name: "backend" | "zaloListener" | "zaloConnection" | "schedulerWorker" | "messagePipeline";
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

const SYSTEM_HEARTBEAT_NAMES = [
  "backend",
  "zaloListener",
  "zaloConnection",
  "schedulerWorker",
  "messagePipeline",
] as const;
const HEARTBEAT_ITEM_KEYS = [
  "name",
  "status",
  "lastBeatAt",
  "lastSuccessAt",
  "lastErrorAt",
  "lastError",
  "ageSeconds",
  "metadata",
] as const;
const HEARTBEATS_RESPONSE_KEYS = ["status", "staleThresholdSeconds", "items"] as const;

function isSystemHeartbeatName(value: unknown): value is HeartbeatItem["name"] {
  return typeof value === "string" &&
    (SYSTEM_HEARTBEAT_NAMES as readonly string[]).includes(value);
}

function isHeartbeatItem(value: unknown): value is HeartbeatItem {
  return isRecord(value) &&
    hasExactKeys(value, HEARTBEAT_ITEM_KEYS) &&
    isSystemHeartbeatName(value.name) &&
    (value.status === "ok" || value.status === "stale" || value.status === "down") &&
    isNullableTimestamp(value.lastBeatAt) &&
    isNullableTimestamp(value.lastSuccessAt) &&
    isNullableTimestamp(value.lastErrorAt) &&
    isNullableString(value.lastError) &&
    isNullableNonNegativeInteger(value.ageSeconds) &&
    (value.metadata === null || isRecord(value.metadata));
}

function isHeartbeatsResponse(value: unknown): value is HeartbeatsResponse {
  if (!isRecord(value) ||
      !hasExactKeys(value, HEARTBEATS_RESPONSE_KEYS) ||
      !isNonNegativeInteger(value.staleThresholdSeconds) ||
      !Array.isArray(value.items) ||
      !value.items.every(isHeartbeatItem)) {
    return false;
  }

  if (value.status !== "ok" && value.status !== "degraded" && value.status !== "unhealthy") {
    return false;
  }

  const items = value.items as HeartbeatItem[];
  const names = items.map((item) => item.name);
  if (items.length !== SYSTEM_HEARTBEAT_NAMES.length || new Set(names).size !== names.length) return false;

  const criticalDown = items.some(
    (item) => (item.name === "backend" || item.name === "zaloConnection") && item.status === "down",
  );
  const hasProblem = items.some((item) => item.status === "down" || item.status === "stale");
  const expectedStatus: HeartbeatsResponse["status"] =
    criticalDown ? "unhealthy" : hasProblem ? "degraded" : "ok";
  return value.status === expectedStatus;
}

export async function getHeartbeats(signal?: AbortSignal) {
  const result = await apiFetch<unknown>("/api/system/heartbeats", { signal });
  if (!isHeartbeatsResponse(result)) invalidResponse("/api/system/heartbeats", result);
  return result;
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
// Thread Settings
// ═══════════════════════════════════════════════════════════════════

export interface ThreadSettingsItem {
  id: string;
  threadId: string;
  threadType: "user" | "group" | "unknown";
  autoReplyEnabled: boolean;
  groupMentionRequired: boolean;
  groupReplyWindowSeconds: number;
  allowCreateReminder: boolean;
  allowMedia: boolean;
  allowImageUnderstanding: boolean;
  allowDocumentUnderstanding: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadSettingsResponse {
  data: ThreadSettingsItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const THREAD_SETTINGS_ITEM_KEYS = [
  "id",
  "threadId",
  "threadType",
  "autoReplyEnabled",
  "groupMentionRequired",
  "groupReplyWindowSeconds",
  "allowCreateReminder",
  "allowMedia",
  "allowImageUnderstanding",
  "allowDocumentUnderstanding",
  "notes",
  "createdAt",
  "updatedAt",
] as const;

const THREAD_SETTINGS_RESPONSE_KEYS = ["data", "total", "page", "pageSize", "totalPages"] as const;

function isThreadSettingsItem(value: unknown): value is ThreadSettingsItem {
  return isRecord(value) &&
    hasExactKeys(value, THREAD_SETTINGS_ITEM_KEYS) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.threadId) &&
    (value.threadType === "user" || value.threadType === "group" || value.threadType === "unknown") &&
    typeof value.autoReplyEnabled === "boolean" &&
    typeof value.groupMentionRequired === "boolean" &&
    isNonNegativeInteger(value.groupReplyWindowSeconds) &&
    typeof value.allowCreateReminder === "boolean" &&
    typeof value.allowMedia === "boolean" &&
    typeof value.allowImageUnderstanding === "boolean" &&
    typeof value.allowDocumentUnderstanding === "boolean" &&
    isNullableString(value.notes) &&
    isValidTimestamp(value.createdAt) &&
    isValidTimestamp(value.updatedAt);
}

function isThreadSettingsResponse(value: unknown): value is ThreadSettingsResponse {
  if (!isRecord(value) || !hasExactKeys(value, THREAD_SETTINGS_RESPONSE_KEYS) ||
      !Array.isArray(value.data) || !value.data.every(isThreadSettingsItem) ||
      !isNonNegativeInteger(value.total) ||
      !Number.isInteger(value.page) || (value.page as number) < 1 ||
      !Number.isInteger(value.pageSize) || (value.pageSize as number) < 1 ||
      !isNonNegativeInteger(value.totalPages)) {
    return false;
  }

  const total = value.total as number;
  const page = value.page as number;
  const pageSize = value.pageSize as number;
  const totalPages = value.totalPages as number;
  const expectedTotalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const expectedItemCount = Math.max(0, Math.min(pageSize, total - ((page - 1) * pageSize)));
  const pageInRange = total === 0 ? page === 1 : page <= totalPages;
  return totalPages === expectedTotalPages && pageInRange && value.data.length === expectedItemCount;
}

export async function getThreadSettings(params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.pageSize !== undefined) query.set("pageSize", String(params.pageSize));
  const qs = query.toString();
  const result = await apiFetch<unknown>(`/api/threads/settings${qs ? `?${qs}` : ""}`);
  if (!isThreadSettingsResponse(result)) invalidResponse("/api/threads/settings", result);
  return result;
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
    source: "AgentTask" | "ScheduleExecution" | "OutboundRecord" | "Heartbeat" | "Config";
    errorCode: string;
    count: number;
    lastSeenAt: string;
    sampleMessage?: string;
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

function isErrorSeverity(value: unknown): value is "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high";
}

function isErrorGroupSource(
  value: unknown,
): value is "AgentTask" | "ScheduleExecution" | "OutboundRecord" | "Heartbeat" | "Config" {
  return value === "AgentTask" ||
    value === "ScheduleExecution" ||
    value === "OutboundRecord" ||
    value === "Heartbeat" ||
    value === "Config";
}

const ERROR_SUMMARY_KEYS = ["windowHours", "status", "totals", "groups", "recent"] as const;
const ERROR_TOTAL_KEYS = [
  "errors",
  "warnings",
  "failedAgentTasks",
  "failedExecutions",
  "blockedOutbound",
  "staleHeartbeats",
] as const;
const ERROR_GROUP_KEYS = ["source", "errorCode", "count", "lastSeenAt", "sampleMessage", "severity"] as const;
const RECENT_ERROR_KEYS = ["source", "errorCode", "message", "seenAt", "severity"] as const;

function isErrorSummaryResponse(value: unknown): value is ErrorSummaryResponse {
  if (!isRecord(value) || !hasExactKeys(value, ERROR_SUMMARY_KEYS) ||
      !isRecord(value.totals) || !hasExactKeys(value.totals, ERROR_TOTAL_KEYS) ||
      !Array.isArray(value.groups) || !Array.isArray(value.recent)) {
    return false;
  }
  const totals = value.totals;
  const valid = Number.isInteger(value.windowHours) &&
    (value.windowHours as number) >= 1 &&
    (value.windowHours as number) <= 168 &&
    (value.status === "ok" || value.status === "warn" || value.status === "error") &&
    ERROR_TOTAL_KEYS.every((key) => isNonNegativeInteger(totals[key])) &&
    value.groups.every((group) => isRecord(group) &&
      hasOnlyKeys(group, ERROR_GROUP_KEYS) &&
      isErrorGroupSource(group.source) &&
      isNonEmptyString(group.errorCode) &&
      isNonNegativeInteger(group.count) && group.count > 0 &&
      isValidTimestamp(group.lastSeenAt) &&
      (group.sampleMessage === undefined || typeof group.sampleMessage === "string") &&
      isErrorSeverity(group.severity)) &&
    value.recent.every((entry) => isRecord(entry) &&
      hasExactKeys(entry, RECENT_ERROR_KEYS) &&
      isNonEmptyString(entry.source) &&
      isNonEmptyString(entry.errorCode) &&
      isNonEmptyString(entry.message) &&
      isValidTimestamp(entry.seenAt) &&
      isErrorSeverity(entry.severity));

  if (!valid) return false;

  const errors = value.groups
    .filter((group) => group.severity === "high")
    .reduce((total, group) => total + group.count, 0);
  const warnings = value.groups
    .filter((group) => group.severity !== "high")
    .reduce((total, group) => total + group.count, 0);
  const failedAgentTasks = value.groups
    .filter((group) => group.source === "AgentTask")
    .reduce((total, group) => total + group.count, 0);
  const failedExecutions = value.groups
    .filter((group) => group.source === "ScheduleExecution")
    .reduce((total, group) => total + group.count, 0);
  const blockedOutbound = value.groups
    .filter((group) => group.source === "OutboundRecord")
    .reduce((total, group) => total + group.count, 0);
  const staleHeartbeats = value.groups
    .filter((group) => group.source === "Heartbeat").length;
  const expectedStatus: ErrorSummaryResponse["status"] =
    errors > 0 ? "error" : value.groups.length > 0 ? "warn" : "ok";

  return totals.errors === errors &&
    totals.warnings === warnings &&
    totals.failedAgentTasks === failedAgentTasks &&
    totals.failedExecutions === failedExecutions &&
    totals.blockedOutbound === blockedOutbound &&
    totals.staleHeartbeats === staleHeartbeats &&
    value.status === expectedStatus;
}

export async function getErrorSummary(hours = 24, signal?: AbortSignal) {
  const result = await apiFetch<unknown>(`/api/system/errors/summary?hours=${hours}`, { signal });
  if (!isErrorSummaryResponse(result)) invalidResponse("/api/system/errors/summary", result);
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// Messages
// ═══════════════════════════════════════════════════════════════════

export interface MessageItem {
  id: string;
  zaloMessageId: string | null;
  threadId: string;
  threadType: "user" | "group";
  senderId: string | null;
  senderName: string | null;
  content: string;
  isFromBot: boolean;
  messageType: string | null;
  role: "user" | "assistant" | "system";
  relatedMessageId: string | null;
  metadata: string | null;
  receivedAt: string;
  createdAt: string;
  /** ThreadProfile enrichment (Batch T1) */
  thread: {
    id: string;
    displayName: string | null;
    type: "user" | "group" | null;
    avatarUrl: string | null;
  };
  /** OutboundRecord enrichment (U1) — null when no outbound record found */
  outbound: {
    id: string;
    decision: "allow" | "skip" | "block";
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

const MESSAGE_ITEM_KEYS = [
  "id",
  "zaloMessageId",
  "threadId",
  "threadType",
  "senderId",
  "senderName",
  "content",
  "isFromBot",
  "messageType",
  "role",
  "relatedMessageId",
  "metadata",
  "receivedAt",
  "createdAt",
  "thread",
  "outbound",
] as const;

const MESSAGE_THREAD_KEYS = ["id", "displayName", "type", "avatarUrl"] as const;
const MESSAGE_OUTBOUND_KEYS = [
  "id",
  "decision",
  "reason",
  "dryRun",
  "sentMessageId",
  "errorCode",
  "source",
  "createdAt",
] as const;
const MESSAGE_LIST_KEYS = ["data", "total", "page", "pageSize", "totalPages"] as const;

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isMessageItem(value: unknown): value is MessageItem {
  if (!isRecord(value) || !hasExactKeys(value, MESSAGE_ITEM_KEYS)) return false;
  const thread = value.thread;
  const outbound = value.outbound;
  const threadValid = isRecord(thread) &&
    hasExactKeys(thread, MESSAGE_THREAD_KEYS) &&
    isNonEmptyString(thread.id) &&
    thread.id === value.threadId &&
    isNullableString(thread.displayName) &&
    (thread.type === "user" || thread.type === "group" || thread.type === null) &&
    isNullableString(thread.avatarUrl);
  const outboundValid = outbound === null || (
    isRecord(outbound) &&
    hasExactKeys(outbound, MESSAGE_OUTBOUND_KEYS) &&
    isNonEmptyString(outbound.id) &&
    (outbound.decision === "allow" || outbound.decision === "skip" || outbound.decision === "block") &&
    isNonEmptyString(outbound.reason) &&
    typeof outbound.dryRun === "boolean" &&
    isNullableString(outbound.sentMessageId) &&
    isNullableNonEmptyString(outbound.errorCode) &&
    isNonEmptyString(outbound.source) &&
    isValidTimestamp(outbound.createdAt)
  );
  const roleValid = (value.role === "user" && value.isFromBot === false) ||
    ((value.role === "assistant" || value.role === "system") && value.isFromBot === true);
  return isNonEmptyString(value.id) &&
    isNullableNonEmptyString(value.zaloMessageId) &&
    isNonEmptyString(value.threadId) &&
    (value.threadType === "user" || value.threadType === "group") &&
    isNullableString(value.senderId) &&
    isNullableString(value.senderName) &&
    typeof value.content === "string" &&
    typeof value.isFromBot === "boolean" &&
    isNullableNonEmptyString(value.messageType) &&
    roleValid &&
    isNullableNonEmptyString(value.relatedMessageId) &&
    isNullableString(value.metadata) &&
    isValidTimestamp(value.receivedAt) &&
    isValidTimestamp(value.createdAt) &&
    threadValid &&
    outboundValid;
}

function isMessageListResponse(value: unknown): value is MessageListResponse {
  if (!isRecord(value) || !hasExactKeys(value, MESSAGE_LIST_KEYS) ||
      !Array.isArray(value.data) || !value.data.every(isMessageItem) ||
      !isNonNegativeInteger(value.total) ||
      !Number.isInteger(value.page) || (value.page as number) < 1 ||
      !Number.isInteger(value.pageSize) || (value.pageSize as number) < 1 ||
      !isNonNegativeInteger(value.totalPages)) {
    return false;
  }

  const total = value.total as number;
  const page = value.page as number;
  const pageSize = value.pageSize as number;
  const totalPages = value.totalPages as number;
  const expectedTotalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const expectedItemCount = Math.max(0, Math.min(pageSize, total - ((page - 1) * pageSize)));
  const pageInRange = total === 0 ? page === 1 : page <= totalPages;
  return totalPages === expectedTotalPages && pageInRange && value.data.length === expectedItemCount;
}

export async function listMessages(params: Record<string, string> = {}, signal?: AbortSignal) {
  const q = new URLSearchParams(params).toString();
  const result = await apiFetch<unknown>(`/api/agent/messages?${q}`, { signal });
  if (!isMessageListResponse(result)) invalidResponse("/api/agent/messages", result);
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// Health (for system-health page)
// ═══════════════════════════════════════════════════════════════════

export interface HealthDetailResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptimeSeconds: number;
  version: string;
  backend: { pid: number; nodeEnv: string; port: number };
  db: { ok: boolean; path: string | null; sizeBytes: number; criticalTables: Record<string, number | null> };
  zalo: { connected: boolean; listenerStarted: boolean; uid: string | null; lastConnectedAt: string | null; lastError: string | null };
  autoReply: { enabled: boolean; dryRun: boolean; allowedThreadsCount: number; cooldownSeconds: number; activeCooldowns: number };
  worker: { active: boolean; queuedJobs: number; failedJobs24h: number };
  backup: { latestBackupAt: string | null; latestBackupName: string | null; backupCount: number; latestBackupAgeHours: number | null };
  processLock: { locked: boolean; ownerPid: number | null; isOwner: boolean; startedAt: string | null };
  config: { status: "CONFIG_OK" | "CONFIG_WARN" | "CONFIG_ERROR"; pass: number; warn: number; error: number };
  messages: { inbound24h: number; outbound24h: number; lastInboundAt: string | null; lastOutboundAt: string | null };
  errors: { failedAgentTasks24h: number; failedExecutions24h: number };
  heartbeats: Record<string, HeartbeatItem>;
  allowedThreadsReview: { count: number; highRiskCount: number; groupCount: number; unknownCount: number };
  errorsSummary: { status: "ok" | "warn" | "error"; errors24h: number; warnings24h: number; topErrorCode: string | null; lastErrorAt: string | null };
}

const HEALTH_ROOT_KEYS = [
  "status", "timestamp", "uptimeSeconds", "version", "backend", "db", "zalo",
  "autoReply", "worker", "backup", "processLock", "config", "messages", "errors",
  "heartbeats", "allowedThreadsReview", "errorsSummary",
] as const;
const HEALTH_BACKEND_KEYS = ["pid", "nodeEnv", "port"] as const;
const HEALTH_DB_KEYS = ["ok", "path", "sizeBytes", "criticalTables"] as const;
const HEALTH_ZALO_KEYS = ["connected", "listenerStarted", "uid", "lastConnectedAt", "lastError"] as const;
const HEALTH_AUTO_REPLY_KEYS = ["enabled", "dryRun", "allowedThreadsCount", "cooldownSeconds", "activeCooldowns"] as const;
const HEALTH_WORKER_KEYS = ["active", "queuedJobs", "failedJobs24h"] as const;
const HEALTH_BACKUP_KEYS = ["latestBackupAt", "latestBackupName", "backupCount", "latestBackupAgeHours"] as const;
const HEALTH_PROCESS_LOCK_KEYS = ["locked", "ownerPid", "isOwner", "startedAt"] as const;
const HEALTH_CONFIG_KEYS = ["status", "pass", "warn", "error"] as const;
const HEALTH_MESSAGES_KEYS = ["inbound24h", "outbound24h", "lastInboundAt", "lastOutboundAt"] as const;
const HEALTH_ERRORS_KEYS = ["failedAgentTasks24h", "failedExecutions24h"] as const;
const HEALTH_THREAD_REVIEW_KEYS = ["count", "highRiskCount", "groupCount", "unknownCount"] as const;
const HEALTH_ERRORS_SUMMARY_KEYS = ["status", "errors24h", "warnings24h", "topErrorCode", "lastErrorAt"] as const;
const HEALTH_CRITICAL_TABLE_KEYS = [
  "Message",
  "AgentTask",
  "Schedule",
  "ScheduleJob",
  "ThreadSetting",
  "OutboundRecord",
] as const;

function isConfigSummaryStatus(
  status: unknown,
  pass: number,
  warn: number,
  error: number,
): status is "CONFIG_OK" | "CONFIG_WARN" | "CONFIG_ERROR" {
  if (status !== "CONFIG_OK" && status !== "CONFIG_WARN" && status !== "CONFIG_ERROR") return false;
  const expected = error > 0 ? "CONFIG_ERROR" : warn > 0 ? "CONFIG_WARN" : "CONFIG_OK";
  return status === expected && pass + warn + error >= 0;
}

function expectedHealthStatus(value: HealthDetailResponse): HealthDetailResponse["status"] {
  const missingCriticalTable = HEALTH_CRITICAL_TABLE_KEYS.some((table) =>
    !Object.prototype.hasOwnProperty.call(value.db.criticalTables, table) ||
    value.db.criticalTables[table] === null
  );
  const criticalHeartbeatDown = value.heartbeats.backend?.status === "down" ||
    value.heartbeats.zaloConnection?.status === "down";
  const criticalHeartbeatStale = value.heartbeats.backend?.status === "stale" ||
    value.heartbeats.zaloConnection?.status === "stale";

  if (!value.db.ok || missingCriticalTable ||
      (value.processLock.locked && !value.processLock.isOwner) || criticalHeartbeatDown) {
    return "unhealthy";
  }
  if (criticalHeartbeatStale ||
      !value.zalo.connected ||
      (value.backup.latestBackupAgeHours !== null && value.backup.latestBackupAgeHours > 24) ||
      value.config.status !== "CONFIG_OK" ||
      !value.worker.active ||
      value.errors.failedAgentTasks24h > 10 ||
      value.errors.failedExecutions24h > 5 ||
      (value.allowedThreadsReview.highRiskCount > 0 && !value.autoReply.dryRun) ||
      value.errorsSummary.status === "error") {
    return "degraded";
  }
  return "healthy";
}

function isHealthDetailResponse(value: unknown): value is HealthDetailResponse {
  if (!isRecord(value) || !hasExactKeys(value, HEALTH_ROOT_KEYS) ||
      !isRecord(value.backend) || !hasExactKeys(value.backend, HEALTH_BACKEND_KEYS) ||
      !isRecord(value.db) || !hasExactKeys(value.db, HEALTH_DB_KEYS) || !isRecord(value.db.criticalTables) ||
      !isRecord(value.zalo) || !hasExactKeys(value.zalo, HEALTH_ZALO_KEYS) ||
      !isRecord(value.autoReply) || !hasExactKeys(value.autoReply, HEALTH_AUTO_REPLY_KEYS) ||
      !isRecord(value.worker) || !hasExactKeys(value.worker, HEALTH_WORKER_KEYS) ||
      !isRecord(value.backup) || !hasExactKeys(value.backup, HEALTH_BACKUP_KEYS) ||
      !isRecord(value.processLock) || !hasExactKeys(value.processLock, HEALTH_PROCESS_LOCK_KEYS) ||
      !isRecord(value.config) || !hasExactKeys(value.config, HEALTH_CONFIG_KEYS) ||
      !isRecord(value.messages) || !hasExactKeys(value.messages, HEALTH_MESSAGES_KEYS) ||
      !isRecord(value.errors) || !hasExactKeys(value.errors, HEALTH_ERRORS_KEYS) ||
      !isRecord(value.heartbeats) || !hasExactKeys(value.heartbeats, SYSTEM_HEARTBEAT_NAMES) ||
      !isRecord(value.allowedThreadsReview) || !hasExactKeys(value.allowedThreadsReview, HEALTH_THREAD_REVIEW_KEYS) ||
      !isRecord(value.errorsSummary) || !hasExactKeys(value.errorsSummary, HEALTH_ERRORS_SUMMARY_KEYS)) {
    return false;
  }

  const configPass = value.config.pass;
  const configWarn = value.config.warn;
  const configError = value.config.error;
  const heartbeatEntries = Object.entries(value.heartbeats);
  const heartbeatMapValid = heartbeatEntries.every(([name, entry]) =>
    isSystemHeartbeatName(name) && isHeartbeatItem(entry) && entry.name === name
  );
  const criticalTablesValid = Object.entries(value.db.criticalTables).every(
    ([name, count]) => name.trim().length > 0 && isNullableNonNegativeInteger(count),
  );
  const expectedErrorsStatus: HealthDetailResponse["errorsSummary"]["status"] =
    isNonNegativeInteger(value.errorsSummary.errors24h) && value.errorsSummary.errors24h > 0
      ? "error"
      : isNonNegativeInteger(value.errorsSummary.warnings24h) && value.errorsSummary.warnings24h > 0
        ? "warn"
        : "ok";
  const candidate = value as unknown as HealthDetailResponse;

  return (value.status === "healthy" || value.status === "degraded" || value.status === "unhealthy") &&
    isValidTimestamp(value.timestamp) &&
    isNonNegativeInteger(value.uptimeSeconds) &&
    isNonEmptyString(value.version) &&
    isNonNegativeInteger(value.backend.pid) &&
    isNonEmptyString(value.backend.nodeEnv) &&
    isNonNegativeInteger(value.backend.port) && value.backend.port <= 65_535 &&
    typeof value.db.ok === "boolean" &&
    isNullableNonEmptyString(value.db.path) &&
    isNonNegativeInteger(value.db.sizeBytes) &&
    criticalTablesValid &&
    typeof value.zalo.connected === "boolean" &&
    typeof value.zalo.listenerStarted === "boolean" &&
    isNullableNonEmptyString(value.zalo.uid) &&
    isNullableTimestamp(value.zalo.lastConnectedAt) &&
    isNullableString(value.zalo.lastError) &&
    typeof value.autoReply.enabled === "boolean" &&
    typeof value.autoReply.dryRun === "boolean" &&
    isNonNegativeInteger(value.autoReply.allowedThreadsCount) &&
    isNonNegativeInteger(value.autoReply.cooldownSeconds) &&
    isNonNegativeInteger(value.autoReply.activeCooldowns) &&
    typeof value.worker.active === "boolean" &&
    isNonNegativeInteger(value.worker.queuedJobs) &&
    isNonNegativeInteger(value.worker.failedJobs24h) &&
    isNullableTimestamp(value.backup.latestBackupAt) &&
    isNullableNonEmptyString(value.backup.latestBackupName) &&
    isNonNegativeInteger(value.backup.backupCount) &&
    (value.backup.latestBackupAgeHours === null || isNonNegativeFiniteNumber(value.backup.latestBackupAgeHours)) &&
    typeof value.processLock.locked === "boolean" &&
    isNullableNonNegativeInteger(value.processLock.ownerPid) &&
    typeof value.processLock.isOwner === "boolean" &&
    isNullableTimestamp(value.processLock.startedAt) &&
    isNonNegativeInteger(configPass) &&
    isNonNegativeInteger(configWarn) &&
    isNonNegativeInteger(configError) &&
    isConfigSummaryStatus(value.config.status, configPass, configWarn, configError) &&
    isNonNegativeInteger(value.messages.inbound24h) &&
    isNonNegativeInteger(value.messages.outbound24h) &&
    isNullableTimestamp(value.messages.lastInboundAt) &&
    isNullableTimestamp(value.messages.lastOutboundAt) &&
    isNonNegativeInteger(value.errors.failedAgentTasks24h) &&
    isNonNegativeInteger(value.errors.failedExecutions24h) &&
    heartbeatMapValid &&
    isNonNegativeInteger(value.allowedThreadsReview.count) &&
    isNonNegativeInteger(value.allowedThreadsReview.highRiskCount) &&
    isNonNegativeInteger(value.allowedThreadsReview.groupCount) &&
    isNonNegativeInteger(value.allowedThreadsReview.unknownCount) &&
    isNonNegativeInteger(value.errorsSummary.errors24h) &&
    isNonNegativeInteger(value.errorsSummary.warnings24h) &&
    value.errorsSummary.status === expectedErrorsStatus &&
    isNullableNonEmptyString(value.errorsSummary.topErrorCode) &&
    isNullableTimestamp(value.errorsSummary.lastErrorAt) &&
    value.status === expectedHealthStatus(candidate);
}

export async function getHealthDetail(signal?: AbortSignal) {
  const result = await apiFetch<unknown>("/api/system/health/detail", { signal });
  if (!isHealthDetailResponse(result)) invalidResponse("/api/system/health/detail", result);
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// Config Check
// ═══════════════════════════════════════════════════════════════════

export interface ConfigCheckResponse {
  status: "CONFIG_OK" | "CONFIG_WARN" | "CONFIG_ERROR";
  checks: Array<{ name: string; severity: "PASS" | "WARN" | "ERROR"; message: string; safe: boolean }>;
  summary: { pass: number; warn: number; error: number };
}

const CONFIG_CHECK_ROOT_KEYS = ["status", "checks", "summary"] as const;
const CONFIG_CHECK_ITEM_KEYS = ["name", "severity", "message", "safe"] as const;
const CONFIG_CHECK_SUMMARY_KEYS = ["pass", "warn", "error"] as const;

function isConfigCheckResponse(value: unknown): value is ConfigCheckResponse {
  if (!isRecord(value) || !hasExactKeys(value, CONFIG_CHECK_ROOT_KEYS) ||
      !Array.isArray(value.checks) ||
      !isRecord(value.summary) || !hasExactKeys(value.summary, CONFIG_CHECK_SUMMARY_KEYS) ||
      !isNonNegativeInteger(value.summary.pass) ||
      !isNonNegativeInteger(value.summary.warn) ||
      !isNonNegativeInteger(value.summary.error)) {
    return false;
  }

  const checksValid = value.checks.every((check) =>
    isRecord(check) && hasExactKeys(check, CONFIG_CHECK_ITEM_KEYS) &&
    isNonEmptyString(check.name) && isNonEmptyString(check.message) &&
    (check.severity === "PASS" || check.severity === "WARN" || check.severity === "ERROR") &&
    typeof check.safe === "boolean" && check.safe === (check.severity !== "ERROR")
  );
  if (!checksValid) return false;

  const checks = value.checks as ConfigCheckResponse["checks"];
  const pass = checks.filter((check) => check.severity === "PASS").length;
  const warn = checks.filter((check) => check.severity === "WARN").length;
  const error = checks.filter((check) => check.severity === "ERROR").length;
  return value.summary.pass === pass &&
    value.summary.warn === warn &&
    value.summary.error === error &&
    isConfigSummaryStatus(value.status, pass, warn, error);
}

export async function getConfigCheck(signal?: AbortSignal) {
  const result = await apiFetch<unknown>("/api/system/config-check", { signal });
  if (!isConfigCheckResponse(result)) invalidResponse("/api/system/config-check", result);
  return result;
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

export interface DocumentJobOutput {
  id: string;
  status: string;
  errorCode?: string | null;
}

export function getDocumentJobs(id: string) {
  return apiFetch<{ data: DocumentJobOutput[]; total: number }>(`/api/documents/${id}/jobs`);
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
  connectionStatus: ZaloConnectionStatus;
  /** ZR2: single source of truth for "what should the operator do next".
   *  "connected" | "session_present" | "backup_available" | "restore_failed"
   *  | "qr_required" | "waiting_qr_scan" | "reconnect_in_progress"
   *  | "login_safety_blocked" | "expired" */
  connectionDetail:
    | "connected"
    | "session_present"
    | "backup_available"
    | "restore_failed"
    | "qr_required"
    | "waiting_qr_scan"
    | "reconnect_in_progress"
    | "login_safety_blocked"
    | "expired";
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
    warning: "NO_SESSION_FILE" | "SESSION_QUARANTINED" | "CONNECTED_BUT_SESSION_NOT_PERSISTED" | null;
    /** ZR2: true when primary session is missing but a restorable backup exists. */
    backupAvailable: boolean;
  };
  heartbeats: {
    zaloConnection: { status: string; lastBeatAt: string | null; ageSeconds: number | null };
    zaloListener: { status: string; lastBeatAt: string | null; ageSeconds: number | null };
    messagePipeline: { status: string; lastBeatAt: string | null; ageSeconds: number | null };
  };
  recovery: {
    recoveryState: "idle" | "scheduled" | "reconnecting" | "error";
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    lastReconnectAt: string | null;
    lastReconnectError: string | null;
    listenerHeartbeatAgeSeconds: number | null;
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

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isHeartbeatStatus(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ZALO_HEARTBEAT_KEYS)) return false;
  return (value.status === "ok" || value.status === "stale" || value.status === "down") &&
    isNullableTimestamp(value.lastBeatAt) &&
    isNullableNonNegativeInteger(value.ageSeconds);
}

function isZaloOpsTerminalStateCoherent(
  value: Record<string, unknown>,
  session: Record<string, unknown>,
): boolean {
  const blockedByStatus = value.connectionStatus === "blocked";
  const blockedByDetail = value.connectionDetail === "login_safety_blocked";
  if (blockedByStatus !== blockedByDetail) return false;
  if (blockedByStatus) {
    const hasStableReason =
      value.lastError === "LOGIN_SAFETY_BLOCKED:STATIC_DRY_RUN_ENABLED" ||
      value.lastError === "LOGIN_SAFETY_BLOCKED:OUTBOUND_DRY_RUN_REQUIRED";
    if (value.connected !== false || session.qrAvailable !== false || session.qrUpdatedAt !== null || !hasStableReason) {
      return false;
    }
  }

  const expiredByStatus = value.connectionStatus === "expired";
  const expiredByDetail = value.connectionDetail === "expired";
  if (expiredByStatus !== expiredByDetail) return false;
  if (expiredByStatus && (value.connected !== false || session.qrAvailable !== false || session.qrUpdatedAt !== null)) {
    return false;
  }

  return true;
}

export type ZaloConnectionStatus =
  | "disconnected"
  | "connecting"
  | "waiting_qr_scan"
  | "connected"
  | "expired"
  | "blocked"
  | "error";

const ZALO_CONNECTION_STATUSES = [
  "disconnected",
  "connecting",
  "waiting_qr_scan",
  "connected",
  "expired",
  "blocked",
  "error",
] as const satisfies readonly ZaloConnectionStatus[];
const ZALO_LOGIN_STATUS_KEYS = [
  "connected",
  "connectionStatus",
  "dryRun",
  "selfUserId",
  "selfDisplayName",
  "listenerActive",
  "qrAvailable",
  "qrUpdatedAt",
  "lastConnectedAt",
  "lastError",
] as const;
const ZALO_LOGIN_START_STATUSES = ["connecting", "connected", "already_connected"] as const;
const ZALO_LOGIN_START_KEYS = ["data"] as const;
const ZALO_LOGIN_START_DATA_KEYS = ["status", "qrImage", "reason"] as const;
const ZALO_LOGIN_QR_KEYS = ["qrDataURL", "updatedAt"] as const;
const ZALO_LOGIN_CANCEL_KEYS = ["data"] as const;
const ZALO_LOGIN_CANCEL_DATA_KEYS = ["cancelled", "message"] as const;
const ZALO_CONNECTION_DETAILS = [
  "connected",
  "session_present",
  "backup_available",
  "restore_failed",
  "qr_required",
  "waiting_qr_scan",
  "reconnect_in_progress",
  "login_safety_blocked",
  "expired",
] as const;
const ZALO_SESSION_WARNINGS = [
  "NO_SESSION_FILE",
  "SESSION_QUARANTINED",
  "CONNECTED_BUT_SESSION_NOT_PERSISTED",
] as const;

const ZALO_OPS_STATUS_KEYS = [
  "connected",
  "connectionStatus",
  "connectionDetail",
  "selfUserId",
  "selfDisplayName",
  "lastConnectedAt",
  "lastError",
  "lastMessageAt",
  "listenerActive",
  "dryRun",
  "dryRunSource",
  "allowedThreads",
  "cooldownSeconds",
  "session",
  "heartbeats",
  "recovery",
  "inbound24h",
  "outbound24h",
  "failedTasks24h",
] as const;
const ZALO_SESSION_KEYS = [
  "exists",
  "age",
  "ageSeconds",
  "path",
  "qrAvailable",
  "qrUpdatedAt",
  "fileSize",
  "updatedAt",
  "quarantinedFiles",
  "warning",
  "backupAvailable",
] as const;
const ZALO_HEARTBEATS_KEYS = ["zaloConnection", "zaloListener", "messagePipeline"] as const;
const ZALO_HEARTBEAT_KEYS = ["status", "lastBeatAt", "ageSeconds"] as const;
const ZALO_RECOVERY_KEYS = [
  "recoveryState",
  "reconnectAttempts",
  "maxReconnectAttempts",
  "lastReconnectAt",
  "lastReconnectError",
  "listenerHeartbeatAgeSeconds",
] as const;

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isValidTimestamp(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

function isZaloOpsStatus(value: unknown): value is ZaloOpsStatus {
  if (!isRecord(value) || !hasExactKeys(value, ZALO_OPS_STATUS_KEYS) ||
      !isRecord(value.session) || !hasExactKeys(value.session, ZALO_SESSION_KEYS) ||
      !isRecord(value.heartbeats) || !hasExactKeys(value.heartbeats, ZALO_HEARTBEATS_KEYS) ||
      !isRecord(value.recovery) || !hasExactKeys(value.recovery, ZALO_RECOVERY_KEYS)) {
    return false;
  }
  const session = value.session;
  const heartbeats = value.heartbeats;
  const recovery = value.recovery;
  return isZaloOpsTerminalStateCoherent(value, session) &&
    typeof value.connected === "boolean" &&
    ZALO_CONNECTION_STATUSES.includes(value.connectionStatus as typeof ZALO_CONNECTION_STATUSES[number]) &&
    ZALO_CONNECTION_DETAILS.includes(value.connectionDetail as typeof ZALO_CONNECTION_DETAILS[number]) &&
    isNullableString(value.selfUserId) &&
    isNullableString(value.selfDisplayName) &&
    isNullableTimestamp(value.lastConnectedAt) &&
    isNullableString(value.lastError) &&
    isNullableTimestamp(value.lastMessageAt) &&
    typeof value.listenerActive === "boolean" &&
    typeof value.dryRun === "boolean" &&
    (value.dryRunSource === "env" || value.dryRunSource === "runtime") &&
    Array.isArray(value.allowedThreads) && value.allowedThreads.every(isNonEmptyString) &&
    isNonNegativeFiniteNumber(value.cooldownSeconds) &&
    typeof session.exists === "boolean" &&
    isNullableString(session.age) &&
    isNullableNonNegativeInteger(session.ageSeconds) &&
    isNullableString(session.path) &&
    typeof session.qrAvailable === "boolean" &&
    isNullableTimestamp(session.qrUpdatedAt) &&
    isNullableNonNegativeInteger(session.fileSize) &&
    isNullableTimestamp(session.updatedAt) &&
    Array.isArray(session.quarantinedFiles) && session.quarantinedFiles.every(isNonEmptyString) &&
    (session.warning === null || ZALO_SESSION_WARNINGS.includes(session.warning as typeof ZALO_SESSION_WARNINGS[number])) &&
    typeof session.backupAvailable === "boolean" &&
    isHeartbeatStatus(heartbeats.zaloConnection) &&
    isHeartbeatStatus(heartbeats.zaloListener) &&
    isHeartbeatStatus(heartbeats.messagePipeline) &&
    ["idle", "scheduled", "reconnecting", "error"].includes(String(recovery.recoveryState)) &&
    Number.isInteger(recovery.reconnectAttempts) && (recovery.reconnectAttempts as number) >= 0 &&
    Number.isInteger(recovery.maxReconnectAttempts) && (recovery.maxReconnectAttempts as number) >= 0 &&
    isNullableTimestamp(recovery.lastReconnectAt) &&
    isNullableString(recovery.lastReconnectError) &&
    isNullableNonNegativeInteger(recovery.listenerHeartbeatAgeSeconds) &&
    isNonNegativeInteger(value.inbound24h) &&
    isNonNegativeInteger(value.outbound24h) &&
    isNonNegativeInteger(value.failedTasks24h);
}

export async function getZaloOpsStatus(signal?: AbortSignal) {
  const result = await apiFetch<unknown>("/api/zalo/ops/status", { signal });
  if (!isZaloOpsStatus(result)) invalidResponse("/api/zalo/ops/status", result);
  return result;
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

function isRecentEvent(value: unknown): value is RecentEvent {
  return isRecord(value) &&
    ["inbound", "outbound", "reaction", "document", "error"].includes(String(value.type)) &&
    typeof value.timestamp === "string" &&
    (value.threadId === undefined || typeof value.threadId === "string") &&
    (value.senderId === undefined || typeof value.senderId === "string") &&
    (value.senderName === undefined || typeof value.senderName === "string") &&
    (value.content === undefined || typeof value.content === "string") &&
    (value.detail === undefined || typeof value.detail === "string") &&
    (value.errorCode === undefined || typeof value.errorCode === "string");
}

function isRecentEventsResponse(value: unknown): value is RecentEventsResponse {
  return isRecord(value) &&
    Array.isArray(value.inbound) && value.inbound.every(isRecentEvent) &&
    Array.isArray(value.outbound) && value.outbound.every(isRecentEvent) &&
    Array.isArray(value.errors) && value.errors.every(isRecentEvent);
}

export async function getRecentEvents(signal?: AbortSignal) {
  const result = await apiFetch<unknown>("/api/zalo/ops/recent-events", { signal });
  if (!isRecentEventsResponse(result)) invalidResponse("/api/zalo/ops/recent-events", result);
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// Batch 17 — Production Readiness Gate
// ═══════════════════════════════════════════════════════════════════

export interface ReadinessCheck {
  id: string;
  label: string;
  category: string;
  status: "pass" | "warn" | "fail" | "unknown";
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  action?: string;
}

export interface ReadinessResult {
  verdict: "READY_FOR_LIVE" | "WARNING_ONLY" | "NOT_READY";
  score: number | null;
  dataQuality: "complete" | "incomplete";
  timestamp: string;
  checks: ReadinessCheck[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
    unknown: number;
    criticalFail: number;
    highFail: number;
  };
}

const READINESS_ROOT_KEYS = ["verdict", "score", "dataQuality", "timestamp", "checks", "summary"] as const;
const READINESS_CHECK_KEYS = ["id", "label", "category", "status", "severity", "message", "action"] as const;
const READINESS_SUMMARY_KEYS = ["pass", "warn", "fail", "unknown", "criticalFail", "highFail"] as const;
const REQUIRED_READINESS_CHECK_IDS = [
  "zalo.connected", "zalo.listener", "zalo.messagePipeline",
  "safety.dryRun", "safety.allowedThreads", "safety.groupRisk",
  "config.status", "config.strictErrors",
  "health.backend", "health.worker", "health.processLock", "health.db",
  "backup.recent", "backup.dbSize", "backup.session",
  "security.adminPassword", "rules.status", "docs.status",
  "errors.agentTasks", "errors.executions", "errors.heartbeats",
] as const;

function isReadinessCheck(value: unknown): value is ReadinessCheck {
  return isRecord(value) &&
    hasOnlyKeys(value, READINESS_CHECK_KEYS) &&
    isNonEmptyString(value.id) &&
    typeof value.label === "string" &&
    typeof value.category === "string" &&
    ["pass", "warn", "fail", "unknown"].includes(String(value.status)) &&
    ["critical", "high", "medium", "low"].includes(String(value.severity)) &&
    typeof value.message === "string" &&
    (value.action === undefined || typeof value.action === "string");
}

function isReadinessResult(value: unknown): value is ReadinessResult {
  if (!isRecord(value) || !hasExactKeys(value, READINESS_ROOT_KEYS) ||
      !isRecord(value.summary) || !hasExactKeys(value.summary, READINESS_SUMMARY_KEYS) ||
      !Array.isArray(value.checks) || !value.checks.every(isReadinessCheck) ||
      (value.dataQuality !== "complete" && value.dataQuality !== "incomplete") ||
      !isValidTimestamp(value.timestamp)) {
    return false;
  }

  const checks = value.checks as ReadinessCheck[];
  const ids = checks.map((check) => check.id);
  const uniqueIds = new Set(ids);
  if (ids.length !== REQUIRED_READINESS_CHECK_IDS.length ||
      uniqueIds.size !== ids.length ||
      REQUIRED_READINESS_CHECK_IDS.some((id) => !uniqueIds.has(id))) {
    return false;
  }

  const derivedSummary = {
    pass: checks.filter((check) => check.status === "pass").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
    unknown: checks.filter((check) => check.status === "unknown").length,
    criticalFail: checks.filter((check) =>
      (check.status === "fail" || check.status === "unknown") && check.severity === "critical"
    ).length,
    highFail: checks.filter((check) =>
      (check.status === "fail" || check.status === "unknown") && check.severity === "high"
    ).length,
  };
  const summary = value.summary;
  const summaryValid = READINESS_SUMMARY_KEYS.every((key) =>
    isNonNegativeInteger(summary[key]) && summary[key] === derivedSummary[key]
  );
  const expectedDataQuality: ReadinessResult["dataQuality"] =
    derivedSummary.unknown === 0 ? "complete" : "incomplete";
  const scoreValid = expectedDataQuality === "complete"
    ? typeof value.score === "number" && Number.isFinite(value.score) && value.score >= 0 && value.score <= 100
    : value.score === null;
  const expectedVerdict: ReadinessResult["verdict"] =
    expectedDataQuality === "incomplete" || derivedSummary.fail > 0
      ? "NOT_READY"
      : derivedSummary.warn > 0 ? "WARNING_ONLY" : "READY_FOR_LIVE";

  return summaryValid &&
    value.dataQuality === expectedDataQuality &&
    scoreValid &&
    value.verdict === expectedVerdict;
}

export async function getProductionReadiness() {
  const result = await apiFetch<unknown>("/api/system/production-readiness");
  if (!isReadinessResult(result)) invalidResponse("/api/system/production-readiness", result);
  return result;
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

function isLiveTestStatusResult(value: unknown): value is LiveTestStatusResult {
  if (!isRecord(value) || typeof value.active !== "boolean" || typeof value.dryRun !== "boolean") return false;
  if (value.session === null) return value.active === false;
  if (!isRecord(value.session) || value.active !== true) return false;
  const session = value.session;
  return typeof session.id === "string" && session.id.length > 0 &&
    typeof session.threadId === "string" && session.threadId.length > 0 &&
    Number.isInteger(session.maxMessages) && (session.maxMessages as number) >= 1 &&
    Number.isInteger(session.sentCount) && (session.sentCount as number) >= 0 &&
    Number.isInteger(session.ttlSeconds) && (session.ttlSeconds as number) >= 1 &&
    typeof session.expiresAt === "string" &&
    typeof session.status === "string" &&
    isNullableString(session.reason) &&
    isNullableString(session.createdBy) &&
    typeof session.createdAt === "string" &&
    typeof session.remainingMs === "number" && Number.isFinite(session.remainingMs) && session.remainingMs >= 0;
}

export async function getLiveTestStatus(signal?: AbortSignal) {
  const result = await apiFetch<unknown>("/api/system/live-test/status", { signal });
  if (!isLiveTestStatusResult(result)) invalidResponse("/api/system/live-test/status", result);
  return result;
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

// ═══════════════════════════════════════════════════════════════════
// ZALO-WEB-LOGIN — QR Login Flow API
// ═══════════════════════════════════════════════════════════════════

export interface LoginStatusOutput {
  connected: boolean;
  connectionStatus: ZaloConnectionStatus;
  dryRun: boolean;
  selfUserId: string | null;
  selfDisplayName: string | null;
  listenerActive: boolean;
  qrAvailable: boolean;
  qrUpdatedAt: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
}

function isZaloLoginStatus(value: unknown): value is LoginStatusOutput {
  if (!isRecord(value) || !hasExactKeys(value, ZALO_LOGIN_STATUS_KEYS)) return false;
  return typeof value.connected === "boolean" &&
    ZALO_CONNECTION_STATUSES.includes(value.connectionStatus as typeof ZALO_CONNECTION_STATUSES[number]) &&
    typeof value.dryRun === "boolean" &&
    isNullableString(value.selfUserId) &&
    isNullableString(value.selfDisplayName) &&
    typeof value.listenerActive === "boolean" &&
    typeof value.qrAvailable === "boolean" &&
    isNullableTimestamp(value.qrUpdatedAt) &&
    isNullableTimestamp(value.lastConnectedAt) &&
    isNullableString(value.lastError);
}

export interface LoginStartResult {
  status: typeof ZALO_LOGIN_START_STATUSES[number];
  qrImage?: string;
  reason?: string;
}

export interface LoginCancelResult {
  cancelled: boolean;
  message: string;
}

export interface QRImageResult {
  qrDataURL: string;
  updatedAt: string | null;
}

function isZaloLoginStartResponse(value: unknown): value is { data: LoginStartResult } {
  if (!isRecord(value) || !hasExactKeys(value, ZALO_LOGIN_START_KEYS) ||
      !isRecord(value.data) || !hasOnlyKeys(value.data, ZALO_LOGIN_START_DATA_KEYS)) {
    return false;
  }
  const data = value.data;
  return ZALO_LOGIN_START_STATUSES.includes(data.status as typeof ZALO_LOGIN_START_STATUSES[number]) &&
    (!Object.prototype.hasOwnProperty.call(data, "qrImage") || isNonEmptyString(data.qrImage)) &&
    (!Object.prototype.hasOwnProperty.call(data, "reason") || isNonEmptyString(data.reason));
}

function isNonEmptyPngDataUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const prefix = "data:image/png;base64,";
  if (!value.startsWith(prefix)) return false;
  const payload = value.slice(prefix.length);
  return payload.length > 0 && payload.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(payload);
}

function isZaloLoginQrResult(value: unknown): value is QRImageResult {
  if (!isRecord(value) || !hasExactKeys(value, ZALO_LOGIN_QR_KEYS)) return false;
  return isNonEmptyPngDataUrl(value.qrDataURL) && isNullableTimestamp(value.updatedAt);
}

function isZaloLoginCancelResponse(value: unknown): value is { data: LoginCancelResult } {
  if (!isRecord(value) || !hasExactKeys(value, ZALO_LOGIN_CANCEL_KEYS) ||
      !isRecord(value.data) || !hasExactKeys(value.data, ZALO_LOGIN_CANCEL_DATA_KEYS)) {
    return false;
  }
  return typeof value.data.cancelled === "boolean" && isNonEmptyString(value.data.message);
}

export async function startZaloLogin(signal?: AbortSignal) {
  const result = await apiFetch<unknown>("/api/zalo/login/start", {
    method: "POST",
    body: JSON.stringify({}),
    signal,
  });
  if (!isZaloLoginStartResponse(result)) invalidResponse("/api/zalo/login/start", result);
  return result;
}

export async function getZaloLoginStatus(signal?: AbortSignal) {
  const result = await apiFetch<unknown>("/api/zalo/login/status", { signal });
  if (!isZaloLoginStatus(result)) invalidResponse("/api/zalo/login/status", result);
  return result;
}

export async function getZaloLoginQR(signal?: AbortSignal) {
  const result = await apiFetch<unknown>("/api/zalo/login/qr", { signal });
  if (!isZaloLoginQrResult(result)) invalidResponse("/api/zalo/login/qr", result);
  return result;
}

export async function cancelZaloLogin(signal?: AbortSignal) {
  const result = await apiFetch<unknown>("/api/zalo/login/cancel", { method: "POST", signal });
  if (!isZaloLoginCancelResponse(result)) invalidResponse("/api/zalo/login/cancel", result);
  return result;
}

// =============================================================================
// Decision Trace (Phase 7) — read-only
// =============================================================================

export interface TraceSummary {
  messageId: string;
  threadId: string;
  threadType: string;
  senderName: string | null;
  role: string;
  contentPreviewRedacted: string;
  receivedAt: string;
  ruleMatched: boolean;
  agentTaskCount: number;
  toolCallCount: number;
  zaloActionCount: number;
  outboundDecision: string | null;
  outboundDryRun: boolean | null;
  sentMessageId: string | null;
}

export interface TraceListResponse {
  data: TraceSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TraceDetail {
  message: {
    id: string;
    threadId: string;
    threadType: string;
    senderId: string | null;
    senderName: string | null;
    role: string;
    messageType: string | null;
    contentRedacted: string;
    receivedAt: string;
  };
  identity: { principalId: string; role: string; status: string; scope: "thread" | "global" } | null;
  gate: {
    autoReplyEnabled: boolean;
    groupMentionRequired: boolean;
    groupReplyWindowSeconds: number;
    allowCreateReminder: boolean;
    allowMedia: boolean;
    allowImageUnderstanding: boolean;
    allowDocumentUnderstanding: boolean;
  } | null;
  rules: Array<{
    id: string;
    ruleId: string | null;
    ruleName: string | null;
    matched: boolean;
    actionTaken: string | null;
    resultRedacted: unknown;
    errorCode: string | null;
    createdAt: string;
  }>;
  agentTasks: Array<{
    id: string;
    agentName: string;
    taskType: string;
    status: string;
    errorMessage: string | null;
    createdAt: string;
  }>;
  toolCalls: Array<{
    id: string;
    agentName: string;
    toolName: string;
    kind: string;
    executionStatus: string;
    deliveryStatus: string;
    argsRedacted: unknown;
    resultRedacted: unknown;
    errorCode: string | null;
    evidence: unknown;
    durationMs: number | null;
    createdAt: string;
  }>;
  zaloActions: Array<{
    id: string;
    actionType: string;
    trigger: string;
    decision: string;
    reason: string;
    dryRun: boolean;
    executionStatus: string;
    deliveryStatus: string;
    targetMsgId: string | null;
    payloadRedacted: unknown;
    providerResultId: string | null;
    errorCode: string | null;
    createdAt: string;
  }>;
  link?: {
    linkMode: "exact" | "best_effort" | "none";
    inboundMessageId: string;
    replyMessageId: string | null;
    agentTaskId: string | null;
    outboundRecordId: string | null;
    missingLinks: string[];
  };
  outbound: {
    linkConfidence: "exact" | "best_effort" | "none";
    reply: { id: string; contentRedacted: string; zaloMessageId: string | null; receivedAt: string } | null;
    record: {
      outboundRecordId?: string;
      decision: string;
      reason: string;
      dryRun: boolean;
      source: string;
      sentMessageId: string | null;
      errorCode: string | null;
      createdAt: string;
    } | null;
  };
}

export function listTraces(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return apiFetch<TraceListResponse>(`/api/trace${qs ? `?${qs}` : ""}`);
}

export function getTrace(messageId: string) {
  return apiFetch<{ data: TraceDetail }>(`/api/trace/${encodeURIComponent(messageId)}`);
}

// =============================================================================
// AllowThreads — discover friends/groups + manage allowlist
// =============================================================================

export interface DiscoverThreadItem {
  threadId: string;
  threadType: "user" | "group";
  displayName: string;
  avatarUrl?: string;
  subtitle?: string;
  memberCount?: number;
  allowed: boolean;
  source: "zalo";
}

export interface DiscoverThreadsResponse {
  items: DiscoverThreadItem[];
  nextCursor: string | null;
  warning?: { code: string; message: string };
}

export interface AllowedThreadEntry {
  threadId: string;
  threadType: "user" | "group";
}

export interface AllowChange {
  threadId: string;
  threadType: "user" | "group";
  allowed: boolean;
}

export function discoverThreads(params: { type?: "user" | "group" | "all"; query?: string; limit?: number; cursor?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.type) qs.set("type", params.type);
  if (params.query) qs.set("query", params.query);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  const s = qs.toString();
  return apiFetch<DiscoverThreadsResponse>(`/api/access/threads/discover${s ? `?${s}` : ""}`);
}

export function listAllowedThreads() {
  return apiFetch<{ data: AllowedThreadEntry[]; total: number }>("/api/access/threads/allowed");
}

export function updateThreadAllow(changes: AllowChange[], reason?: string) {
  return apiFetch<{ data: AllowedThreadEntry[]; total: number }>("/api/access/threads/allow", {
    method: "PATCH",
    body: JSON.stringify({ changes, reason }),
  });
}

// =============================================================================
// Phase 3.5D — Retrieval Answer (admin/test, read-only)
// =============================================================================

export interface RetrievalAnswerEvidence {
  messageId: string;
  attachmentId?: string;
  createdAt: string;
  threadId: string;
  threadType: string;
  source: "message" | "attachment";
  kind?: string;
  extractionStatus?: string;
  snippetRedacted?: string;
  confidence?: number | string;
}

export interface RetrievalAnswerResult {
  status: "found" | "not_found" | "permission_denied" | "unavailable";
  answerText: string;
  evidence: RetrievalAnswerEvidence[];
  confidence: "high" | "medium" | "low";
}

export interface RetrievalAnswerInput {
  query: string;
  requesterThreadId: string;
  requesterThreadType: "user" | "group";
  targetThreadId?: string;
  targetThreadType?: "user" | "group";
  dateFrom?: string;
  dateTo?: string;
  includeAttachments?: boolean;
  role?: "form_only" | "basic_chat" | "advanced" | "admin";
}

/** Read-only: calls the admin retrieval-answer route. Never sends Zalo / no live. */
export function retrievalAnswer(input: RetrievalAnswerInput) {
  return apiFetch<RetrievalAnswerResult>("/api/agent/tools/retrieval-answer", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
