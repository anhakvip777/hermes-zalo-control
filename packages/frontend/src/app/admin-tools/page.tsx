"use client";

import { useEffect, useState } from "react";
import {
  getConfigCheck,
  getHealthDetail,
  getAdminSettings,
  type ConfigCheckResponse,
  type HealthDetailResponse,
} from "../../lib/api-client";
import { useToast } from "../../components/toast";
import {
  Card,
  PageHeader,
  LoadingSpinner,
  DarkButton,
  Kv,
  SeverityPill,
  CodeBlock,
  StatusPill,
} from "../../components/ui/dark";

export default function AdminToolsPage() {
  const [config, setConfig] = useState<ConfigCheckResponse | null>(null);
  const [health, setHealth] = useState<HealthDetailResponse | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchAll = () => {
    setLoading(true);
    Promise.all([
      getConfigCheck().catch(() => null),
      getHealthDetail().catch(() => null),
      getAdminSettings().catch(() => null),
    ])
      .then(([c, h, s]) => { setConfig(c); setHealth(h); setSettings(s); })
      .catch(() => toast("Failed to load tools data", "error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAll(); }, []);

  if (loading && !config) return <LoadingSpinner />;

  const statusVariant =
    config?.status === "CONFIG_OK" ? "ready" :
    config?.status === "CONFIG_WARN" ? "warn" : "failed";

  return (
    <div className="space-y-6">
      <PageHeader
        title="🔧 Admin Tools"
        subtitle="Công cụ vận hành — kiểm tra, bảo trì, audit"
        onRefresh={fetchAll}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Config check */}
        <Card>
          <h2 className="text-lg font-semibold text-slate-100 mb-3">🔍 Config Consistency Check</h2>
          {config && (
            <>
              <div className="mb-3">
                <StatusPill variant={statusVariant as "ready" | "warn" | "failed"}>{config.status}</StatusPill>
              </div>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {config.checks.map((c, i) => (
                  <div key={i} className={`text-xs p-3 rounded-lg border ${
                    c.severity === "ERROR" ? "bg-red-900/20 border-red-700/50" :
                    c.severity === "WARN" ? "bg-yellow-900/20 border-yellow-700/50" :
                    "bg-green-900/20 border-green-700/50"
                  }`}>
                    <div className="flex items-center gap-2 font-semibold">
                      <SeverityPill severity={c.severity} />
                      <span className="text-slate-200">{c.name}</span>
                    </div>
                    <div className="text-slate-400 mt-1">{c.message}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* DB Status */}
        <Card>
          <h2 className="text-lg font-semibold text-slate-100 mb-3">🗄️ Database Status</h2>
          {health && (
            <div className="space-y-2">
              <div className={`px-3 py-2 rounded-lg border text-sm ${health.db.ok ? "border-green-700/50 bg-green-900/20 text-green-300" : "border-red-700/50 bg-red-900/20 text-red-300"}`}>
                <span className="font-semibold">Status:</span> {health.db.ok ? "✅ OK" : "❌ Error"}
              </div>
              <Kv label="Path" value={health.db.path} mono />
              <Kv label="Size" value={`${(health.db.sizeBytes / 1024 / 1024).toFixed(2)} MB`} />
              <div className="mt-3">
                <p className="text-xs font-semibold text-slate-500 mb-1">Critical Tables:</p>
                {health.db.criticalTables && Object.entries(health.db.criticalTables).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs py-1 border-b border-slate-700/50">
                    <span className="text-slate-400">{k}</span>
                    <span className={`font-mono ${v === null ? "text-red-400" : "text-slate-300"}`}>
                      {v === null ? "MISSING" : `${v} rows`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Process Lock */}
        <Card>
          <h2 className="text-lg font-semibold text-slate-100 mb-3">🔒 Process Lock</h2>
          {health?.processLock && (
            <div className="space-y-1.5">
              <Kv label="Locked" value={health.processLock.locked ? "🔒 Yes" : "🔓 No"} />
              <Kv label="Owner PID" value={health.processLock.ownerPid ?? "—"} />
              <Kv label="This Process" value={health.processLock.isOwner ? "✅ Owner" : "❌ Not owner"} />
              <Kv label="Started" value={fmtTime(health.processLock.startedAt)} />
            </div>
          )}
        </Card>

        {/* App Settings */}
        <Card>
          <h2 className="text-lg font-semibold text-slate-100 mb-3">⚙️ App Settings</h2>
          {settings ? (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {Object.entries(settings).map(([k, v]) => (
                <Kv key={k} label={k} value={String(v ?? "—")} mono />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Không tải được settings.</p>
          )}
        </Card>

        {/* Backup info */}
        <Card>
          <h2 className="text-lg font-semibold text-slate-100 mb-3">💾 Backup</h2>
          {health && (
            <div className="space-y-1.5">
              <Kv label="Total backups" value={health.backup.backupCount} />
              <Kv label="Latest" value={health.backup.latestBackupName ?? "—"} />
              <Kv label="Age" value={health.backup.latestBackupAgeHours != null ? `${health.backup.latestBackupAgeHours}h` : "—"} />
              <Kv label="Last at" value={fmtTime(health.backup.latestBackupAt)} />
            </div>
          )}
          <div className="mt-4">
            <CodeBlock>
              {"npm run backup:create\nnpm run backup:list"}
            </CodeBlock>
          </div>
        </Card>

        {/* Secret audit */}
        <Card>
          <h2 className="text-lg font-semibold text-slate-100 mb-3">🛡️ Secret Audit</h2>
          <CodeBlock>
            {"npm run secret:audit\nnpm run secret:audit:strict"}
          </CodeBlock>
          <p className="text-xs text-slate-500 mt-2">Kiểm tra secrets trong codebase, không leak API key.</p>
        </Card>

        {/* DB guard */}
        <Card>
          <h2 className="text-lg font-semibold text-slate-100 mb-3">🛡️ DB Guard</h2>
          <CodeBlock>npm run db:guard</CodeBlock>
          <p className="text-xs text-slate-500 mt-2">Ngăn chặn reset DB vô tình trước khi push schema.</p>
        </Card>
      </div>
    </div>
  );
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN");
}
