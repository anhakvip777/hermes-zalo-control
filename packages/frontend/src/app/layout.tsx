"use client";

import type { Metadata } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { getZaloOpsStatus, getLiveTestStatus, type ZaloOpsStatus } from "../lib/api-client";
import "./globals.css";

/* ── Nav structure ─────────────────────────────────────────────── */
const navGroups = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: "▦" },
      { href: "/messages", label: "Messages", icon: "◈" },
    ],
  },
  {
    label: "Access",
    items: [
      { href: "/access-control", label: "Access Control", icon: "⊞" },
      { href: "/allow-threads", label: "Allow Threads", icon: "⊠" },
      { href: "/thread-settings", label: "Thread Settings", icon: "⊟" },
      { href: "/thread-review", label: "Thread Review", icon: "⊕" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/schedules", label: "Schedules", icon: "◷" },
      { href: "/rules", label: "Rule Engine", icon: "◉" },
      { href: "/documents", label: "Documents", icon: "◫" },
      { href: "/attendance", label: "Attendance", icon: "◻" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/zalo-ops", label: "Zalo Ops", icon: "◬" },
      { href: "/trace", label: "Decision Trace", icon: "◈" },
      { href: "/retrieval-test", label: "Retrieval Test", icon: "◔" },
      { href: "/production-readiness", label: "Readiness", icon: "◎" },
      { href: "/system-health", label: "System Health", icon: "◌" },
      { href: "/runtime-settings", label: "Runtime Config", icon: "⊡" },
      { href: "/safety-mode", label: "Safety Mode", icon: "⊗" },
      { href: "/admin-tools", label: "Admin Tools", icon: "⊘" },
    ],
  },
];

/* ── TopBar ─────────────────────────────────────────────────────── */
function TopBar() {
  const [zalo, setZalo] = useState<ZaloOpsStatus | null>(null);
  const [liveActive, setLiveActive] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    getZaloOpsStatus().then(setZalo).catch(() => {});
    getLiveTestStatus().then((s) => setLiveActive(s.active)).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  const zaloConnected = zalo?.connected ?? null;
  const listenerActive = zalo?.listenerActive ?? null;
  const dryRun = zalo?.dryRun ?? null;

  return (
    <div className="h-11 px-5 flex items-center justify-between border-b border-slate-800 bg-slate-950/70 backdrop-blur-sm shrink-0">
      {/* Left: breadcrumb placeholder */}
      <div className="text-xs text-slate-500">Hermes Zalo Bridge</div>

      {/* Right: status pills */}
      <div className="flex items-center gap-2">
        {/* DryRun */}
        {dryRun === null ? (
          <span className="status-pill bg-slate-800 text-slate-500 border-slate-700">⏳ —</span>
        ) : dryRun ? (
          <span className="status-pill bg-amber-950 text-amber-400 border-amber-800">🛡 DRY RUN</span>
        ) : (
          <span className="status-pill bg-red-950 text-red-400 border-red-800 animate-pulse">⚡ LIVE</span>
        )}

        {/* Live test */}
        {liveActive === true && (
          <span className="status-pill bg-red-950 text-red-400 border-red-800">🔴 LIVE TEST</span>
        )}

        {/* Zalo */}
        {zaloConnected === null ? (
          <span className="status-pill bg-slate-800 text-slate-500 border-slate-700">Zalo —</span>
        ) : zaloConnected ? (
          <span className="status-pill bg-green-950 text-green-400 border-green-800">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse mr-1" />
            Zalo OK
          </span>
        ) : (
          <span className="status-pill bg-red-950 text-red-400 border-red-800">⚠ Zalo ✕</span>
        )}

        {/* Listener */}
        {zalo !== null && (
          listenerActive ? (
            <span className="status-pill bg-slate-800 text-slate-400 border-slate-700">Listener ✓</span>
          ) : (
            <span className="status-pill bg-yellow-950 text-yellow-400 border-yellow-800">Listener ✕</span>
          )
        )}
      </div>
    </div>
  );
}

/* ── Sidebar ─────────────────────────────────────────────────────── */
function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <aside className="w-56 bg-slate-950 border-r border-slate-800 flex-shrink-0 flex flex-col min-h-screen">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            H
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100 leading-tight">Hermes Zalo</p>
            <p className="text-[10px] text-slate-500 leading-tight">Bridge Control</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-4 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] transition-colors duration-100 ${
                      active
                        ? "bg-blue-500/10 text-blue-400 border-l-2 border-blue-500 ml-[-2px] pl-[10px]"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/70"
                    }`}
                  >
                    <span className={`text-[12px] font-mono ${active ? "text-blue-500" : "text-slate-600"}`}>
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-slate-800">
        <p className="text-[10px] text-slate-600">v1.0 · UTC+7 · Zalo Bridge</p>
      </div>
    </aside>
  );
}

/* ── Root Layout ─────────────────────────────────────────────────── */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <title>Hermes Zalo Bridge</title>
        <style>{`
          .status-pill {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: 9999px;
            font-size: 11px;
            font-weight: 600;
            border-width: 1px;
            border-style: solid;
          }
        `}</style>
      </head>
      <body className="min-h-screen bg-[#0B1222] text-slate-200">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 flex flex-col min-w-0">
            <TopBar />
            <div className="flex-1 p-6 overflow-auto">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
