"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getLiveTestStatus,
  getZaloOpsStatus,
  type LiveTestStatusResult,
  type ZaloOpsStatus,
} from "../lib/api-client";
import {
  loadingState,
  readyState,
  unknownState,
  type RemoteDataState,
} from "../lib/dashboard-state";
import {
  createOperationalStatusCoordinator,
  type OperationalStatusCoordinator,
} from "../lib/operational-status-coordinator";

interface OperationalStatusContextValue {
  zalo: RemoteDataState<ZaloOpsStatus>;
  liveTest: RemoteDataState<LiveTestStatusResult>;
  refresh(): Promise<void>;
}

const OperationalStatusContext = createContext<OperationalStatusContextValue | null>(null);

interface OperationalStatusSnapshot {
  zalo: RemoteDataState<ZaloOpsStatus>;
  liveTest: RemoteDataState<LiveTestStatusResult>;
}

export function OperationalStatusProvider({ children }: { children: ReactNode }) {
  const [zalo, setZalo] = useState<RemoteDataState<ZaloOpsStatus>>(() => loadingState());
  const [liveTest, setLiveTest] = useState<RemoteDataState<LiveTestStatusResult>>(() =>
    loadingState(),
  );
  const coordinatorRef = useRef<OperationalStatusCoordinator | null>(null);
  const coordinator =
    coordinatorRef.current ??
    (coordinatorRef.current = createOperationalStatusCoordinator<OperationalStatusSnapshot>({
      load: async (signal) => {
        const [zaloResult, liveResult] = await Promise.allSettled([
          getZaloOpsStatus(signal),
          getLiveTestStatus(signal),
        ]);
        return {
          zalo:
            zaloResult.status === "fulfilled"
              ? readyState(zaloResult.value)
              : unknownState(zaloResult.reason, "Không thể tải trạng thái Zalo"),
          liveTest:
            liveResult.status === "fulfilled"
              ? readyState(liveResult.value)
              : unknownState(liveResult.reason, "Không thể tải trạng thái live test"),
        };
      },
      commit: (snapshot) => {
        setZalo(snapshot.zalo);
        setLiveTest(snapshot.liveTest);
      },
      onError: (error) => {
        setZalo(unknownState(error, "Không thể tải trạng thái Zalo"));
        setLiveTest(unknownState(error, "Không thể tải trạng thái live test"));
      },
      intervalMs: 30_000,
    }));

  const refresh = useCallback(() => coordinator.refresh(), [coordinator]);

  useEffect(() => {
    coordinator.start();
    return () => coordinator.stop();
  }, [coordinator]);

  const value = useMemo(() => ({ zalo, liveTest, refresh }), [zalo, liveTest, refresh]);
  return (
    <OperationalStatusContext.Provider value={value}>{children}</OperationalStatusContext.Provider>
  );
}

export function useOperationalStatus(): OperationalStatusContextValue {
  const value = useContext(OperationalStatusContext);
  if (!value) throw new Error("useOperationalStatus must be used inside OperationalStatusProvider");
  return value;
}
