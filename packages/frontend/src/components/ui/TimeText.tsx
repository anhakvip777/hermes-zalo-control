"use client";

import React from "react";

/**
 * Format a date/time value to Vietnam time (Asia/Ho_Chi_Minh, UTC+7).
 * Returns "DD/MM/YYYY HH:mm:ss UTC+7" by default.
 */
export function formatVnTime(
  value: string | Date | null | undefined,
  opts?: { showSeconds?: boolean; showDate?: boolean; showUtcLabel?: boolean }
): string {
  if (!value) return "—";

  const showSeconds = opts?.showSeconds ?? false;
  const showDate = opts?.showDate ?? true;
  const showUtcLabel = opts?.showUtcLabel ?? true;

  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);

    const fmt = new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: showDate ? "numeric" : undefined,
      month: showDate ? "2-digit" : undefined,
      day: showDate ? "2-digit" : undefined,
      hour: "2-digit",
      minute: "2-digit",
      second: showSeconds ? "2-digit" : undefined,
      hour12: false,
    });

    const parts = fmt.formatToParts(d);
    const datePart = showDate
      ? parts
          .filter((p) => p.type !== "literal" || p.value !== ":")
          .map((p) => p.value)
          .join("")
      : parts
          .filter((p) => p.type !== "literal" || p.value !== ":")
          .map((p) => p.value)
          .join("");

    return showUtcLabel ? `${datePart} UTC+7` : datePart;
  } catch {
    return String(value);
  }
}

/**
 * Relative time helper — e.g. "2 phút trước", "1 giờ trước", "3 ngày trước".
 */
export function formatRelativeTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffSec = Math.round(diffMs / 1000);
    const diffMin = Math.round(diffSec / 60);
    const diffHr = Math.round(diffMin / 60);
    const diffDay = Math.round(diffHr / 24);

    if (diffSec < 60) return "vừa xong";
    if (diffMin < 60) return `${diffMin} phút trước`;
    if (diffHr < 24) return `${diffHr} giờ trước`;
    if (diffDay < 30) return `${diffDay} ngày trước`;
    return formatVnTime(value, { showUtcLabel: false });
  } catch {
    return String(value);
  }
}

/**
 * Component that renders Vietnam time.
 * Shows relative time ("2 phút trước") with full VN time on hover (title).
 */
export function TimeText({
  value,
  showSeconds,
  showDate,
  showUtcLabel,
  className,
}: {
  value: string | Date | null | undefined;
  showSeconds?: boolean;
  showDate?: boolean;
  showUtcLabel?: boolean;
  className?: string;
}) {
  if (!value) return <span className={className}>—</span>;
  const full = formatVnTime(value, { showSeconds: true, showDate: true, showUtcLabel: true });
  const relative = formatRelativeTime(value);

  return (
    <span className={className} title={full}>
      {relative}
    </span>
  );
}

export default TimeText;
