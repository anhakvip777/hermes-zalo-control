"use client";

import { useState } from "react";
import { updateSchedule, type Schedule } from "../lib/api-client";
import { useToast } from "./toast";

export function EditScheduleForm({ schedule, onDone }: { schedule: Schedule; onDone: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    scheduledAt: schedule.scheduledAt ? schedule.scheduledAt.slice(0, 16) : "",
    messageContent: schedule.messageContent,
    targetId: schedule.targetId,
    targetName: schedule.targetName ?? "",
    status: schedule.status,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        scheduledAt: (form.scheduledAt && !isNaN(Date.parse(form.scheduledAt)))
          ? new Date(form.scheduledAt).toISOString()
          : form.scheduledAt === "" ? null : undefined,
        messageContent: form.messageContent,
        targetId: form.targetId,
        targetName: form.targetName || null,
      };
      if (form.status !== schedule.status) {
        body.status = form.status;
      }
      await updateSchedule(schedule.id, body);
      toast("Schedule updated", "success");
      onDone();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Update failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, el: React.ReactNode) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {el}
    </label>
  );

  const inputClass = "w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {field(
        "Scheduled At",
        <input
          type="datetime-local"
          className={inputClass}
          value={form.scheduledAt}
          onChange={(e) => setForm({ ...form, scheduledAt: (e.target as HTMLInputElement).value })}
        />,
      )}
      {field(
        "Message Content",
        <textarea
          className={inputClass}
          rows={3}
          value={form.messageContent}
          onChange={(e) =>
            setForm({ ...form, messageContent: (e.target as HTMLTextAreaElement).value })
          }
        />,
      )}
      <div className="grid grid-cols-2 gap-4">
        {field(
          "Target ID",
          <input
            className={inputClass}
            value={form.targetId}
            onChange={(e) => setForm({ ...form, targetId: (e.target as HTMLInputElement).value })}
          />,
        )}
        {field(
          "Target Name",
          <input
            className={inputClass}
            value={form.targetName}
            onChange={(e) =>
              setForm({ ...form, targetName: (e.target as HTMLInputElement).value })
            }
          />,
        )}
      </div>
      {field(
        "Status",
        <select
          className={inputClass}
          value={form.status}
          onChange={(e) =>
            setForm({ ...form, status: (e.target as HTMLSelectElement).value })
          }
        >
          <option value="draft">Draft</option>
          <option value="scheduled">Scheduled</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="cancelled">Cancelled</option>
          <option value="expired">Expired</option>
        </select>,
      )}
      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save Changes"}
      </button>
    </form>
  );
}
