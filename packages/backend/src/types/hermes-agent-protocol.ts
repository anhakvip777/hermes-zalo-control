// =============================================================================
// Hermes Agent Protocol — ARCH1-C foundation
// =============================================================================

export type HermesAgentPlatform = "zalo";
export type HermesAgentThreadType = "user" | "group";
export type HermesAgentMessageType = "text" | "image" | "audio" | "video" | "file" | "sticker" | "unknown";
export type HermesAgentMediaType = "text" | "image" | "audio" | "video" | "file";
export type HermesAgentActionStatus = "pending" | "success" | "failed" | "blocked" | "dry_run";
export type HermesAgentToolStatus = "requested" | "success" | "failed" | "unavailable" | "blocked";

export interface HermesAgentPermissions {
  canReply: boolean;
  canUseTools: boolean;
  canUseWeb: boolean;
  canCreateSchedule: boolean;
  canSendMedia: boolean;
  canUseTTS: boolean;
  canUseTTI: boolean;
  allowedTools?: string[];
}

export interface HermesAgentCapabilities {
  webSearch: boolean;
  memory: boolean;
  schedule: boolean;
  imageInput: boolean;
  imageOutput: boolean;
  audioOutput: boolean;
  fileRead: boolean;
  tts?: boolean;
  tti?: boolean;
  embedding?: boolean;
}

export interface HermesAgentAttachment {
  id?: string;
  type: Exclude<HermesAgentMessageType, "text" | "unknown"> | "file";
  mimeType?: string;
  filename?: string;
  url?: string;
  localPath?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  sha256?: string;
  metadata?: Record<string, unknown>;
}

export interface HermesAgentMention {
  id: string;
  name?: string;
  offset?: number;
  length?: number;
}

export interface HermesAgentMessage {
  id?: string;
  role?: "user" | "assistant" | "system";
  content: string;
  messageType: HermesAgentMessageType;
  mentions?: HermesAgentMention[];
  attachments?: HermesAgentAttachment[];
  timestamp?: string;
  senderId?: string;
  senderName?: string;
}

export interface HermesAgentRuntimePolicy {
  botPronoun?: string;
  userPronoun?: string;
  tone?: string;
  language?: string;
  rules: string[];
  forbiddenBehaviors: string[];
  threadSettings?: Record<string, unknown>;
  allowedTools?: string[];
}

export interface HermesAgentSender {
  id: string;
  name?: string;
  role?: string;
  gender?: "male" | "female" | "unknown" | string;
  permissions?: string[];
}

export interface HermesAgentRuntime {
  dryRun: boolean;
  live: boolean;
  timezone: string;
  timestamp: string;
}

export interface HermesAgentRequest {
  protocolVersion: string;
  platform: HermesAgentPlatform;
  threadId: string;
  threadType: HermesAgentThreadType;
  sender: HermesAgentSender;
  message: HermesAgentMessage;
  recentMessages: HermesAgentMessage[];
  runtime: HermesAgentRuntime;
  runtimePolicy: HermesAgentRuntimePolicy;
  permissions: HermesAgentPermissions;
  capabilities: HermesAgentCapabilities;
  metadata?: Record<string, unknown>;
}

export interface HermesAgentToolCall {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
  status?: HermesAgentToolStatus;
  startedAt?: string;
  completedAt?: string;
}

export interface HermesAgentToolResult {
  toolCallId: string;
  name: string;
  status: HermesAgentToolStatus;
  result?: unknown;
  summary?: string;
  error?: string;
  evidence?: Record<string, unknown>;
}

export interface HermesAgentAction {
  id: string;
  type: string;
  status: HermesAgentActionStatus;
  result?: unknown;
  summary?: string;
  error?: string;
  evidence?: Record<string, unknown>;
}

export interface HermesAgentResponseMedia {
  type: HermesAgentMediaType;
  content?: string;
  url?: string;
  localPath?: string;
  mimeType?: string;
  filename?: string;
  evidence?: Record<string, unknown>;
}

export interface HermesAgentSafety {
  blocked: boolean;
  reason?: string;
  categories?: string[];
  promptLeakDetected?: boolean;
  actionEvidenceRequired?: boolean;
  dryRunBlockedActions?: string[];
  metadata?: Record<string, unknown>;
}

export interface HermesAgentError {
  code: string;
  message: string;
  detail?: unknown;
}

export interface HermesAgentResponse {
  text?: string;
  confidence?: number;
  messages?: HermesAgentResponseMedia[];
  toolCalls: HermesAgentToolCall[];
  toolResults: HermesAgentToolResult[];
  actions: HermesAgentAction[];
  media: HermesAgentResponseMedia[];
  safety: HermesAgentSafety;
  errors: HermesAgentError[];
  usage?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export const HERMES_AGENT_PROTOCOL_UNAVAILABLE = "HERMES_AGENT_PROTOCOL_UNAVAILABLE";
