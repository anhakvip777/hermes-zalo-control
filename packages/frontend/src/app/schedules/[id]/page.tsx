"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getSchedule,
  cancelSchedule,
  pauseSchedule,
  resumeSchedule,
  runNow,
  runDry,
  getScheduleRevisions,
  getScheduleExecutions,
  getScheduleJobs,
  type Schedule,
  type ScheduleExecution,
  type ScheduleRevision,
  type ScheduleJob,
} from "../../../lib/api-client";
import { StatusBadge, TypeBadge } from "../../../components/status-badge";
import { EditScheduleForm } from "../../../components/edit-schedule-form";
import { useToast } from "../../../components/toast";

type Tab = "overview" | "executions" | "revisions" | "jobs";

export default function ScheduleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const id = params.id as string;

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [executions, setExecutions] = useState<ScheduleExecution[]>([]);
  const [revisions, setRevisions] = useState<ScheduleRevision[]>([]);
  const [jobs, setJobs] = useState<ScheduleJob[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const fetchAll = useCallback(() => {
    setLoading(true);
    Promise.all([
      getSchedule(id),
      getScheduleExecutions(id),
      getScheduleRevisions(id),
      getScheduleJobs(id),
    ])
      .then(([sRes, eRes, rRes, jRes]) => {
        setSchedule(sRes.data);
        setExecutions(eRes.data);
        setRevisions(rRes.data);
        setJobs(jRes.data);
      })
      .catch(() => toast("Failed to load schedule details", "error"))
      .finally(() => setLoading(false));
  }, [id, toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const doAction = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg, "success");
      fetchAll();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Action failed", "error");
    }
  };

  if (loading && !schedule) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-800" />
        <div className="h-96 animate-pulse rounded-lg bg-slate-800" />
      </div>
    );
  }

  if (!schedule) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-2xl font-semibold text-white">Schedule Not Found</h2>
        <button
          onClick={() => router.push("/schedules")}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          Back to Schedules
        </button>
      </div>
    );
  }

  const isRunnable = schedule.status === "scheduled" || schedule.status === "active";

  const btnPrimary = "rounded-md bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-600";
  const btnGreen = "rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-600";
  const btnPurple = "rounded-md bg-purple-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-600";
  const btnYellow = "rounded-md bg-yellow-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-yellow-600";
  const btnBlue = "rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600";
  const btnRed = "rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600";
  const btnOutline = "rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800";

  const tabBtn = (t: Tab) => (
    <button
      key={t}
      onClick={() => setTab(t)}
      className={`px-4 py-2 text-sm font-medium capitalize ${
        tab === t
          ? "border-b-2 border-slate-400 text-slate-100"
          : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {t}
    </button>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/schedules")}
              className="text-sm text-slate-400 hover:text-slate-200"
            >
              ← Back
            </button>
            <h2 className="text-2xl font-semibold tracking-tight text-white">{schedule.name}</h2>
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <TypeBadge type={schedule.type} />
            <StatusBadge status={schedule.status} />
            <span className="text-slate-400">v{schedule.version}</span>
            <span className="text-slate-400">by {schedule.createdBy}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => setEditOpen(!editOpen)} className={btnOutline}>
            {editOpen ? "Cancel Edit" : "Edit"}
          </button>
          {isRunnable && (
            <button onClick={() => doAction(() => runNow(id), "Ran now")} className={btnGreen}>
              Run Now
            </button>
          )}
          <button onClick={() => doAction(() => runDry(id), "Dry run complete")} className={btnPurple}>
            Dry Run
          </button>
          {isRunnable && (
            <button onClick={() => doAction(() => pauseSchedule(id), "Paused")} className={btnYellow}>
              Pause
            </button>
          )}
          {schedule.status === "paused" && (
            <button onClick={() => doAction(() => resumeSchedule(id), "Resumed")} className={btnBlue}>
              Resume
            </button>
          )}
          {schedule.status !== "cancelled" && (
            <button
              onClick={() => {
                if (typeof window !== "undefined" && window.confirm("Cancel this schedule?")) {
                  doAction(() => cancelSchedule(id), "Cancelled");
                }
              }}
              className={btnRed}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {editOpen && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-lg font-semibold text-white">Edit Schedule</h3>
          <EditScheduleForm schedule={schedule} onDone={fetchAll} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800">
        {(["overview", "executions", "revisions", "jobs"] as Tab[]).map(tabBtn)}
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <InfoRow label="Name" value={schedule.name} />
          <InfoRow label="Type" value={schedule.type} />
          <InfoRow label="Status" value={<StatusBadge status={schedule.status} />} />
          <InfoRow label="Version" value={`v${schedule.version}`} />
          <InfoRow label="Target ID" value={schedule.targetId} />
          <InfoRow label="Target Name" value={schedule.targetName ?? "—"} />
          <InfoRow
            label="Scheduled At"
            value={schedule.scheduledAt ? new Date(schedule.scheduledAt).toLocaleString() : "—"}
          />
          <InfoRow
            label="Next Run"
            value={schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : "—"}
          />
          <InfoRow
            label="Repeat"
            value={schedule.repeatEnabled ? `Yes (${schedule.repeatCron ?? "—"})` : "No"}
          />
          <InfoRow label="Created By" value={schedule.createdBy} />
          <InfoRow label="Original Command" value={schedule.originalCommand ?? "—"} full />
          <InfoRow label="Message Content" value={schedule.messageContent} full />
          <InfoRow label="Created At" value={new Date(schedule.createdAt).toLocaleString()} />
          <InfoRow label="Updated At" value={new Date(schedule.updatedAt).toLocaleString()} />
        </div>
      )}

      {tab === "executions" && (
        <DataTable
          emptyMsg="No executions yet"
          headers={["Status", "Mode", "Target", "Content", "Finished", "Msg ID", "Error"]}
          rows={executions.map((e) => ({
            id: e.id,
            cells: [
              <StatusBadge key="s" status={e.status} />,
              <span key="m" className="text-xs text-slate-400">{e.mode}</span>,
              <span key="t" className="max-w-[100px] truncate block text-xs text-slate-200" title={e.targetName ?? e.targetId}>{e.targetName ?? e.targetId}</span>,
              <span key="c" className="max-w-[120px] truncate block text-xs text-slate-200" title={e.messageContent}>{e.messageContent.slice(0, 60)}</span>,
              <span key="f" className="whitespace-nowrap text-xs text-slate-400">{e.finishedAt ? new Date(e.finishedAt).toLocaleString() : e.actualRunAt ? new Date(e.actualRunAt).toLocaleString() : "—"}</span>,
              <span key="z" className="text-xs font-mono text-slate-400">{e.zaloMessageId?.slice(0, 12) ?? "—"}</span>,
              <span key="err" className="max-w-[100px] truncate block text-xs text-red-400" title={e.errorMessage ?? ""}>{e.errorMessage?.slice(0, 40) ?? "—"}</span>,
            ],
          }))}
        />
      )}

      {tab === "revisions" && (
        <DataTable
          emptyMsg="No revisions yet"
          headers={["Field", "Old Value", "New Value", "By", "Version", "Date"]}
          rows={revisions.map((r) => ({
            id: r.id,
            cells: [
              <span key="f" className="text-xs font-mono text-slate-200">{r.field}</span>,
              <span key="o" className="max-w-[150px] truncate block text-xs text-slate-400" title={r.oldValue ?? ""}>{r.oldValue ?? "—"}</span>,
              <span key="n" className="max-w-[150px] truncate block text-xs text-slate-200" title={r.newValue ?? ""}>{r.newValue ?? "—"}</span>,
              <span key="c" className="text-xs text-slate-400">{r.changedBy}</span>,
              <span key="v" className="text-xs text-slate-400">v{r.scheduleVersion}</span>,
              <span key="d" className="whitespace-nowrap text-xs text-slate-400">{new Date(r.createdAt).toLocaleString()}</span>,
            ],
          }))}
        />
      )}

      {tab === "jobs" && (
        <DataTable
          emptyMsg="No jobs yet"
          headers={["Queue ID", "Status", "Type", "Ver", "Scheduled", "Created", "Cancelled", "Done"]}
          rows={jobs.map((j) => ({
            id: j.id,
            cells: [
              <span key="q" className="text-xs font-mono text-slate-400">{j.queueJobId?.slice(0, 16) ?? "—"}</span>,
              <StatusBadge key="s" status={j.status} />,
              <span key="t" className="text-xs text-slate-400">{j.type}</span>,
              <span key="v" className="text-xs text-slate-400">v{j.scheduleVersion}</span>,
              <span key="sa" className="whitespace-nowrap text-xs text-slate-400">{j.scheduledAt ? new Date(j.scheduledAt).toLocaleString() : "—"}</span>,
              <span key="cr" className="whitespace-nowrap text-xs text-slate-400">{new Date(j.createdAt).toLocaleString()}</span>,
              <span key="cc" className="whitespace-nowrap text-xs text-slate-400">{j.cancelledAt ? new Date(j.cancelledAt).toLocaleString() : "—"}</span>,
              <span key="co" className="whitespace-nowrap text-xs text-slate-400">{j.completedAt ? new Date(j.completedAt).toLocaleString() : "—"}</span>,
            ],
          }))}
        />
      )}
    </div>
  );
}

function InfoRow({ label, value, full }: { label: string; value: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <div className="mt-0.5 text-sm text-slate-200">{value}</div>
    </div>
  );
}

function DataTable({
  headers,
  rows,
  emptyMsg,
}: {
  headers: string[];
  rows: { id: string; cells: React.ReactNode[] }[];
  emptyMsg: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-500">
        {emptyMsg}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-900 text-left text-xs text-slate-300">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i} className="border-t border-slate-800 text-slate-200 hover:bg-slate-800/50">
              {row.cells.map((cell, ci) => (
                <td key={ci} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
