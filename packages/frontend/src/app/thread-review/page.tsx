"use client";

import { useEffect, useState } from "react";
import {
  getThreadReview,
  type ThreadReviewResponse,
  type ThreadReviewEntry,
} from "../../lib/api-client";
import { useToast } from "../../components/toast";
import {
  Card,
  PageHeader,
  LoadingSpinner,
  EmptyState,
  ErrorBanner,
  WarnBanner,
  StatusPill,
  StatCard,
  DarkTable,
  DarkThead,
  DarkTh,
  DarkTr,
  DarkTd,
} from "../../components/ui/dark";

function RiskBadge({ level }: { level: ThreadReviewEntry["riskLevel"] }) {
  const v = level === "low" ? "low" : level === "medium" ? "medium" : "high";
  const labels: Record<string, string> = { low: "✅ Thấp", medium: "⚠️ Trung bình", high: "🔴 Cao" };
  return <StatusPill variant={v as "low" | "medium" | "high"}>{labels[level] ?? level}</StatusPill>;
}

function TypeBadge({ type }: { type: ThreadReviewEntry["threadType"] }) {
  const v = type === "user" ? "info" : type === "group" ? "warn" : "inactive";
  const labels = { user: "👤 DM", group: "👥 Group", unknown: "❓ Unknown" };
  return <StatusPill variant={v as "info" | "warn" | "inactive"}>{labels[type] ?? type}</StatusPill>;
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

  if (loading && !data) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="🔍 Allowed Thread Review"
        subtitle="Rà soát độ an toàn của các thread trong allowlist trước khi bật live mode."
        onRefresh={fetchData}
      />

      {data?.summary && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <StatCard label="Tổng thread" value={data.summary.totalThreads} />
          <StatCard label="🔴 High risk" value={data.summary.highRiskCount} accent={data.summary.highRiskCount > 0 ? "red" : undefined} />
          <StatCard label="⚠️ Medium" value={data.summary.mediumRiskCount} accent={data.summary.mediumRiskCount > 0 ? "yellow" : undefined} />
          <StatCard label="✅ Low" value={data.summary.lowRiskCount} accent="green" />
          <StatCard label="👥 Groups" value={data.summary.groupCount} />
          <StatCard label="❓ Unknown" value={data.summary.unknownCount} />
        </div>
      )}

      {data?.summary && !data.summary.dryRun && data.summary.highRiskCount > 0 && (
        <WarnBanner message={`CẢNH BÁO: Live mode đang BẬT với ${data.summary.highRiskCount} thread ở mức rủi ro CAO!`} />
      )}

      {error && <ErrorBanner message={error} />}

      {data?.threads && data.threads.length > 0 ? (
        <DarkTable>
          <DarkThead>
            <DarkTh>Thread ID</DarkTh>
            <DarkTh>Type</DarkTh>
            <DarkTh>Name</DarkTh>
            <DarkTh>Risk</DarkTh>
            <DarkTh>Auto-reply</DarkTh>
            <DarkTh>Mention</DarkTh>
            <DarkTh>Image</DarkTh>
            <DarkTh>24h In</DarkTh>
            <DarkTh>24h Out</DarkTh>
            <DarkTh>Details</DarkTh>
          </DarkThead>
          <tbody>
            {data.threads.map((t) => (
              <DarkTr key={t.threadId}>
                <DarkTd><span className="font-mono text-xs text-slate-400">{t.threadId}</span></DarkTd>
                <DarkTd><TypeBadge type={t.threadType} /></DarkTd>
                <DarkTd><span className="text-slate-300 text-xs truncate max-w-[140px] block" title={t.displayName ?? ""}>{t.displayName ?? <span className="text-slate-600 italic">—</span>}</span></DarkTd>
                <DarkTd><RiskBadge level={t.riskLevel} /></DarkTd>
                <DarkTd>
                  {t.autoReplyEnabled
                    ? <StatusPill variant="active">✅ On</StatusPill>
                    : <StatusPill variant="inactive">❌ Off</StatusPill>}
                </DarkTd>
                <DarkTd>
                  {t.groupMentionRequired
                    ? <StatusPill variant="info">✅ Req</StatusPill>
                    : <span className="text-slate-600 text-xs">— No</span>}
                </DarkTd>
                <DarkTd>
                  {t.allowImageUnderstanding
                    ? <StatusPill variant="info">🖼️ On</StatusPill>
                    : <span className="text-slate-600 text-xs">—</span>}
                </DarkTd>
                <DarkTd className="text-center text-slate-300 text-sm">{t.inbound24h}</DarkTd>
                <DarkTd className="text-center text-slate-300 text-sm">{t.outbound24h}</DarkTd>
                <DarkTd>
                  {t.riskReasons.length > 0 && (
                    <div className="space-y-0.5">
                      {t.riskReasons.map((r, i) => (
                        <div key={i} className="text-xs text-slate-500">• {r}</div>
                      ))}
                    </div>
                  )}
                </DarkTd>
              </DarkTr>
            ))}
          </tbody>
        </DarkTable>
      ) : !loading ? (
        <EmptyState message="Không có thread nào trong allowlist." icon="📋" />
      ) : null}
    </div>
  );
}
