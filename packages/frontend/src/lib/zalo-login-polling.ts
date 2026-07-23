import type { LoginStatusOutput, QRImageResult, ZaloConnectionStatus, ZaloOpsStatus } from "./api-client";

export type ZaloLoginCardReconcileInput = {
  connectionStatus: ZaloConnectionStatus;
  connectionDetail: ZaloOpsStatus["connectionDetail"];
  lastError: string | null;
  session: {
    exists: boolean;
    qrUpdatedAt: string | null;
    updatedAt: string | null;
    backupAvailable: boolean;
  };
};

/**
 * Stable parent-status identity used as the QR card React key.
 * Volatile counters/heartbeats are deliberately excluded so a routine refresh
 * does not restart the card's request lifecycle.
 */
export function getZaloLoginCardReconcileKey(input: ZaloLoginCardReconcileInput): string {
  const safetyBlockPrefix = "LOGIN_SAFETY_BLOCKED:";
  const safetyBlockedReason = input.connectionStatus === "blocked" && input.lastError?.startsWith(safetyBlockPrefix)
    ? input.lastError.slice(safetyBlockPrefix.length)
    : null;

  return JSON.stringify({
    connectionStatus: input.connectionStatus,
    connectionDetail: input.connectionDetail,
    safetyBlockedReason,
    session: {
      exists: input.session.exists,
      qrUpdatedAt: input.session.qrUpdatedAt,
      updatedAt: input.session.updatedAt,
      backupAvailable: input.session.backupAvailable,
    },
  });
}

export type ZaloLoginPollDecision = {
  phase: "pending" | "connected" | "expired" | "blocked" | "error" | "idle";
  fetchQr: boolean;
  stopPolling: boolean;
  clearQr: boolean;
  message: string | null;
};

export type ZaloLoginStatus = Pick<
  LoginStatusOutput,
  "connected" | "connectionStatus" | "qrAvailable" | "lastError"
>;

export const ZALO_LOGIN_POLL_ERROR_MESSAGE = "LOGIN_STATUS_UNAVAILABLE";

export type ZaloLoginInitialDecision = Omit<ZaloLoginPollDecision, "phase"> & {
  phase: ZaloLoginPollDecision["phase"] | "idle";
  startPolling: boolean;
};

export type ZaloLoginStatusRequestSlot = {
  current: AbortController | null;
};

export type ZaloLoginUiPhase =
  | "checking"
  | "idle"
  | "starting"
  | "pending"
  | "cancelling"
  | "connected"
  | "expired"
  | "blocked"
  | "error";

export type ZaloLoginUiAction =
  | "start"
  | "replace"
  | "cancel"
  | "check_status"
  | "return_idle";

export type ZaloLoginPanelA11y = {
  role: "status" | "alert";
  live: "polite" | "assertive";
  busy: "true" | "false";
};

export function getZaloLoginPanelA11y(phase: ZaloLoginUiPhase): ZaloLoginPanelA11y {
  switch (phase) {
    case "checking":
    case "starting":
    case "pending":
    case "cancelling":
      return { role: "status", live: "polite", busy: "true" };
    case "blocked":
    case "expired":
    case "error":
      return { role: "alert", live: "assertive", busy: "false" };
    case "idle":
    case "connected":
      return { role: "status", live: "polite", busy: "false" };
  }
}

export function getZaloLoginUiActions(phase: ZaloLoginUiPhase): readonly ZaloLoginUiAction[] {
  switch (phase) {
    case "idle":
      return ["start"];
    case "starting":
      return ["cancel"];
    case "pending":
      return ["replace", "cancel"];
    case "expired":
      return ["start", "return_idle"];
    case "blocked":
      return ["return_idle"];
    case "error":
      return ["check_status"];
    case "checking":
    case "cancelling":
    case "connected":
      return [];
  }
}

export type ZaloLoginPollStepResult = {
  decision: ZaloLoginPollDecision;
  qr: QRImageResult | null;
  ignored?: true;
};

export type ZaloLoginReconciliation =
  | {
      kind: "known";
      status: LoginStatusOutput;
      decision: ZaloLoginInitialDecision;
    }
  | { kind: "blocked"; message: string }
  | { kind: "stale" }
  | { kind: "unavailable"; message: typeof ZALO_LOGIN_POLL_ERROR_MESSAGE };

export function decideZaloLoginPoll(status: ZaloLoginStatus): ZaloLoginPollDecision {
  if (status.connected) {
    return { phase: "connected", fetchQr: false, stopPolling: true, clearQr: true, message: null };
  }

  switch (status.connectionStatus as ZaloConnectionStatus) {
    case "connecting":
    case "waiting_qr_scan":
      return { phase: "pending", fetchQr: status.qrAvailable, stopPolling: false, clearQr: false, message: null };
    case "blocked":
      return {
        phase: "blocked",
        fetchQr: false,
        stopPolling: true,
        clearQr: true,
        message: status.lastError?.replace("LOGIN_SAFETY_BLOCKED:", "") ?? "LOGIN_SAFETY_BLOCKED",
      };
    case "expired":
      return { phase: "expired", fetchQr: false, stopPolling: true, clearQr: true, message: null };
    case "disconnected":
      return { phase: "idle", fetchQr: false, stopPolling: true, clearQr: true, message: null };
    case "error":
      return {
        phase: "error",
        fetchQr: false,
        stopPolling: true,
        clearQr: true,
        message: ZALO_LOGIN_POLL_ERROR_MESSAGE,
      };
    case "connected":
    default:
      return {
        phase: "error",
        fetchQr: false,
        stopPolling: true,
        clearQr: true,
        message: ZALO_LOGIN_POLL_ERROR_MESSAGE,
      };
  }
}

export function decideZaloLoginInitialState(status: ZaloLoginStatus): ZaloLoginInitialDecision {
  const decision = decideZaloLoginPoll(status);
  if (decision.phase !== "pending") {
    return { ...decision, startPolling: false };
  }
  return { ...decision, startPolling: true };
}

export function getZaloLoginSafetyBlockedReason(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  if (candidate.status !== 409 || candidate.code !== "LOGIN_SAFETY_BLOCKED") return null;
  return typeof candidate.message === "string" && candidate.message
    ? candidate.message
    : "LOGIN_SAFETY_BLOCKED";
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  return typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
}

export function isIgnorableZaloLoginRequestError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === "REQUEST_ABORTED" || code === "STALE_RESPONSE";
}

export type ZaloLoginStatusRequestErrorDecision =
  | { kind: "ignore" }
  | { kind: "blocked"; message: string }
  | { kind: "error"; message: typeof ZALO_LOGIN_POLL_ERROR_MESSAGE };

/**
 * Classify a status-poll failure without collapsing a server safety decision
 * into the generic unavailable state.
 */
export function decideZaloLoginStatusRequestError(error: unknown): ZaloLoginStatusRequestErrorDecision {
  if (isIgnorableZaloLoginRequestError(error)) return { kind: "ignore" };
  const blockedReason = getZaloLoginSafetyBlockedReason(error);
  if (blockedReason) return { kind: "blocked", message: blockedReason };
  return { kind: "error", message: ZALO_LOGIN_POLL_ERROR_MESSAGE };
}

export function beginZaloLoginStatusRequest(
  slot: ZaloLoginStatusRequestSlot,
): AbortController | null {
  if (slot.current) return null;
  const controller = new AbortController();
  slot.current = controller;
  return controller;
}

export function finishZaloLoginStatusRequest(
  slot: ZaloLoginStatusRequestSlot,
  controller: AbortController,
): void {
  if (slot.current === controller) slot.current = null;
}

export async function runZaloLoginPollStep(
  status: ZaloLoginStatus,
  loadQr: () => Promise<QRImageResult>,
): Promise<ZaloLoginPollStepResult> {
  const decision = decideZaloLoginPoll(status);
  if (!decision.fetchQr) return { decision, qr: null };

  try {
    return { decision, qr: await loadQr() };
  } catch (error: unknown) {
    const blockedReason = getZaloLoginSafetyBlockedReason(error);
    if (blockedReason) {
      return {
        decision: {
          phase: "blocked",
          fetchQr: false,
          stopPolling: true,
          clearQr: true,
          message: blockedReason,
        },
        qr: null,
      };
    }

    if (isIgnorableZaloLoginRequestError(error)) {
      return { decision, qr: null, ignored: true };
    }

    const code = getErrorCode(error);
    if (code === "QR_NOT_FOUND") return { decision, qr: null };
    if (code === "QR_EXPIRED") {
      return {
        decision: {
          phase: "expired",
          fetchQr: false,
          stopPolling: true,
          clearQr: true,
          message: null,
        },
        qr: null,
      };
    }
    return {
      decision: {
        phase: "error",
        fetchQr: false,
        stopPolling: true,
        clearQr: true,
        message: ZALO_LOGIN_POLL_ERROR_MESSAGE,
      },
      qr: null,
    };
  }
}

export async function cancelAndReconcileZaloLogin(
  cancel: () => Promise<unknown>,
  loadStatus: () => Promise<LoginStatusOutput>,
): Promise<ZaloLoginReconciliation> {
  try {
    await cancel();
  } catch (error: unknown) {
    if (isIgnorableZaloLoginRequestError(error)) return { kind: "stale" };
    // A failed cancel is not server truth. Continue with a read-only status check.
  }

  try {
    const status = await loadStatus();
    return {
      kind: "known",
      status,
      decision: decideZaloLoginInitialState(status),
    };
  } catch (error: unknown) {
    if (isIgnorableZaloLoginRequestError(error)) return { kind: "stale" };
    const blockedReason = getZaloLoginSafetyBlockedReason(error);
    if (blockedReason) return { kind: "blocked", message: blockedReason };
    return { kind: "unavailable", message: ZALO_LOGIN_POLL_ERROR_MESSAGE };
  }
}

export function isCurrentZaloLoginQrRequest(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration;
}

export function isCurrentZaloLoginFlow(
  requestGeneration: number,
  currentGeneration: number,
  signal?: AbortSignal,
): boolean {
  return requestGeneration === currentGeneration && signal?.aborted !== true;
}
