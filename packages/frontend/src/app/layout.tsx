import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hermes Zalo Control Center",
  description: "Trung tâm điều khiển Zalo Hermes",
};

const navItems = [
  { href: "/", label: "Bảng điều khiển", icon: "📊" },
  { href: "/system-health", label: "System Health", icon: "🏥" },
  { href: "/messages", label: "Messages", icon: "📨" },
  { href: "/schedules", label: "Lịch trình", icon: "📅" },
  { href: "/thread-settings", label: "Cài đặt Thread", icon: "⚙️" },
  { href: "/thread-review", label: "Thread Review", icon: "🔍" },
  { href: "/errors", label: "Error Dashboard", icon: "🚨" },
  { href: "/admin-tools", label: "Admin Tools", icon: "🔧" },
  { href: "/safety-mode", label: "Safety Mode", icon: "🛡️" },
  { href: "/rules", label: "Rule Engine", icon: "🧠" },
  { href: "/documents", label: "Documents", icon: "📄" },
  { href: "/media-send", label: "Gửi Media", icon: "📤" },
  { href: "/attendance", label: "Điểm danh", icon: "✅" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <div className="flex min-h-screen">
          {/* Sidebar */}
          <aside className="w-64 bg-slate-800 text-white flex-shrink-0">
            <div className="p-6 border-b border-slate-700">
              <h1 className="text-xl font-bold tracking-tight">
                Hermes Zalo
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Trung tâm điều khiển
              </p>
            </div>
            <nav className="p-4 space-y-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium
                             text-slate-300 hover:text-white hover:bg-slate-700
                             transition-colors duration-150"
                >
                  <span className="text-lg">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="absolute bottom-0 left-0 w-64 p-4 border-t border-slate-700">
              <p className="text-xs text-slate-500">
                Hermes Agent v1.0
              </p>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 p-8 overflow-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
