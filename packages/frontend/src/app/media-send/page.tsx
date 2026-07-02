"use client";

import { useState, useEffect, useRef } from "react";
import {
  Card,
  PageHeader,
  ErrorBanner,
  DarkButton,
  DarkInput,
  DarkSelect,
  DarkTextarea,
  StatusPill,
} from "../../components/ui/dark";

// ── Types ──────────────────────────────────────────────────────────────
interface ThreadOption {
  threadId: string;
  type: "user" | "group";
  name?: string;
}

interface SendResult {
  sentMessageId?: string;
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

function getHeaders(contentType = "application/json"): Record<string, string> {
  const ADMIN_PASS =
    typeof window !== "undefined"
      ? localStorage.getItem("admin_pass") || ""
      : "";
  const h: Record<string, string> = {
    Authorization: "Basic " + btoa("admin:" + ADMIN_PASS),
  };
  if (contentType) h["Content-Type"] = contentType;
  return h;
}

// ── Main Page ──────────────────────────────────────────────────────────
export default function MediaSendPage() {
  const [threads, setThreads] = useState<ThreadOption[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [threadIdInput, setThreadIdInput] = useState("");
  const [threadType, setThreadType] = useState<"user" | "group">("user");
  const [caption, setCaption] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "file">("image");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState("");
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadThreads() {
      try {
        const res = await fetch(`${API_BASE}/api/threads`, { headers: getHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.threads ?? [];
        setThreads(list);
      } catch (err: unknown) {
        console.warn("Không thể tải danh sách thread:", err instanceof Error ? err.message : err);
      } finally {
        setLoadingThreads(false);
      }
    }
    loadThreads();
  }, []);

  const handleUpload = async () => {
    if (!selectedFile) { setError("Vui lòng chọn một tệp trước"); return; }
    setError("");
    const formData = new FormData();
    formData.append("file", selectedFile);
    try {
      const res = await fetch(`${API_BASE}/api/upload`, {
        method: "POST",
        headers: getHeaders(""),
        body: formData,
      });
      if (!res.ok) { const text = await res.text(); throw new Error(text || `HTTP ${res.status}`); }
      const data = await res.json();
      const url = data.url || data.filePath || data.path || "";
      if (url) { setUploadedUrl(url); setResult({ sentMessageId: undefined, error: undefined }); }
      else { setUploadedUrl(URL.createObjectURL(selectedFile)); }
    } catch (err: unknown) {
      console.warn("Upload endpoint failed, using local file:", err instanceof Error ? err.message : err);
      setUploadedUrl(URL.createObjectURL(selectedFile));
    }
  };

  const handleSend = async () => {
    setError(""); setResult(null);
    const tid = threadIdInput.trim();
    if (!tid) { setError("Vui lòng chọn hoặc nhập Thread ID"); return; }
    if (!uploadedUrl && !selectedFile) { setError("Vui lòng chọn và tải lên một tệp"); return; }
    setSending(true);
    try {
      const body: Record<string, unknown> = {
        threadId: tid, threadType, mediaType,
        mediaUrl: uploadedUrl, fileName: selectedFile?.name || "unknown",
        fileSize: selectedFile?.size || 0,
      };
      if (caption.trim()) body.caption = caption.trim();
      const res = await fetch(`${API_BASE}/api/zalo/send-media`, {
        method: "POST", headers: getHeaders(), body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      setResult({ sentMessageId: data.sentMessageId || data.messageId || "OK" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError("Lỗi gửi media: " + msg);
      setResult({ error: msg });
    } finally { setSending(false); }
  };

  const selectedThreadMeta = threads.find(t => t.threadId === threadIdInput);

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="📤 Gửi Media"
        subtitle="Tải lên và gửi ảnh hoặc tệp PDF đến một thread Zalo"
      />

      {result?.sentMessageId && (
        <div className="mb-4 rounded-xl border border-green-700/60 bg-green-900/20 px-4 py-3 text-sm text-green-300">
          ✅ Đã gửi thành công! <strong>Message ID:</strong>{" "}
          <code className="rounded bg-green-900/40 px-1.5 py-0.5 font-mono text-xs text-green-400">
            {result.sentMessageId}
          </code>
        </div>
      )}
      {error && <ErrorBanner message={error} />}

      <Card className="space-y-5">
        {/* 1. File Upload */}
        <div>
          <label className="block text-sm font-semibold text-slate-200 mb-2">📎 Chọn tệp (ảnh hoặc PDF)</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              setSelectedFile(file); setUploadedUrl(null); setResult(null);
            }}
            className="block w-full text-sm text-slate-400
                       file:mr-4 file:rounded-lg file:border-0 file:cursor-pointer
                       file:bg-slate-700 file:px-4 file:py-2 file:text-sm file:font-medium
                       file:text-slate-200 hover:file:bg-slate-600
                       cursor-pointer"
          />
          {selectedFile && (
            <p className="mt-2 text-xs text-slate-500">
              Đã chọn: <strong className="text-slate-300">{selectedFile.name}</strong>{" "}
              ({(selectedFile.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </div>

        {/* Upload button */}
        <div className="flex items-center gap-3">
          <DarkButton variant="primary" size="md" onClick={handleUpload} disabled={!selectedFile || !!uploadedUrl}>
            {uploadedUrl ? "✅ Đã tải lên" : "⬆️ Tải lên"}
          </DarkButton>
          {selectedFile && !uploadedUrl && (
            <span className="text-xs text-slate-500">Nhấn &quot;Tải lên&quot; trước khi gửi</span>
          )}
          {uploadedUrl && <StatusPill variant="ready">Sẵn sàng</StatusPill>}
        </div>

        <div className="border-t border-slate-700/60" />

        {/* 2. Thread selection */}
        <div>
          <label className="block text-sm font-semibold text-slate-200 mb-2">🧵 Chọn Thread</label>
          {loadingThreads ? (
            <p className="text-sm text-slate-500">Đang tải danh sách...</p>
          ) : (
            <DarkSelect
              value={threadIdInput}
              onChange={(e) => {
                const val = e.target.value;
                setThreadIdInput(val);
                const meta = threads.find(t => t.threadId === val);
                if (meta) setThreadType(meta.type);
              }}
            >
              <option value="">-- Chọn một thread --</option>
              {threads.map((t) => (
                <option key={t.threadId} value={t.threadId}>
                  {t.type === "group" ? "👥" : "👤"} {t.threadId}
                  {t.name ? ` (${t.name})` : ""}
                </option>
              ))}
            </DarkSelect>
          )}
          <p className="mt-2 text-xs text-slate-600">Hoặc nhập thủ công:</p>
          <DarkInput
            className="mt-1 font-mono"
            value={threadIdInput}
            onChange={(e) => setThreadIdInput(e.target.value)}
            placeholder="Nhập Thread ID thủ công..."
          />
          {selectedThreadMeta && (
            <p className="mt-1 text-xs text-slate-500">
              Loại: {selectedThreadMeta.type === "group" ? "Nhóm" : "Cá nhân"}
              {selectedThreadMeta.name ? ` — ${selectedThreadMeta.name}` : ""}
            </p>
          )}
        </div>

        {/* 3. Thread Type */}
        <div>
          <label className="block text-sm font-semibold text-slate-200 mb-2">👥 Loại Thread</label>
          <div className="flex gap-3">
            {(["user", "group"] as const).map((val) => (
              <label
                key={val}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                  threadType === val
                    ? "border-blue-500 bg-blue-900/30 text-blue-300"
                    : "border-slate-700 bg-slate-800/60 text-slate-400 hover:border-slate-600"
                }`}
              >
                <input
                  type="radio" name="threadType" value={val}
                  checked={threadType === val}
                  onChange={() => setThreadType(val)}
                  className="accent-blue-500"
                />
                {val === "user" ? "👤 Cá nhân" : "👥 Nhóm"}
              </label>
            ))}
          </div>
        </div>

        {/* 4. Media Type */}
        <div>
          <label className="block text-sm font-semibold text-slate-200 mb-2">🖼️ Loại Media</label>
          <div className="flex gap-3">
            {(["image", "file"] as const).map((val) => (
              <label
                key={val}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                  mediaType === val
                    ? "border-blue-500 bg-blue-900/30 text-blue-300"
                    : "border-slate-700 bg-slate-800/60 text-slate-400 hover:border-slate-600"
                }`}
              >
                <input
                  type="radio" name="mediaType" value={val}
                  checked={mediaType === val}
                  onChange={() => setMediaType(val)}
                  className="accent-blue-500"
                />
                {val === "image" ? "🖼️ Ảnh" : "📄 Tệp (PDF)"}
              </label>
            ))}
          </div>
        </div>

        {/* 5. Caption */}
        <div>
          <label className="block text-sm font-semibold text-slate-200 mb-2">
            💬 Chú thích <span className="font-normal text-slate-500">(tuỳ chọn)</span>
          </label>
          <DarkTextarea
            rows={3}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Nhập chú thích cho media..."
          />
        </div>

        {/* 6. Send Button */}
        <DarkButton
          variant="success"
          size="lg"
          className="w-full justify-center text-base font-semibold"
          onClick={handleSend}
          disabled={sending || !threadIdInput.trim()}
        >
          {sending ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Đang gửi...
            </span>
          ) : "📨 Gửi Media"}
        </DarkButton>
      </Card>
    </div>
  );
}
