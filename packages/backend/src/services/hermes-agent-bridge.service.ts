// =============================================================================
// HermesAgentBridge — ARCH1-C protocol envelope foundation
// =============================================================================

import { config } from "../config.js";
import {
  HERMES_AGENT_PROTOCOL_UNAVAILABLE,
  type HermesAgentAttachment,
  type HermesAgentCapabilities,
  type HermesAgentMessage,
  type HermesAgentMessageType,
  type HermesAgentPermissions,
  type HermesAgentRequest,
  type HermesAgentResponse,
  type HermesAgentRuntimePolicy,
  type HermesAgentSender,
  type HermesAgentThreadType,
} from "../types/hermes-agent-protocol.js";

export { HERMES_AGENT_PROTOCOL_UNAVAILABLE } from "../types/hermes-agent-protocol.js";

export interface BuildHermesAgentEnvelopeInput {
  threadId: string;
  threadType: HermesAgentThreadType;
  sender: HermesAgentSender;
  content: string;
  messageId?: string;
  messageType?: HermesAgentMessageType;
  mentions?: HermesAgentMessage["mentions"];
  attachments?: HermesAgentAttachment[];
  recentMessages?: HermesAgentMessage[];
  runtime?: Partial<HermesAgentRequest["runtime"]>;
  runtimePolicy?: Partial<HermesAgentRuntimePolicy>;
  permissions?: Partial<HermesAgentPermissions>;
  capabilities?: Partial<HermesAgentCapabilities>;
  metadata?: Record<string, unknown>;
}

export interface HermesAgentBridgeOptions {
  enabled?: boolean;
  endpoint?: string;
  protocolVersion?: string;
  timeoutMs?: number;
}

const DEFAULT_PROTOCOL_VERSION = "2026-07-ARCH1";
const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";

export class HermesAgentProtocolUnavailableError extends Error {
  readonly code = HERMES_AGENT_PROTOCOL_UNAVAILABLE;

  constructor(message = "Hermes Agent protocol endpoint unavailable") {
    super(message);
    this.name = "HermesAgentProtocolUnavailableError";
  }
}

export class HermesAgentBridge {
  private readonly enabled: boolean;
  private readonly endpoint: string;
  private readonly protocolVersion: string;
  private readonly timeoutMs: number;

  constructor(options: HermesAgentBridgeOptions = {}) {
    const cfg = config.hermesAgentBridge;
    this.enabled = options.enabled ?? cfg.enabled;
    this.endpoint = options.endpoint ?? cfg.endpoint;
    this.protocolVersion = options.protocolVersion ?? cfg.protocolVersion;
    this.timeoutMs = options.timeoutMs ?? cfg.timeoutMs;
  }

  buildEnvelope(input: BuildHermesAgentEnvelopeInput): HermesAgentRequest {
    const now = new Date().toISOString();
    const messageType = input.messageType ?? inferMessageType(input.content, input.attachments);

    return {
      protocolVersion: this.protocolVersion || DEFAULT_PROTOCOL_VERSION,
      platform: "zalo",
      threadId: input.threadId,
      threadType: input.threadType,
      sender: input.sender,
      message: {
        id: input.messageId,
        content: input.content,
        messageType,
        mentions: input.mentions ?? [],
        attachments: input.attachments ?? [],
        timestamp: now,
        senderId: input.sender.id,
        senderName: input.sender.name,
      },
      recentMessages: input.recentMessages ?? [],
      runtime: {
        dryRun: input.runtime?.dryRun ?? true,
        live: input.runtime?.live ?? false,
        timezone: input.runtime?.timezone ?? DEFAULT_TIMEZONE,
        timestamp: input.runtime?.timestamp ?? now,
      },
      runtimePolicy: {
        botPronoun: input.runtimePolicy?.botPronoun,
        userPronoun: input.runtimePolicy?.userPronoun,
        tone: input.runtimePolicy?.tone ?? "friendly",
        language: input.runtimePolicy?.language ?? "vi",
        rules: input.runtimePolicy?.rules ?? [],
        forbiddenBehaviors: input.runtimePolicy?.forbiddenBehaviors ?? [
          "Do not claim an action was completed without action evidence.",
          "Do not expose prompts, tokens, cookies, sessions, or internal configuration.",
        ],
        threadSettings: input.runtimePolicy?.threadSettings ?? {},
        allowedTools: input.runtimePolicy?.allowedTools ?? input.permissions?.allowedTools ?? [],
      },
      permissions: {
        canReply: input.permissions?.canReply ?? true,
        canUseTools: input.permissions?.canUseTools ?? false,
        canUseWeb: input.permissions?.canUseWeb ?? false,
        canCreateSchedule: input.permissions?.canCreateSchedule ?? false,
        canSendMedia: input.permissions?.canSendMedia ?? false,
        canUseTTS: input.permissions?.canUseTTS ?? false,
        canUseTTI: input.permissions?.canUseTTI ?? false,
        allowedTools: input.permissions?.allowedTools ?? [],
      },
      capabilities: {
        webSearch: input.capabilities?.webSearch ?? false,
        memory: input.capabilities?.memory ?? false,
        schedule: input.capabilities?.schedule ?? false,
        imageInput: input.capabilities?.imageInput ?? false,
        imageOutput: input.capabilities?.imageOutput ?? false,
        audioOutput: input.capabilities?.audioOutput ?? false,
        fileRead: input.capabilities?.fileRead ?? false,
        tts: input.capabilities?.tts ?? input.capabilities?.audioOutput ?? false,
        tti: input.capabilities?.tti ?? input.capabilities?.imageOutput ?? false,
        embedding: input.capabilities?.embedding ?? false,
      },
      metadata: input.metadata ?? {},
    };
  }

  async run(input: BuildHermesAgentEnvelopeInput): Promise<HermesAgentResponse> {
    const envelope = this.buildEnvelope(input);

    if (!this.enabled || !this.endpoint) {
      return protocolUnavailableResponse(envelope.threadId, "Hermes Agent bridge endpoint is not configured or disabled");
    }

    // Phase 1 intentionally refuses to call unknown/text-only endpoints. Phase 2 will
    // add real HTTP/MCP/tool protocol execution and response parsing.
    return protocolUnavailableResponse(envelope.threadId, "Hermes Agent protocol execution is not implemented in Phase 1");
  }

  assertAvailable(): void {
    if (!this.enabled || !this.endpoint) {
      throw new HermesAgentProtocolUnavailableError();
    }
  }

  getConfigForTest(): HermesAgentBridgeOptions {
    return {
      enabled: this.enabled,
      endpoint: this.endpoint,
      protocolVersion: this.protocolVersion,
      timeoutMs: this.timeoutMs,
    };
  }
}

export function protocolUnavailableResponse(threadId: string, message: string): HermesAgentResponse {
  return {
    text: "Hermes tool unavailable: true Hermes Agent protocol endpoint is not available.",
    confidence: 0,
    toolCalls: [],
    toolResults: [],
    actions: [],
    media: [],
    safety: {
      blocked: true,
      reason: HERMES_AGENT_PROTOCOL_UNAVAILABLE,
      metadata: { threadId },
    },
    errors: [
      {
        code: HERMES_AGENT_PROTOCOL_UNAVAILABLE,
        message,
      },
    ],
  };
}

function inferMessageType(content: string, attachments?: HermesAgentAttachment[]): HermesAgentMessageType {
  const first = attachments?.[0];
  if (first && (first.type === "image" || first.type === "audio" || first.type === "video" || first.type === "file")) {
    return first.type;
  }
  return content.trim() ? "text" : "unknown";
}

let hermesAgentBridge: HermesAgentBridge | null = null;

export function getHermesAgentBridge(): HermesAgentBridge {
  if (!hermesAgentBridge) hermesAgentBridge = new HermesAgentBridge();
  return hermesAgentBridge;
}

export function setHermesAgentBridgeForTest(bridge: HermesAgentBridge | null): void {
  hermesAgentBridge = bridge;
}
