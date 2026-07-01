"use client";

import type { Metadata } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <head>
        <title>Hermes Zalo Admin</title>
      </head>
      <body className="min-h-screen bg-[var(--color-surface-muted,#F8FAFC)] text-gray-900">
        <div className="flex min-h-screen">
          <Sidebar />
          {/* Main Content */}
          <main className="flex-1 flex flex-col min-w-0">
            {/* Safety Banner */}
            <div className="px-4 py-1.5 bg-brand-light/60 border-b border-blue-200 flex items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700 border border-blue-300">
                🛡️ DRY RUN
              </span>
              <span className="text-blue-700 text-xs">
                Toàn bộ tin nhắn đang ở chế độ mô phỏng. Kiểm tra{" "}
                <Link href="/production-readiness" className="underline font-medium">Production Readiness</Link>{" "}
                trước khi bật live.
              </span>
            </div>
            <div className="flex-1 p-6 overflow-auto">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}

/* ── Sidebar ──────────────────────────────────────────────────────── */

const navGroups = [
  {
    label: "Giám sát",
    items: [
      { href: "/", label: "Tổng quan", icon: "📊" },
      { href: "/messages", label: "Tin nhắn", icon: "📨" },
      { href: "/system-health", label: "Sức khỏe HT", icon: "🏥" },
      { href: "/production-readiness", label: "Go Live?", icon: "🚦" },
    ],
  },
  {
    label: "Kiểm soát",
    items: [
      { href: "/access-control", label: "Phân quyền", icon: "🔑" },
      { href: "/thread-settings", label: "Cài đặt Thread", icon: "⚙️" },
      { href: "/thread-review", label: "Đánh giá Thread", icon: "🔍" },
      { href: "/safety-mode", label: "Safety Mode", icon: "🛡️" },
    ],
  },
  {
    label: "Vận hành",
    items: [
      { href: "/schedules", label: "Lịch trình", icon: "📅" },
      { href: "/rules", label: "Rule Engine", icon: "🧠" },
      { href: "/documents", label: "Tài liệu", icon: "📄" },
      { href: "/attendance", label: "Điểm danh", icon: "✅" },
    ],
  },
  {
    label: "Hệ thống",
    items: [
      { href: "/zalo-ops", label: "Zalo Ops", icon: "📡" },
      { href: "/runtime-settings", label: "Runtime Config", icon: "🎛️" },
      { href: "/admin-tools", label: "Admin Tools", icon: "🔧" },
    ],
  },
];

function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <aside className="w-60 bg-slate-800 text-white flex-shrink-0 flex flex-col">
      {/* App Header */}
      <div className="px-5 py-4 border-b border-slate-700/60">
        <h1 className="text-base font-bold tracking-tight flex items-center gap-2">
          <span className="text-blue-400">◈</span> Hermes Zalo
        </h1>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Trung tâm điều khiển
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-3 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {group.label}
            </p>
            <div className="space-y-0.5 mt-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors duration-150 ${
                      active
                        ? "bg-blue-600/20 text-blue-300 border-l-2 border-blue-400 ml-[-2px]"
                        : "text-slate-300 hover:text-white hover:bg-slate-700/60"
                    }`}
                  >
                    <span className="text-sm w-4 text-center">{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-slate-700/60">
        <p className="text-[10px] text-slate-500">
          Hermes Agent v1.0 · UTC+7
        </p>
      </div>
    </aside>
  );
}
