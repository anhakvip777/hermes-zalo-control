/**
 * Dark theme UI primitives — single source of truth for all admin pages.
 * All components follow DESIGN.md: bg #0B1222, surface #1E293B, border slate-700,
 * accent blue-600, text slate-100/slate-400.
 */

import React from "react";

// ═══════════════════════════════════════════════════════════════════
// Layout primitives
// ═══════════════════════════════════════════════════════════════════

/** Standard dark card */
export function Card({
  children,
  className = "",
  accentLeft,
}: {
  children: React.ReactNode;
  className?: string;
  accentLeft?: "blue" | "green" | "red" | "yellow" | "purple" | "orange";
}) {
  const accent = accentLeft
    ? {
        blue: "border-l-2 border-l-blue-500",
        green: "border-l-2 border-l-green-500",
        red: "border-l-2 border-l-red-500",
        yellow: "border-l-2 border-l-yellow-500",
        purple: "border-l-2 border-l-purple-500",
        orange: "border-l-2 border-l-orange-500",
      }[accentLeft]
    : "";
  return (
    <div
      className={`rounded-xl border border-slate-700 bg-slate-800/60 p-6 ${accent} ${className}`}
    >
      {children}
    </div>
  );
}

/** Page header with optional refresh button */
export function PageHeader({
  title,
  subtitle,
  onRefresh,
  children,
}: {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">{title}</h1>
        {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
      </div>
      <div className="flex gap-2">
        {children}
        {onRefresh && (
          <DarkButton variant="ghost" onClick={onRefresh}>
            🔄 Làm mới
          </DarkButton>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Loading / empty / error states
// ═══════════════════════════════════════════════════════════════════

export function LoadingSpinner({ text = "Đang tải..." }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-slate-400 text-sm">{text}</p>
    </div>
  );
}

export function EmptyState({
  message,
  icon = "📭",
}: {
  message: string;
  icon?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-10 text-center">
      <div className="text-3xl mb-2">{icon}</div>
      <p className="text-slate-500 text-sm">{message}</p>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-700/60 bg-red-900/20 p-4 text-red-300 text-sm">
      ❌ {message}
    </div>
  );
}

export function WarnBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-yellow-700/60 bg-yellow-900/20 p-4 text-yellow-300 text-sm">
      ⚠️ {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-green-700/60 bg-green-900/20 p-4 text-green-300 text-sm">
      ✅ {message}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Buttons
// ═══════════════════════════════════════════════════════════════════

type ButtonVariant = "primary" | "ghost" | "danger" | "success" | "warn";
type ButtonSize = "sm" | "md" | "lg";

export function DarkButton({
  variant = "ghost",
  size = "sm",
  disabled,
  onClick,
  type,
  children,
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  children: React.ReactNode;
  className?: string;
}) {
  const base = "inline-flex items-center gap-1.5 font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base",
  };
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-blue-600 hover:bg-blue-500 text-white",
    ghost: "bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600",
    danger: "bg-red-700 hover:bg-red-600 text-white",
    success: "bg-green-700 hover:bg-green-600 text-white",
    warn: "bg-amber-700 hover:bg-amber-600 text-white",
  };
  return (
    <button
      type={type ?? "button"}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Form controls
// ═══════════════════════════════════════════════════════════════════

const inputBase =
  "bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500";

export function DarkInput({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`${inputBase} px-3 py-2 text-sm w-full ${className}`}
    />
  );
}

export function DarkSelect({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`${inputBase} px-3 py-2 text-sm w-full ${className}`}
    >
      {children}
    </select>
  );
}

export function DarkTextarea({
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${inputBase} px-3 py-2 text-sm w-full ${className}`}
    />
  );
}

export function DarkCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-900"
      />
      {label}
    </label>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Badges
// ═══════════════════════════════════════════════════════════════════

type StatusPillVariant =
  | "sent"
  | "dry-run"
  | "blocked"
  | "failed"
  | "ready"
  | "not-ready"
  | "connected"
  | "disconnected"
  | "active"
  | "inactive"
  | "warn"
  | "info"
  | "low"
  | "medium"
  | "high";

const PILL_CLS: Record<StatusPillVariant, string> = {
  sent: "bg-green-950 text-green-400 border-green-800",
  "dry-run": "bg-amber-950 text-amber-400 border-amber-800",
  blocked: "bg-red-950 text-red-400 border-red-800",
  failed: "bg-red-950 text-red-400 border-red-800",
  ready: "bg-green-950 text-green-400 border-green-800",
  "not-ready": "bg-slate-800 text-slate-400 border-slate-600",
  connected: "bg-green-950 text-green-400 border-green-800",
  disconnected: "bg-red-950 text-red-400 border-red-800",
  active: "bg-green-950 text-green-400 border-green-800",
  inactive: "bg-slate-800 text-slate-500 border-slate-700",
  warn: "bg-yellow-950 text-yellow-400 border-yellow-800",
  info: "bg-blue-950 text-blue-400 border-blue-800",
  low: "bg-green-950 text-green-400 border-green-800",
  medium: "bg-yellow-950 text-yellow-400 border-yellow-800",
  high: "bg-red-950 text-red-400 border-red-800",
};

export function StatusPill({
  variant,
  children,
  pulse,
}: {
  variant: StatusPillVariant;
  children: React.ReactNode;
  pulse?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${PILL_CLS[variant]} ${pulse ? "animate-pulse" : ""}`}
    >
      {children}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Key-value row
// ═══════════════════════════════════════════════════════════════════

export function Kv({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: unknown;
  accent?: "red" | "green" | "yellow";
  mono?: boolean;
}) {
  const color =
    accent === "red"
      ? "text-red-400"
      : accent === "green"
        ? "text-green-400"
        : accent === "yellow"
          ? "text-yellow-400"
          : "text-slate-200";
  return (
    <div className="flex justify-between items-center text-xs gap-2 py-0.5">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`font-medium text-right break-all ${color} ${mono ? "font-mono" : ""}`}>
        {String(value ?? "—")}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Stat card
// ═══════════════════════════════════════════════════════════════════

export function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "red" | "green" | "yellow" | "blue";
}) {
  const cls =
    accent === "green"
      ? "bg-green-900/30 border-green-700/60 text-green-300"
      : accent === "yellow"
        ? "bg-yellow-900/30 border-yellow-700/60 text-yellow-300"
        : accent === "red"
          ? "bg-red-900/30 border-red-700/60 text-red-300"
          : accent === "blue"
            ? "bg-blue-900/30 border-blue-700/60 text-blue-300"
            : "bg-slate-700/60 border-slate-600 text-slate-300";

  return (
    <div className={`rounded-lg border p-3 text-center ${cls}`}>
      <div className="text-xs opacity-75 mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Table helpers
// ═══════════════════════════════════════════════════════════════════

export function DarkTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  );
}

export function DarkThead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-slate-700">
      <tr>{children}</tr>
    </thead>
  );
}

export function DarkTh({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-4 py-2.5 font-medium text-slate-500 uppercase tracking-wide text-[11px]">
      {children}
    </th>
  );
}

export function DarkTr({
  children,
  highlight,
}: {
  children: React.ReactNode;
  highlight?: "blue" | "amber";
}) {
  const bg =
    highlight === "blue"
      ? "bg-blue-900/20 border-b border-slate-700/50"
      : highlight === "amber"
        ? "bg-amber-900/20 border-b border-slate-700/50"
        : "border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors";
  return <tr className={bg}>{children}</tr>;
}

export function DarkTd({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}

// ═══════════════════════════════════════════════════════════════════
// Code snippet
// ═══════════════════════════════════════════════════════════════════

export function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">
      {children}
    </pre>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-slate-900 border border-slate-700 px-1.5 py-0.5 rounded text-xs font-mono text-slate-300">
      {children}
    </code>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Section divider label
// ═══════════════════════════════════════════════════════════════════

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
      {children}
    </p>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Severity badge (error/warn/ok)
// ═══════════════════════════════════════════════════════════════════

export function SeverityPill({ severity }: { severity: string }) {
  const cls =
    severity === "ERROR" || severity === "high"
      ? "bg-red-900/40 text-red-300 border-red-700/60"
      : severity === "WARN" || severity === "medium"
        ? "bg-yellow-900/40 text-yellow-300 border-yellow-700/60"
        : "bg-green-900/40 text-green-300 border-green-700/60";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {severity}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Modal wrapper
// ═══════════════════════════════════════════════════════════════════

export function DarkModal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl z-10">
        {children}
      </div>
    </div>
  );
}
