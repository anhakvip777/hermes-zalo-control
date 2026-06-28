"use client";

import { useEffect, useState } from "react";
import {
  getConfigCheck,
  getHeartbeats,
  getHealthDetail,
  getAdminSettings,
  type ConfigCheckResponse,
  type HealthDetailResponse,
} from "../../lib/api-client";
import { useToast } from "../../components/toast";

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
      .then(([c, h, s]) => {
        setConfig(c);
        setHealth(h);
        setSettings(s);
      })
      .catch(() => toast("Failed to load tools data", "error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAll(); }, []);

  if (loading && !config) {
    return <div className="flex items-center justify-center h-64"><p className="text-slate-400">Đang tải...</p></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">🔧 Admin Tools</h1>
          <p className="text-sm text-slate-500 mt-1">Công cụ vận hành — kiểm tra, bảo trì, audit</p>
        </div>
        <button onClick={fetchAll} className="px-4 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg">🔄 Làm mới</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Config check */}
        <div className="rounded-xl border bg-white shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-3">🔍 Config Consistency Check</h2>
          {config && (
            <>
              <div className={`inline-block px-3 py-1 rounded-full text-xs font-bold mb-3 ${
                config.status === "CONFIG_OK" ? "bg-green-100 text-green-800" :
                config.status === "CONFIG_WARN" ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"
              }`}>{config.status}</div>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {config.checks.map((c, i) => (
                  <div key={i} className={`text-xs p-2 rounded border ${
                    c.severity === "ERROR" ? "border-red-200 bg-red-50" :
                    c.severity === "WARN" ? "border-yellow-200 bg-yellow-50" : "border-green-200 bg-green-50"
                  }`}>
                    <div className="font-semibold">{c.severity}: {c.name}</div>
                    <div className="text-slate-600 mt-0.5">{c.message}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* DB Status */}
        <div className="rounded-xl border bg-white shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-3">🗄️ Database Status</h2>
          {health && (
            <div className="space-y-2 text-sm">
              <div className={`px-3 py-2 rounded border ${health.db.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
                <span className="font-semibold">Status:</span> {health.db.ok ? "✅ OK" : "❌ Error"}
              </div>
              <div className="text-xs text-slate-500">Path: {health.db.path}</div>
              <div className="text-xs text-slate-500">Size: {(health.db.sizeBytes / 1024 / 1024).toFixed(2)} MB</div>
              <div className="mt-3">
                <p className="text-xs font-semibold mb-1">Critical Tables:</p>
                {health.db.criticalTables && Object.entries(health.db.criticalTables).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs py-1 border-b border-slate-100">
                    <span>{k}</span>
                    <span className={`font-mono ${v === null ? "text-red-500" : "text-slate-600"}`}>
                      {v === null ? "MISSING" : `${v} rows`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Process Lock */}
        <div className="rounded-xl border bg-white shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-3">🔒 Process Lock</h2>
          {health?.processLock && (
            <div className="space-y-2 text-sm">
              <Kv label="Locked" value={health.processLock.locked ? "🔒 Yes" : "🔓 No"} />
              <Kv label="Owner PID" value={health.processLock.ownerPid ?? "—"} />
              <Kv label="This Process" value={health.processLock.isOwner ? "✅ Owner" : "❌ Not owner"} />
              <Kv label="Started" value={fmtTime(health.processLock.startedAt)} />
            </div>
          )}
        </div>

        {/* App Settings */}
        <div className="rounded-xl border bg-white shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-3">⚙️ App Settings</h2>
          {settings ? (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {Object.entries(settings).map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs py-1 border-b border-slate-100">
                  <span className="text-slate-500">{k}</span>
                  <span className="font-mono">{String(v ?? "—")}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Không tải được settings.</p>
          )}
        </div>

        {/* Backup info */}
        <div className="rounded-xl border bg-white shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-3">💾 Backup</h2>
          {health && (
            <div className="space-y-2 text-sm">
              <Kv label="Total backups" value={health.backup.backupCount} />
              <Kv label="Latest" value={health.backup.latestBackupName ?? "—"} />
              <Kv label="Age" value={health.backup.latestBackupAgeHours != null ? `${health.backup.latestBackupAgeHours}h` : "—"} />
              <Kv label="Last at" value={fmtTime(health.backup.latestBackupAt)} />
            </div>
          )}
          <div className="mt-4 p-3 rounded bg-slate-50 border text-xs font-mono text-slate-500">
            <p className="font-semibold mb-1">Backup command:</p>
            <code>npm run backup:create</code>
            <br />
            <code>npm run backup:list</code>
          </div>
        </div>

        {/* Secret audit */}
        <div className="rounded-xl border bg-white shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-3">🛡️ Secret Audit</h2>
          <div className="p-3 rounded bg-slate-50 border text-xs font-mono text-slate-500">
            <p className="font-semibold mb-1">Run audit:</p>
            <code>npm run secret:audit</code>
            <br />
            <code>npm run secret:audit:strict</code>
          </div>
          <p className="text-xs text-slate-400 mt-2">Kiểm tra secrets trong codebase, không leak API key.</p>
        </div>

        {/* DB guard */}
        <div className="rounded-xl border bg-white shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-3">🛡️ DB Guard</h2>
          <div className="p-3 rounded bg-slate-50 border text-xs font-mono text-slate-500">
            <code>npm run db:guard</code>
          </div>
          <p className="text-xs text-slate-400 mt-2">Ngăn chặn reset DB vô tình trước khi push schema.</p>
        </div>
      </div>
    </div>
  );
}

function Kv({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-700">{String(value ?? "—")}</span>
    </div>
  );
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN");
}
