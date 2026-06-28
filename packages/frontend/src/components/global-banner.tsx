"use client";

import { useEffect, useState } from "react";
import {
  getAdminStatus,
  adminPauseSending,
  adminResumeSending,
  adminEmergencyStop,
  adminClearEmergency,
  type AdminStatus,
} from "../lib/api-client";
import { useToast } from "./toast";

export function GlobalBanner() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchStatus = () => {
    getAdminStatus()
      .then(setStatus)
      .catch(() => setError("Failed to load status"));
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10_000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-red-800 bg-red-950 p-3 text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (!status) {
    return <div className="h-12 animate-pulse rounded-md bg-muted" />;
  }

  const emergency = status.emergencyStop;
  const warn = !status.sendingEnabled || !status.schedulesActive;

  const doAction = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg, "success");
      fetchStatus();
    } catch {
      toast("Action failed", "error");
    }
  };

  const bg = emergency
    ? "border-red-800 bg-red-950 text-red-300"
    : warn
      ? "border-yellow-800 bg-yellow-950 text-yellow-200"
      : "border-green-800 bg-green-950 text-green-300";

  return (
    <div className={`rounded-md border p-3 text-sm ${bg}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-semibold">
            {emergency
              ? "⚠ Emergency Stop Active"
              : !status.sendingEnabled
                ? "⚠ Sending Paused"
                : !status.schedulesActive
                  ? "⚠ Schedules Paused"
                  : "✓ All Systems Operational"}
          </span>
          <span className="text-xs opacity-75">
            Send: {status.sendingEnabled ? "ON" : "OFF"} · Schedules:{" "}
            {status.schedulesActive ? "ON" : "OFF"} · E-Stop:{" "}
            {status.emergencyStop ? "YES" : "NO"}
          </span>
        </div>
        <div className="flex gap-2">
          {!status.sendingEnabled && !emergency && (
            <button
              onClick={() => doAction(adminResumeSending, "Sending resumed")}
              className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-600"
            >
              Resume Sending
            </button>
          )}
          {status.sendingEnabled && !emergency && (
            <button
              onClick={() => doAction(adminPauseSending, "Sending paused")}
              className="rounded bg-yellow-700 px-2 py-1 text-xs font-medium text-white hover:bg-yellow-600"
            >
              Pause Sending
            </button>
          )}
          {!emergency ? (
            <button
              onClick={() => {
                if (
                  typeof window !== "undefined" &&
                  window.confirm(
                    "EMERGENCY STOP: This will cancel ALL queued jobs and halt all sending. Continue?",
                  )
                ) {
                  doAction(adminEmergencyStop, "Emergency stop active");
                }
              }}
              className="rounded bg-red-700 px-2 py-1 text-xs font-medium text-white hover:bg-red-600"
            >
              Emergency Stop
            </button>
          ) : (
            <button
              onClick={() => doAction(adminClearEmergency, "Emergency cleared")}
              className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-600"
            >
              Clear Emergency
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
