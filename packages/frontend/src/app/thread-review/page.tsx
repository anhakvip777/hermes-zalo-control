"use client";

import { useEffect, useState } from "react";
import {
  getThreadReview,
  type ThreadReviewResponse,
  type ThreadReviewEntry,
} from "../../lib/api-client";
import { useToast } from "../../components/toast";

function RiskBadge({ level }: { level: ThreadReviewEntry["riskLevel"] }) {
  const colors: Record<string, string> = {
    low: "bg-green-100 text-green-800 border-green-300",
    medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
    high: "bg-red-100 text-red-800 border-red-300",
  };
  const labels: Record<string, string> = {
    low: "✅ Thấp",
    medium: "⚠️ Trung bình",
    high: "🔴 Cao",
  };

  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-bold border ${colors[level] ?? "bg-slate-100 text-slate-600 border-slate-300"}`}
    >
      {labels[level] ?? level}
    </span>
  );
}

function TypeBadge({ type }: { type: ThreadReviewEntry["threadType"] }) {
  const colors: Record<string, string> = {
    user: "bg-blue-100 text-blue-700",
    group: "bg-purple-100 text-purple-700",
    unknown: "bg-slate-100 text-slate-600",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[type] ?? ""}`}>
      {type === "user" ? "👤 DM" : type === "group" ? "👥 Group" : "❓ Unknown"}
    </span>
  );
}

export default function ThreadReviewPage() {
  const [data, setData] = useState<ThreadReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchData = () => {
    setLoading(true);
    setError(null);
    getThreadReview()
      .then(setData)
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        toast("Không tải được dữ liệu thread review", "error");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-400">Đang tải...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">🔍 Allowed Thread Review</h1>
          <p className="text-sm text-slate-500 mt-1">
            Rà soát độ an toàn của các thread trong allowlist trước khi bật live mode.
          </p>
        </div>
        <button
          onClick={fetchData}
          className="px-4 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
        >
          🔄 Làm mới
        </button>
      </div>

      {/* Summary cards */}
      {data?.summary && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <StatCard label="Tổng thread" value={data.summary.totalThreads} />
          <StatCard
            label="🔴 High risk"
            value={data.summary.highRiskCount}
            accent={data.summary.highRiskCount > 0 ? "red" : undefined}
          />
          <StatCard
            label="⚠️ Medium"
            value={data.summary.mediumRiskCount}
            accent={data.summary.mediumRiskCount > 0 ? "yellow" : undefined}
          />
          <StatCard label="✅ Low" value={data.summary.lowRiskCount} accent="green" />
          <StatCard label="👥 Groups" value={data.summary.groupCount} />
          <StatCard label="❓ Unknown" value={data.summary.unknownCount} />
        </div>
      )}

      {/* Dry-run warning */}
      {data?.summary && !data.summary.dryRun && data.summary.highRiskCount > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800 font-semibold text-sm">
          ⚠️ CẢNH BÁO: Live mode đang BẬT với {data.summary.highRiskCount} thread ở mức rủi ro CAO!
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800 text-sm">
          ❌ {error}
        </div>
      )}

      {/* Thread table */}
      {data?.threads && data.threads.length > 0 ? (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <TH>Thread ID</TH>
                  <TH>Type</TH>
                  <TH>Name</TH>
                  <TH>Risk</TH>
                  <TH>Auto-reply</TH>
                  <TH>Mention req.</TH>
                  <TH>Image</TH>
                  <TH>24h In</TH>
                  <TH>24h Out</TH>
                  <TH>Details</TH>
                </tr>
              </thead>
              <tbody>
                {data.threads.map((t) => (
                  <tr key={t.threadId} className="border-b hover:bg-slate-50">
                    <td className="p-3 font-mono text-xs">{t.threadId}</td>
                    <td className="p-3">
                      <TypeBadge type={t.threadType} />
                    </td>
                    <td className="p-3 max-w-[160px] truncate" title={t.displayName ?? ""}>
                      {t.displayName ?? <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="p-3">
                      <RiskBadge level={t.riskLevel} />
                    </td>
                    <td className="p-3">
                      {t.autoReplyEnabled ? (
                        <span className="text-green-600 font-medium">✅ On</span>
                      ) : (
                        <span className="text-slate-400">❌ Off</span>
                      )}
                    </td>
                    <td className="p-3">
                      {t.groupMentionRequired ? (
                        <span className="text-blue-600 font-medium">✅ Req</span>
                      ) : (
                        <span className="text-slate-400">— No</span>
                      )}
                    </td>
                    <td className="p-3">
                      {t.allowImageUnderstanding ? (
                        <span className="text-purple-600">🖼️ On</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="p-3 text-center">{t.inbound24h}</td>
                    <td className="p-3 text-center">{t.outbound24h}</td>
                    <td className="p-3">
                      {t.riskReasons.length > 0 && (
                        <div className="space-y-0.5">
                          {t.riskReasons.map((r, i) => (
                            <div key={i} className="text-xs text-slate-500">
                              • {r}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : !loading ? (
        <div className="rounded-xl border bg-white shadow-sm p-8 text-center">
          <p className="text-slate-400">Không có thread nào trong allowlist.</p>
        </div>
      ) : null}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function TH({ children }: { children: React.ReactNode }) {
  return (
    <th className="p-3 text-left font-semibold text-slate-600 uppercase text-xs tracking-wide">
      {children}
    </th>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "red" | "yellow" | "green";
}) {
  const accentClass: Record<string, string> = {
    red: "border-red-200 bg-red-50",
    yellow: "border-yellow-200 bg-yellow-50",
    green: "border-green-200 bg-green-50",
  };
  return (
    <div
      className={`rounded-lg border p-3 text-center ${accent ? accentClass[accent] : "bg-slate-50 border-slate-200"}`}
    >
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}
