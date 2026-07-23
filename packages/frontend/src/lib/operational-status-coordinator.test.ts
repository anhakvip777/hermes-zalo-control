import { afterEach, describe, expect, it, vi } from "vitest";
import { createOperationalStatusCoordinator } from "./operational-status-coordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("operational status coordinator", () => {
  it("shares one in-flight promise and never overlaps refreshes", async () => {
    const first = deferred<string>();
    const load = vi.fn(() => first.promise);
    const commit = vi.fn();
    const coordinator = createOperationalStatusCoordinator({ load, commit, intervalMs: 30_000 });

    coordinator.start();
    const requestA = coordinator.refresh();
    const requestB = coordinator.refresh();

    expect(requestB).toBe(requestA);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    first.resolve("first");
    await requestA;
    expect(commit).toHaveBeenCalledWith("first");
    coordinator.stop();
  });

  it("waits for an active request before running a fresh post-mutation refresh", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const commit = vi.fn();
    const coordinator = createOperationalStatusCoordinator({ load, commit, intervalMs: 30_000 });

    coordinator.start();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);

    const mutationRefresh = coordinator.refreshAfterMutation();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);

    first.resolve("before");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));

    second.resolve("after");
    await mutationRefresh;

    expect(commit).toHaveBeenNthCalledWith(1, "before");
    expect(commit).toHaveBeenNthCalledWith(2, "after");
    coordinator.stop();
  });

  it("keeps a post-mutation refresh a no-op after stop", async () => {
    const load = vi.fn(async () => "unexpected");
    const coordinator = createOperationalStatusCoordinator({ load, commit: vi.fn() });

    coordinator.stop();
    await coordinator.refreshAfterMutation();

    expect(load).not.toHaveBeenCalled();
  });

  it("does not start an overlapping interval request while the current one is pending", async () => {
    vi.useFakeTimers();
    const first = deferred<string>();
    const second = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const coordinator = createOperationalStatusCoordinator({
      load,
      commit: vi.fn(),
      intervalMs: 1_000,
    });

    coordinator.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(load).toHaveBeenCalledTimes(1);

    first.resolve("first");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(load).toHaveBeenCalledTimes(2);

    second.resolve("second");
    await coordinator.refresh();
    coordinator.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stop aborts the active request and ignores its late result", async () => {
    const pending = deferred<string>();
    const load = vi.fn((_signal: AbortSignal) => pending.promise);
    const commit = vi.fn();
    const coordinator = createOperationalStatusCoordinator({ load, commit, intervalMs: 30_000 });

    coordinator.start();
    const request = coordinator.refresh();
    await Promise.resolve();
    const signal = load.mock.calls[0]?.[0];
    coordinator.stop();
    pending.resolve("late");

    await request;
    expect(signal?.aborted).toBe(true);
    expect(commit).not.toHaveBeenCalled();
  });

  it("makes a captured refresh a no-op after stop", async () => {
    const load = vi.fn(async () => "unexpected");
    const coordinator = createOperationalStatusCoordinator({
      load,
      commit: vi.fn(),
      intervalMs: 30_000,
    });
    coordinator.start();
    await Promise.resolve();
    const refresh = coordinator.refresh;
    coordinator.stop();

    await refresh();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("is restartable and an old finally cannot clear the newer request", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const commit = vi.fn();
    const coordinator = createOperationalStatusCoordinator({ load, commit, intervalMs: 30_000 });

    coordinator.start();
    const oldRequest = coordinator.refresh();
    coordinator.stop();
    coordinator.start();
    const newRequest = coordinator.refresh();

    first.resolve("old");
    await oldRequest;
    expect(load).toHaveBeenCalledTimes(2);

    second.resolve("new");
    await newRequest;
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenLastCalledWith("new");
    coordinator.stop();
  });

  it("reports synchronous load failures and permits a later refresh", async () => {
    const syncError = new Error("sync load failed");
    const load = vi
      .fn()
      .mockImplementationOnce(() => {
        throw syncError;
      })
      .mockResolvedValueOnce("recovered");
    const onError = vi.fn();
    const commit = vi.fn();
    const coordinator = createOperationalStatusCoordinator({ load, commit, onError });

    await expect(coordinator.refresh()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(syncError);

    await coordinator.refresh();
    expect(load).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledWith("recovered");
    coordinator.stop();
  });

  it("clears the interval when stop reenters during the initial load", async () => {
    vi.useFakeTimers();
    let coordinator!: ReturnType<typeof createOperationalStatusCoordinator<string>>;
    const load = vi.fn(() => {
      coordinator.stop();
      return Promise.resolve("ignored");
    });
    coordinator = createOperationalStatusCoordinator({ load, commit: vi.fn(), intervalMs: 1_000 });

    coordinator.start();
    await Promise.resolve();

    expect(load).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    coordinator.stop();
  });

  it("settles refresh safely when onError throws", async () => {
    const loadError = new Error("load failed");
    const callbackError = new Error("onError failed");
    const onError = vi.fn(() => {
      throw callbackError;
    });
    const coordinator = createOperationalStatusCoordinator({
      load: vi.fn(async () => {
        throw loadError;
      }),
      commit: vi.fn(),
      onError,
    });

    await expect(coordinator.refresh()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(loadError);
    coordinator.stop();
  });

  it("keeps start idempotent and disposes its interval on stop", () => {
    vi.useFakeTimers();
    const coordinator = createOperationalStatusCoordinator({
      load: vi.fn(async () => "ok"),
      commit: vi.fn(),
      intervalMs: 1_000,
    });

    coordinator.start();
    coordinator.start();
    expect(vi.getTimerCount()).toBe(1);

    coordinator.stop();
    expect(vi.getTimerCount()).toBe(0);
    coordinator.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
