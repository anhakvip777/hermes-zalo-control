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
import { adminCredentials } from "../lib/admin-auth";
import { ApiError, apiFetch } from "../lib/api";
import {
  createAuthSessionCoordinator,
  type AuthSessionCoordinator,
} from "../lib/auth-session-coordinator";

export type AuthStatus = "checking" | "authenticated" | "unauthenticated" | "unavailable";

interface SessionResponse {
  authenticated: true;
  username: string;
}

function isSessionResponse(value: unknown): value is SessionResponse {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return (
    session.authenticated === true &&
    typeof session.username === "string" &&
    session.username.trim().length > 0
  );
}

interface AuthContextValue {
  status: AuthStatus;
  username: string | null;
  error: string | null;
  login(username: string, password: string): Promise<boolean>;
  logout(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("unauthenticated");
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const coordinatorRef = useRef<AuthSessionCoordinator | null>(null);
  const coordinator =
    coordinatorRef.current ??
    (coordinatorRef.current = createAuthSessionCoordinator(adminCredentials));

  const logout = useCallback(() => {
    coordinator.cancel();
    setUsername(null);
    setStatus("unauthenticated");
    setError(null);
  }, [coordinator]);

  const login = useCallback(
    async (nextUsername: string, password: string) => {
      setStatus("checking");
      setError(null);
      const attempt = coordinator.begin(nextUsername, password);

      try {
        const session = await apiFetch<unknown>("/api/admin/session", {
          headers: { Authorization: attempt.candidate },
          skipAuthInvalidation: true,
          signal: attempt.controller.signal,
        });
        if (!coordinator.isCurrent(attempt)) return false;
        if (!isSessionResponse(session)) {
          throw new ApiError(0, "Invalid admin session response", session, "INVALID_RESPONSE");
        }

        setUsername(session.username);
        setStatus("authenticated");
        setError(null);
        return true;
      } catch (err) {
        if (!coordinator.isCurrent(attempt)) return false;

        coordinator.clearIfCurrent(attempt);
        setUsername(null);
        if (err instanceof ApiError && err.status === 401) {
          setStatus("unauthenticated");
          setError("Tên đăng nhập hoặc mật khẩu không đúng.");
        } else if (
          err instanceof ApiError &&
          (err.code === "REQUEST_ABORTED" || err.code === "STALE_RESPONSE")
        ) {
          setStatus("unauthenticated");
          setError(null);
        } else {
          setStatus("unavailable");
          setError("Không thể kết nối backend để xác thực.");
        }
        return false;
      } finally {
        coordinator.finish(attempt);
      }
    },
    [coordinator],
  );

  useEffect(() => {
    const unsubscribe = adminCredentials.subscribe(() => {
      if (!adminCredentials.getAuthorization()) {
        setUsername(null);
        setStatus("unauthenticated");
      }
    });
    return () => {
      unsubscribe();
      coordinator.cancel();
    };
  }, [coordinator]);

  const value = useMemo(
    () => ({ status, username, error, login, logout }),
    [status, username, error, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
