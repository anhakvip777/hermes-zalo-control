"use client";

import { useEffect, useState } from "react";
import {
  getAdminStatus,
  adminPauseSending,
  adminResumeSending,
  adminEmergencyStop,
  adminClearEmergency,
  type AdminStatus,
} from "../../lib/api-client";
import { useToast } from "../../components/toast";

export default function AdminPage() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchStatus = () => {
    setLoading(true);
    getAdminStatus()
      .then(setStatus)
      .catch(() => toast("Failed to load admin status", "error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10_000);
    return () => clearInterval(interval);
  }, []);

  const doAction = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg, "success");
      fetchStatus();
    } catch {
      toast("Action failed", "error");
    }
  };

  const card = (label: string, value: string, color: string) => (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
    </div>
  );

  const btnClass = "rounded-md px-4 py-2 text-sm font-medium text-white hover:opacity-90";

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight text-white">Admin</h2>

      {loading && !status ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-800" />
          ))}
        </div>
      ) : status ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {card(
              "Sending",
              status.sendingEnabled ? "Enabled" : "Disabled",
              status.sendingEnabled ? "text-green-400" : "text-red-400",
            )}
            {card(
              "Schedules",
              status.schedulesActive ? "Active" : "Paused",
              status.schedulesActive ? "text-green-400" : "text-yellow-400",
            )}
            {card(
              "Emergency Stop",
              status.emergencyStop ? "ACTIVE" : "Inactive",
              status.emergencyStop ? "text-red-400" : "text-slate-400",
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {status.sendingEnabled && !status.emergencyStop && (
              <button
                onClick={() => doAction(adminPauseSending, "Sending paused")}
                className={`${btnClass} bg-yellow-700 hover:bg-yellow-600`}
              >
                Pause Sending
              </button>
            )}
            {!status.sendingEnabled && !status.emergencyStop && (
              <button
                onClick={() => doAction(adminResumeSending, "Sending resumed")}
                className={`${btnClass} bg-green-700 hover:bg-green-600`}
              >
                Resume Sending
              </button>
            )}
            {!status.emergencyStop ? (
              <button
                onClick={() => {
                  if (
                    typeof window !== "undefined" &&
                    window.confirm(
                      "EMERGENCY STOP: Cancel ALL queued jobs and halt all sending?",
                    )
                  ) {
                    doAction(adminEmergencyStop, "Emergency stop active");
                  }
                }}
                className={`${btnClass} bg-red-700 hover:bg-red-600`}
              >
                Emergency Stop
              </button>
            ) : (
              <button
                onClick={() => doAction(adminClearEmergency, "Emergency cleared")}
                className={`${btnClass} bg-green-700 hover:bg-green-600`}
              >
                Clear Emergency Stop
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
