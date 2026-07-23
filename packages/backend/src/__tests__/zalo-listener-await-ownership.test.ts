import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const listenerBoundary = vi.hoisted(() => ({
  normalizeMessage: vi.fn(),
  saveIncomingMessage: vi.fn(),
  handleIncomingMessage: vi.fn(async () => {}),
  normalizeReaction: vi.fn(),
  handleIncomingReaction: vi.fn(async () => {}),
}));

vi.mock("../services/zalo-receive.js", () => ({
  normalizeMessage: listenerBoundary.normalizeMessage,
  saveIncomingMessage: listenerBoundary.saveIncomingMessage,
}));

vi.mock("../services/incoming-dispatcher.service.js", () => ({
  handleIncomingMessage: listenerBoundary.handleIncomingMessage,
}));

vi.mock("../services/zalo-reaction-utils.js", () => ({
  normalizeReaction: listenerBoundary.normalizeReaction,
}));

vi.mock("../services/zalo-reaction.service.js", () => ({
  handleIncomingReaction: listenerBoundary.handleIncomingReaction,
}));

import { ZaloGatewayService } from "../services/zalo-gateway.service.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

class TestListener extends EventEmitter {
  start = vi.fn(async () => {});
  stop = vi.fn(async () => {});
}

async function startOwnedListener(gateway: ZaloGatewayService, selfUserId: string) {
  const listener = new TestListener();
  (gateway as any).api = {
    listener,
    getOwnId: () => selfUserId,
  };
  (gateway as any).status = { ...(gateway as any).status, selfUserId };
  const bindings = await (gateway as any).startListener();
  expect(bindings).not.toBeNull();
  return { listener, bindings };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Zalo listener ownership across await boundaries", () => {
  it("does not mutate or dispatch a message after its binding becomes stale during save", async () => {
    const gateway = new ZaloGatewayService();
    const message: Record<string, unknown> = {
      threadId: "message-thread",
      content: "message content",
    };
    listenerBoundary.normalizeMessage.mockReturnValue(message);
    const save = deferred<{ saved: boolean; dbMessageId: string }>();
    listenerBoundary.saveIncomingMessage.mockReturnValueOnce(save.promise);
    const { bindings } = await startOwnedListener(gateway, "owner-message");

    const pending = bindings.message({ isSelf: false });
    await vi.waitFor(() => expect(listenerBoundary.saveIncomingMessage).toHaveBeenCalledOnce());
    await (gateway as any).stopListener();
    await startOwnedListener(gateway, "replacement-message");
    save.resolve({ saved: true, dbMessageId: "stale-db-id" });
    await pending;

    expect(message.dbMessageId).toBeUndefined();
    expect(listenerBoundary.handleIncomingMessage).not.toHaveBeenCalled();
    await (gateway as any).stopListener();
  });

  it("does not dispatch a reaction after its binding becomes stale across a dynamic import", async () => {
    const gateway = new ZaloGatewayService();
    listenerBoundary.normalizeReaction.mockReturnValue({
      threadId: "reaction-thread",
      uidFrom: "reaction-user",
      rIcon: "heart",
      isSelf: false,
    });
    const { bindings } = await startOwnedListener(gateway, "owner-reaction");

    const pending = bindings.reaction({});
    await (gateway as any).stopListener();
    await startOwnedListener(gateway, "replacement-reaction");
    await pending;

    expect(listenerBoundary.handleIncomingReaction).not.toHaveBeenCalled();
    await (gateway as any).stopListener();
  });

  it("uses the listener owner identity instead of mutable replacement status", async () => {
    const gateway = new ZaloGatewayService();
    const message = { threadId: "owner-thread", content: "owner content" };
    listenerBoundary.normalizeMessage.mockReturnValue(message);
    listenerBoundary.saveIncomingMessage.mockResolvedValue({ saved: true, dbMessageId: "owner-db-id" });
    listenerBoundary.normalizeReaction.mockReturnValue({
      threadId: "owner-thread",
      uidFrom: "reaction-user",
      rIcon: "heart",
      isSelf: false,
    });
    const { bindings } = await startOwnedListener(gateway, "binding-owner");
    (gateway as any).status = { ...(gateway as any).status, selfUserId: "replacement-status" };

    await bindings.message({ isSelf: false });
    await bindings.reaction({});

    expect(listenerBoundary.saveIncomingMessage).toHaveBeenCalledWith(message, "binding-owner");
    expect(listenerBoundary.handleIncomingMessage).toHaveBeenCalledWith(message, "binding-owner");
    expect(listenerBoundary.handleIncomingReaction).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "owner-thread" }),
      "binding-owner",
    );
    await (gateway as any).stopListener();
  });
});
