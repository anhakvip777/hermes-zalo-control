import { describe, expect, it } from "vitest";
import type { AdminCredentialStore } from "./admin-auth";
import { createAuthSessionCoordinator } from "./auth-session-coordinator";

function makeStore(): AdminCredentialStore {
  let authorization: string | null = null;
  let generation = 0;
  return {
    getAuthorization: () => authorization,
    set: (username, password) => {
      authorization = "Basic " + username + ":" + password;
      generation += 1;
      return authorization;
    },
    clear: (expectedGeneration) => {
      if (expectedGeneration !== undefined && expectedGeneration !== generation) return false;
      if (!authorization) return false;
      authorization = null;
      generation += 1;
      return true;
    },
    generation: () => generation,
    subscribe: () => () => {},
  };
}

describe("auth session coordinator", () => {
  it("aborts the previous attempt and makes only the latest attempt current", () => {
    const store = makeStore();
    const coordinator = createAuthSessionCoordinator(store);

    const first = coordinator.begin("admin", "first");
    const second = coordinator.begin("admin", "second");

    expect(first.controller.signal.aborted).toBe(true);
    expect(coordinator.isCurrent(first)).toBe(false);
    expect(coordinator.isCurrent(second)).toBe(true);
  });

  it("cannot clear credentials owned by a newer attempt", () => {
    const store = makeStore();
    const coordinator = createAuthSessionCoordinator(store);

    const first = coordinator.begin("admin", "first");
    const second = coordinator.begin("admin", "second");

    expect(coordinator.clearIfCurrent(first)).toBe(false);
    expect(store.getAuthorization()).toBe(second.candidate);
    expect(coordinator.clearIfCurrent(second)).toBe(true);
    expect(store.getAuthorization()).toBeNull();
  });

  it("cancel aborts and clears the active attempt, is idempotent, and permits restart", () => {
    const store = makeStore();
    const coordinator = createAuthSessionCoordinator(store);
    const first = coordinator.begin("admin", "first");

    coordinator.cancel();
    coordinator.cancel();

    expect(first.controller.signal.aborted).toBe(true);
    expect(store.getAuthorization()).toBeNull();

    const second = coordinator.begin("admin", "second");
    expect(coordinator.isCurrent(second)).toBe(true);
  });

  it("finishing an older attempt cannot release a newer attempt", () => {
    const store = makeStore();
    const coordinator = createAuthSessionCoordinator(store);
    const first = coordinator.begin("admin", "first");
    const second = coordinator.begin("admin", "second");

    coordinator.finish(first);

    expect(coordinator.isCurrent(second)).toBe(true);
  });

  it("treats an attempt as stale when the store generation changes externally", () => {
    const store = makeStore();
    const coordinator = createAuthSessionCoordinator(store);
    const attempt = coordinator.begin("admin", "first");

    store.set("admin", "external");

    expect(coordinator.isCurrent(attempt)).toBe(false);
    expect(coordinator.clearIfCurrent(attempt)).toBe(false);
    expect(store.getAuthorization()).toBe("Basic admin:external");
  });

  it("treats an attempt as stale when the store is cleared externally", () => {
    const store = makeStore();
    const coordinator = createAuthSessionCoordinator(store);
    const attempt = coordinator.begin("admin", "first");

    store.clear();

    expect(coordinator.isCurrent(attempt)).toBe(false);
  });

  it("cancel clears credentials from a finished attempt owned by this coordinator", () => {
    const store = makeStore();
    const coordinator = createAuthSessionCoordinator(store);
    const attempt = coordinator.begin("admin", "finished");

    coordinator.finish(attempt);
    coordinator.cancel();

    expect(store.getAuthorization()).toBeNull();
  });

  it("does not clear credentials owned by another coordinator", () => {
    const store = makeStore();
    const oldCoordinator = createAuthSessionCoordinator(store);
    const newCoordinator = createAuthSessionCoordinator(store);

    oldCoordinator.begin("admin", "old");
    const newerAttempt = newCoordinator.begin("admin", "new");

    oldCoordinator.cancel();

    expect(store.getAuthorization()).toBe(newerAttempt.candidate);
  });
});
