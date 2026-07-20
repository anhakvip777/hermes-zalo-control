export interface OperationalStatusCoordinatorOptions<T> {
  load(signal: AbortSignal): Promise<T>;
  commit(value: T): void;
  onError?(error: unknown): void;
  intervalMs?: number;
}

export interface OperationalStatusCoordinator {
  start(): void;
  refresh(): Promise<void>;
  stop(): void;
}

export function createOperationalStatusCoordinator<T>(
  options: OperationalStatusCoordinatorOptions<T>,
): OperationalStatusCoordinator {
  const intervalMs = options.intervalMs ?? 30_000;
  let phase: "new" | "running" | "stopped" = "new";
  let nextId = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let active: { id: number; promise: Promise<void>; controller: AbortController } | null = null;

  function isCurrent(id: number, controller: AbortController): boolean {
    return phase !== "stopped" && !controller.signal.aborted && active?.id === id;
  }

  function release(id: number): void {
    if (active?.id === id) active = null;
  }

  function refresh(): Promise<void> {
    if (phase === "stopped") return Promise.resolve();
    if (active) return active.promise;

    const id = ++nextId;
    const controller = new AbortController();
    const request = (async () => {
      try {
        const value = await Promise.resolve().then(() => options.load(controller.signal));
        if (isCurrent(id, controller)) {
          options.commit(value);
        }
      } catch (error) {
        if (isCurrent(id, controller)) {
          try {
            options.onError?.(error);
          } catch {
            // A reporting callback must not reject fire-and-forget polling.
          }
        }
      } finally {
        release(id);
      }
    })();

    active = { id, promise: request, controller };
    return request;
  }

  function start(): void {
    if (phase === "running") return;
    phase = "running";
    void refresh();
    timer = setInterval(() => {
      void refresh();
    }, intervalMs);
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    phase = "stopped";
    const current = active;
    active = null;
    current?.controller.abort();
  }

  return { start, refresh, stop };
}
