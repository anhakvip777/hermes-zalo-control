// =============================================================================
// MessageSender — abstraction over Zalo / mock / future channels
// =============================================================================

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string;
}

export interface MessageSender {
  sendMessage(content: string, threadId: string, threadType: "user" | "group"): Promise<SendResult>;
}

// =============================================================================
// MockMessageSender — for dev/test, logs to console and always succeeds
// =============================================================================

export class MockMessageSender implements MessageSender {
  private sentMessages: Array<{
    content: string;
    threadId: string;
    threadType: string;
    timestamp: Date;
    messageId: string;
  }> = [];

  async sendMessage(
    content: string,
    threadId: string,
    threadType: "user" | "group",
  ): Promise<SendResult> {
    const messageId = `mock-msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    this.sentMessages.push({
      content,
      threadId,
      threadType,
      timestamp: new Date(),
      messageId,
    });

    // Simulate a small delay like a real network call
    await new Promise((r) => setTimeout(r, 10));

    return { success: true, messageId };
  }

  getSentMessages() {
    return [...this.sentMessages];
  }

  clearSentMessages() {
    this.sentMessages = [];
  }

  getLastSentMessage() {
    return this.sentMessages[this.sentMessages.length - 1] ?? null;
  }
}

// =============================================================================
// FailingMockMessageSender — for testing retry/error scenarios
// =============================================================================

export class FailingMockMessageSender implements MessageSender {
  private failuresRemaining: number;
  private errorCode: string;
  private errorMessage: string;

  constructor(failures: number = 1, errorCode?: string, errorMessage?: string) {
    this.failuresRemaining = failures;
    this.errorCode = errorCode ?? "SEND_FAILED";
    this.errorMessage = errorMessage ?? "Simulated send failure";
  }

  async sendMessage(
    _content: string,
    _threadId: string,
    _threadType: "user" | "group",
  ): Promise<SendResult> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      return {
        success: false,
        error: this.errorMessage,
        errorCode: this.errorCode,
      };
    }
    return { success: true, messageId: `mock-msg-${Date.now()}` };
  }
}
