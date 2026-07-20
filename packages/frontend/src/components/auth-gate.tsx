"use client";

import { FormEvent, useState, type ReactNode } from "react";
import { useAuth } from "./auth-provider";

function LoginForm() {
  const { status, error, login } = useAuth();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    try {
      await login(username, password);
    } finally {
      setPassword("");
      setSubmitted(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0B1222] text-slate-200 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-950 p-6 shadow-xl">
        <h1 className="text-lg font-semibold">Hermes Zalo Bridge</h1>
        <p className="mt-1 text-sm text-slate-400">Đăng nhập quản trị viên để xem dashboard.</p>
        <label className="mt-6 block text-xs text-slate-400">
          Username
          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label className="mt-3 block text-xs text-slate-400">
          Password
          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {(error || status === "unavailable") && <p className="mt-3 rounded border border-red-900 bg-red-950/50 p-2 text-xs text-red-300">{error ?? "Backend unavailable"}</p>}
        <button className="mt-5 w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" type="submit" disabled={submitted || status === "checking"}>
          {status === "checking" ? "Đang xác thực…" : "Đăng nhập"}
        </button>
      </form>
    </main>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === "authenticated") return <>{children}</>;
  return <LoginForm />;
}
