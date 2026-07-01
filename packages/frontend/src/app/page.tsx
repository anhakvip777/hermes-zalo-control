"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getZaloOpsStatus, getLiveTestStatus, type ZaloOpsStatus } from "../lib/api-client";

export default function DashboardPage() {
  const [zalo, setZalo] = useState<ZaloOpsStatus | null>(null);
  const [liveActive, setLiveActive] = useState<boolean | null>(null);

  useEffect(() => {
    getZaloOpsStatus().then(setZalo).catch(() => {});
    getLiveTestStatus().then((s) => setLiveActive(s.active)).catch(() => {});
    const interval = setInterval(() => {
      getZaloOpsStatus().then(setZalo).catch(() => {});
      getLiveTestStatus().then((s) => setLiveActive(s.active)).catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const cards = [
    {
      label: "Zalo",
      value: zalo?.connected ? "Đã kết nối" : zalo ? "Mất kết nối" : "—",
      icon: zalo?.connected ? "✅" : zalo ? "❌" : "⏳",
      color: zalo?.connected ? "border-green-200 bg-green-50" : zalo ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50",
    },
    {
      label: "Listener",
      value: zalo?.listenerActive ? "Đang chạy" : zalo ? "Đã dừng" : "—",
      icon: zalo?.listenerActive ? "✅" : zalo ? "❌" : "⏳",
      color: zalo?.listenerActive ? "border-green-200 bg-green-50" : zalo ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50",
    },
    {
      label: "Live Test",
      value: liveActive === true ? "ĐANG LIVE" : liveActive === false ? "Không hoạt động" : "—",
      icon: liveActive ? "🔴" : liveActive === false ? "✅" : "⏳",
      color: liveActive ? "border-red-200 bg-red-50" : liveActive === false ? "border-green-200 bg-green-50" : "border-slate-200 bg-slate-50",
    },
    {
      label: "Global DryRun",
      value: zalo?.dryRun ? "BẬT (an toàn)" : zalo ? "TẮT (live!)" : "—",
      icon: zalo?.dryRun ? "🛡️" : zalo ? "⚠️" : "⏳",
      color: zalo?.dryRun ? "border-blue-200 bg-blue-50" : zalo ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50",
    },
  ];

  const quickLinks = [
    { href: "/messages", icon: "📨", label: "Tin nhắn", desc: "Xem timeline tin nhắn và trạng thái gửi" },
    { href: "/access-control", icon: "🔑", label: "Phân quyền", desc: "Quản lý quyền truy cập người dùng Zalo" },
    { href: "/zalo-ops", icon: "📡", label: "Zalo Ops", desc: "Trạng thái kết nối, session, heartbeat" },
    { href: "/production-readiness", icon: "🚦", label: "Go Live?", desc: "Kiểm tra sẵn sàng production" },
    { href: "/system-health", icon: "🏥", label: "Sức khỏe HT", desc: "Trạng thái toàn hệ thống" },
    { href: "/schedules", icon: "📅", label: "Lịch trình", desc: "Quản lý cron jobs và scheduled tasks" },
  ];

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-800">Hermes Zalo Admin Center</h1>
        <p className="text-xs text-slate-500 mt-1">
          Trung tâm điều khiển bot Zalo — Controlled DM Pilot
        </p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-lg border ${c.color} p-4 shadow-card`}>
            <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1">{c.label}</p>
            <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <span>{c.icon}</span> {c.value}
            </p>
          </div>
        ))}
      </div>

      {/* Scope Card */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-card">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">📋 Phạm vi bàn giao</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ScopeItem status="ready" label="Controlled DM Pilot" detail="3/3 pilots PASS · 7 real sends" />
          <ScopeItem status="not-ready" label="Global Live" detail="Chưa bật — cần thêm pilot + scoring" />
          <ScopeItem status="not-ready" label="Group Rollout" detail="Chưa bật — chưa có group mention pilot" />
        </div>
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">⚡ Truy cập nhanh</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-card hover:shadow-card-hover hover:border-brand/30 transition-all group"
            >
              <div className="flex items-start gap-3">
                <span className="text-xl mt-0.5">{link.icon}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700 group-hover:text-brand transition-colors">{link.label}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{link.desc}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Footer note */}
      <p className="text-[11px] text-slate-400 text-center pt-4 border-t border-slate-100">
        Hermes Agent v1.0 · Múi giờ Việt Nam (UTC+7) · Tự động cập nhật mỗi 30s
      </p>
    </div>
  );
}

function ScopeItem({ status, label, detail }: { status: "ready" | "not-ready"; label: string; detail: string }) {
  const styles = status === "ready"
    ? { border: "border-green-200", bg: "bg-green-50", badge: "bg-green-100 text-green-700 border-green-200", icon: "✅" }
    : { border: "border-slate-200", bg: "bg-slate-50", badge: "bg-slate-100 text-slate-500 border-slate-200", icon: "⏸️" };

  return (
    <div className={`rounded-lg border ${styles.border} ${styles.bg} p-3`}>
      <p className="text-xs font-semibold text-slate-700">{label}</p>
      <p className="text-[11px] text-slate-500 mt-0.5">{detail}</p>
    </div>
  );
}
