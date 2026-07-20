"use client";

import { ToastProvider } from "./toast";
import { AuthProvider } from "./auth-provider";
import { AuthGate } from "./auth-gate";
import { DashboardShell } from "./dashboard-shell";
import { OperationalStatusProvider } from "./operational-status-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <AuthGate>
          <OperationalStatusProvider>
            <DashboardShell>{children}</DashboardShell>
          </OperationalStatusProvider>
        </AuthGate>
      </AuthProvider>
    </ToastProvider>
  );
}
