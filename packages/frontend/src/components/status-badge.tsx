const COLORS: Record<string, string> = {
  active: "bg-green-900/50 text-green-300 border border-green-700",
  scheduled: "bg-blue-900/50 text-blue-300 border border-blue-700",
  draft: "bg-slate-800 text-slate-400 border border-slate-700",
  paused: "bg-yellow-900/50 text-yellow-300 border border-yellow-700",
  cancelled: "bg-red-900/50 text-red-300 border border-red-700",
  expired: "bg-slate-800/50 text-slate-500 border border-slate-700",
  success: "bg-green-900/50 text-green-300 border border-green-700",
  completed: "bg-green-900/50 text-green-300 border border-green-700",
  failed: "bg-red-900/50 text-red-300 border border-red-700",
  retrying: "bg-yellow-900/50 text-yellow-300 border border-yellow-700",
  skipped: "bg-slate-800 text-slate-500 border border-slate-700",
  pending: "bg-purple-900/50 text-purple-300 border border-purple-700",
  running: "bg-cyan-900/50 text-cyan-300 border border-cyan-700",
  queued: "bg-blue-900/50 text-blue-300 border border-blue-700",
  cancelled_job: "bg-slate-800 text-slate-500 border border-slate-700",
};

export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const color =
    COLORS[status] ?? "bg-slate-800 text-slate-400 border border-slate-700";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color} ${className}`}
    >
      {status}
    </span>
  );
}

export function TypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    zalo_message: "Zalo Msg",
    attendance: "Attendance",
    poll_extract: "Poll",
    custom_agent_task: "Agent Task",
  };
  return (
    <span className="inline-flex items-center rounded-md bg-slate-800 px-2 py-0.5 text-xs font-mono text-slate-300 border border-slate-700">
      {labels[type] ?? type}
    </span>
  );
}
