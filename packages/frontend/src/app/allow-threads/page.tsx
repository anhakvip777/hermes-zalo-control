"use client";

// =============================================================================
// AllowThreads — discover real Zalo friends/groups and manage the auto-reply
// allowlist.
//
// Lifecycle design (fixes "first Friends load shows empty until you switch tabs"):
//   - Per-tab isolated state {items, loading, failure, loaded, loadedQuery} so
//     one tab's response can never overwrite another's.
//   - Default tab (Friends) fetches immediately on mount.
//   - Tab switch: show cache if already loaded for the current query, else fetch.
//   - Search: debounced (400ms) refetch of the CURRENT tab; the initial mount
//     fire is skipped so it never races/blocks the initial tab fetch.
//   - Per-tab request sequence guard: a stale (superseded) response is dropped.
//   - Empty state is shown ONLY when loaded && !loading && !failure && items=0.
//     Before the first successful load we show the loading skeleton, never empty.
//   - No polling → does not worsen the 429 issue.
// =============================================================================

import { useEffect, useState, useCallback, useRef } from "react";
import {
  discoverThreads,
  updateThreadAllow,
  type DiscoverThreadItem,
} from "../../lib/api-client";
import { ApiError } from "../../lib/api";
import { useToast } from "../../components/toast";

type Tab = "friends" | "groups" | "allowed";
type FailKind = "auth" | "rate" | "disconnected" | "generic";
interface Failure { kind: FailKind; message: string; }

interface TabState {
  items: DiscoverThreadItem[];
  loading: boolean;
  failure: Failure | null;
  loaded: boolean;
  loadedQuery: string;
}

const initialTabState: TabState = { items: [], loading: false, failure: null, loaded: false, loadedQuery: "" };

function typeForTab(t: Tab): "user" | "group" | "all" {
  return t === "groups" ? "group" : t === "friends" ? "user" : "all";
}

function classifyError(e: unknown): Failure {
  if (e instanceof ApiError) {
    const body = e.body as { error?: { code?: string; message?: string } } | undefined;
    const code = body?.error?.code;
    if (e.status === 401 || e.status === 403) return { kind: "auth", message: "Chưa xác thực admin. Đăng nhập lại dashboard (Basic auth)." };
    if (e.status === 429) return { kind: "rate", message: "Bị rate limit (429). Thử lại sau vài giây." };
    if (e.status === 503 || code === "ZALO_NOT_CONNECTED") return { kind: "disconnected", message: "Zalo chưa kết nối — mở trang Zalo Ops và bấm Reconnect trước." };
    return { kind: "generic", message: body?.error?.message ?? e.message ?? "Không tải được danh sách" };
  }
  return { kind: "generic", message: (e as Error)?.message ?? "Không tải được danh sách" };
}

function TypeBadge({ t }: { t: "user" | "group" }) {
  const cls = t === "group"
    ? "bg-purple-950 text-purple-400 border-purple-800"
    : "bg-blue-950 text-blue-400 border-blue-800";
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border ${cls}`}>{t}</span>;
}

export default function AllowThreadsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("friends");
  const [states, setStates] = useState<Record<Tab, TabState>>({
    friends: { ...initialTabState },
    groups: { ...initialTabState },
    allowed: { ...initialTabState },
  });
  const [search, setSearch] = useState("");

  const seqRef = useRef<Record<Tab, number>>({ friends: 0, groups: 0, allowed: 0 });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchMounted = useRef(false);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const patch = useCallback((t: Tab, p: Partial<TabState>) => {
    setStates((s) => ({ ...s, [t]: { ...s[t], ...p } }));
  }, []);

  const loadTab = useCallback(async (t: Tab, q: string) => {
    const seq = ++seqRef.current[t];
    patch(t, { loading: true, failure: null });
    try {
      const r = await discoverThreads({ type: typeForTab(t), query: q, limit: 200 });
      if (seq !== seqRef.current[t]) return; // superseded
      const list = t === "allowed" ? r.items.filter((i) => i.allowed) : r.items;
      patch(t, { items: list, loading: false, failure: null, loaded: true, loadedQuery: q });
      if (r.warning) toast(`Cảnh báo: ${r.warning.message}`, "error");
    } catch (e: unknown) {
      if (seq !== seqRef.current[t]) return;
      patch(t, { items: [], loading: false, failure: classifyError(e), loaded: true, loadedQuery: q });
    }
  }, [patch, toast]);

  // Fetch on mount + whenever the active tab changes (use cache if fresh for this query).
  useEffect(() => {
    const st = states[tab];
    if (!st.loaded || st.loadedQuery !== search) loadTab(tab, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Debounced search → refetch the current tab. Skip the initial mount fire so it
  // never races with the tab effect's initial fetch.
  useEffect(() => {
    if (!searchMounted.current) { searchMounted.current = true; return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadTab(tab, search), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const st = states[tab];
  const refresh = () => loadTab(tab, search);

  const toggleAllow = async (item: DiscoverThreadItem) => {
    const key = `${item.threadType}:${item.threadId}`;
    const next = !item.allowed;
    const flip = (allowed: boolean) => setStates((s) => ({
      ...s,
      [tab]: { ...s[tab], items: s[tab].items.map((i) => (i.threadId === item.threadId && i.threadType === item.threadType ? { ...i, allowed } : i)) },
    }));
    flip(next); // optimistic
    setPending((p) => new Set(p).add(key));
    try {
      await updateThreadAllow([{ threadId: item.threadId, threadType: item.threadType, allowed: next }]);
      toast(next ? "Đã cấp quyền thread" : "Đã bỏ quyền thread", "success");
      // Keep the "allowed" tab in sync if it was loaded.
      setStates((s) => ({ ...s, allowed: { ...s.allowed, loaded: false } }));
      if (tab === "allowed" && !next) {
        setStates((s) => ({ ...s, allowed: { ...s.allowed, items: s.allowed.items.filter((i) => !(i.threadId === item.threadId && i.threadType === item.threadType)) } }));
      }
    } catch (e: unknown) {
      flip(!next); // rollback
      toast(`Cập nhật thất bại: ${classifyError(e).message}`, "error");
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(key); return n; });
    }
  };

  const copyId = (id: string) => {
    navigator.clipboard?.writeText(id).then(() => toast("Đã copy Thread ID", "success")).catch(() => toast("Không copy được", "error"));
  };

  const tabBtn = (t: Tab, label: string) =>
    <button onClick={() => setTab(t)} className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${tab === t ? "bg-blue-500/10 text-blue-400 border-blue-700" : "text-slate-400 border-slate-700 hover:bg-slate-800"}`}>{label}</button>;

  const showSkeleton = (!st.loaded || st.loading) && st.items.length === 0 && !st.failure;
  const showEmpty = st.loaded && !st.loading && !st.failure && st.items.length === 0;

  return (
    <div className="space-y-5 max-w-[1200px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Allow Threads</h1>
          <p className="text-xs text-slate-500 mt-0.5">Cấp quyền auto-reply cho từng bạn bè / nhóm Zalo</p>
        </div>
        <button onClick={refresh} disabled={st.loading} className="px-3 py-1.5 text-xs border border-slate-700 text-slate-400 rounded-md hover:bg-slate-800 transition-colors disabled:opacity-40">
          {st.loading ? "…" : "🔄 Refresh"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabBtn("friends", "Friends")}
        {tabBtn("groups", "Groups")}
        {tabBtn("allowed", "Allowed")}
        <input
          type="text"
          placeholder="Tìm theo tên / thread ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto min-w-[220px] rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {st.failure ? (
        <div className={`rounded-lg border p-6 text-center ${st.failure.kind === "disconnected" ? "border-amber-800 bg-amber-950/30" : "border-red-800 bg-red-950/40"}`}>
          <p className={`text-sm ${st.failure.kind === "disconnected" ? "text-amber-300" : "text-red-400"}`}>{st.failure.message}</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button onClick={refresh} className="px-3 py-1.5 text-xs border border-slate-700 text-slate-300 rounded-md hover:bg-slate-800">Thử lại</button>
            {st.failure.kind === "disconnected" && (
              <a href="/zalo-ops" className="px-3 py-1.5 text-xs border border-amber-700 text-amber-300 rounded-md hover:bg-amber-950/50">Mở Zalo Ops</a>
            )}
          </div>
        </div>
      ) : showSkeleton ? (
        <div className="space-y-1">
          {[...Array(6)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded-md bg-slate-800 border border-slate-700" />)}
        </div>
      ) : showEmpty ? (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-12 text-center">
          <p className="text-slate-500 text-sm">{tab === "allowed" ? "Chưa có thread nào được cấp quyền" : "Không tìm thấy mục nào"}</p>
          <p className="text-slate-600 text-xs mt-1">{tab === "allowed" ? "Cấp quyền từ tab Friends/Groups." : "Thử Refresh, hoặc kiểm tra Zalo đã kết nối ở Zalo Ops."}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 border-b border-slate-700">
              <tr>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Type</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Name</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Thread ID</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Info</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Allowed</th>
                <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase text-slate-500 tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody>
              {st.items.map((item) => {
                const key = `${item.threadType}:${item.threadId}`;
                const busy = pending.has(key);
                return (
                  <tr key={key} className="border-b border-slate-700/60 hover:bg-slate-700/30 transition-colors">
                    <td className="px-3 py-2.5"><TypeBadge t={item.threadType} /></td>
                    <td className="px-3 py-2.5 max-w-[240px]">
                      <p className="text-xs text-slate-200 truncate" title={item.displayName}>{item.displayName}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <code className="text-[11px] font-mono text-slate-500">{item.threadId.length > 16 ? "…" + item.threadId.slice(-12) : item.threadId}</code>
                        <button onClick={() => copyId(item.threadId)} title="Copy Thread ID" className="text-slate-600 hover:text-slate-300 text-[11px]">⧉</button>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[11px] text-slate-500">{item.subtitle ?? (item.memberCount != null ? `${item.memberCount} members` : "—")}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {item.allowed
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-green-950 text-green-400 border-green-800">ALLOWED</span>
                        : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-slate-800 text-slate-500 border-slate-700">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        disabled={busy}
                        onClick={() => toggleAllow(item)}
                        className={`px-2.5 py-1 text-xs rounded-md border transition-colors disabled:opacity-40 ${item.allowed
                          ? "border-red-800 text-red-400 hover:bg-red-950/40"
                          : "border-green-800 text-green-400 hover:bg-green-950/40"}`}
                      >
                        {busy ? "…" : item.allowed ? "Disallow" : "Allow"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-600">
        Chỉ thread được Allow mới đi tiếp vào pipeline auto-reply (theo config hiện tại). Thay đổi ở đây không gửi tin Zalo và không bật live.
      </p>
    </div>
  );
}
