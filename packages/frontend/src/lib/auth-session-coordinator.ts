import type { AdminCredentialStore } from "./admin-auth";

export interface AuthAttempt {
  id: number;
  generation: number;
  candidate: string;
  controller: AbortController;
}

export interface AuthSessionCoordinator {
  begin(username: string, password: string): AuthAttempt;
  isCurrent(attempt: AuthAttempt): boolean;
  clearIfCurrent(attempt: AuthAttempt): boolean;
  finish(attempt: AuthAttempt): void;
  cancel(): void;
}

type AuthCredentialStore = Pick<AdminCredentialStore, "set" | "clear" | "generation">;

export function createAuthSessionCoordinator(store: AuthCredentialStore): AuthSessionCoordinator {
  let nextId = 0;
  let active: AuthAttempt | null = null;
  let ownedGeneration: number | null = null;

  function begin(username: string, password: string): AuthAttempt {
    active?.controller.abort();
    const candidate = store.set(username, password);
    const generation = store.generation();
    const attempt: AuthAttempt = {
      id: ++nextId,
      generation,
      candidate,
      controller: new AbortController(),
    };
    active = attempt;
    ownedGeneration = generation;
    return attempt;
  }

  function isCurrent(attempt: AuthAttempt): boolean {
    return (
      active?.id === attempt.id &&
      active.generation === attempt.generation &&
      store.generation() === attempt.generation
    );
  }

  function clearIfCurrent(attempt: AuthAttempt): boolean {
    if (!isCurrent(attempt)) return false;
    const cleared = store.clear(attempt.generation);
    if (cleared && ownedGeneration === attempt.generation) {
      ownedGeneration = null;
    }
    return cleared;
  }

  function finish(attempt: AuthAttempt): void {
    if (active?.id === attempt.id) active = null;
  }

  function cancel(): void {
    const current = active;
    const generation = current?.generation ?? ownedGeneration;
    active = null;
    ownedGeneration = null;
    current?.controller.abort();
    if (generation !== null) {
      store.clear(generation);
    }
  }

  return { begin, isCurrent, clearIfCurrent, finish, cancel };
}
