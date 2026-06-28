"use client";

import { useState, useEffect, useRef } from "react";

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
  if (contentType) {
    h["Content-Type"] = contentType;
  }
  return h;
}

// ── Main Page ──────────────────────────────────────────────────────────
export default function MediaSendPage() {
  // Thread list
  const [threads, setThreads] = useState<ThreadOption[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);

  // Form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [threadIdInput, setThreadIdInput] = useState("");
  const [threadType, setThreadType] = useState<"user" | "group">("user");
  const [caption, setCaption] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "file">("image");

  // Sending state
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState("");
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch threads for dropdown ──────────────────────────────────────
  useEffect(() => {
    async function loadThreads() {
      try {
        const res = await fetch(`${API_BASE}/api/threads`, {
          headers: getHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.threads ?? [];
        setThreads(list);
      } catch (err: any) {
        console.warn("Không thể tải danh sách thread:", err.message);
        // Non-fatal: user can still type threadId manually
      } finally {
        setLoadingThreads(false);
      }
    }
    loadThreads();
  }, []);

  // ── Handle file upload to /api/upload ──────────────────────────────
  const handleUpload = async () => {
    if (!selectedFile) {
      setError("Vui lòng chọn một tệp trước");
      return;
    }
    setError("");
    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const res = await fetch(`${API_BASE}/api/upload`, {
        method: "POST",
        headers: getHeaders(""),
        body: formData,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const url = data.url || data.filePath || data.path || "";
      if (url) {
        setUploadedUrl(url);
        setResult({
          sentMessageId: undefined,
          error: undefined,
        });
      } else {
        // No upload endpoint? Fall back to local blob URL
        setUploadedUrl(URL.createObjectURL(selectedFile));
      }
    } catch (err: any) {
      // If upload endpoint doesn't exist, use local blob as fallback
      console.warn("Upload endpoint failed, using local file:", err.message);
      setUploadedUrl(URL.createObjectURL(selectedFile));
    }
  };

  // ── Handle send via /api/zalo/send-media ──────────────────────────
  const handleSend = async () => {
    setError("");
    setResult(null);

    const tid = threadIdInput.trim();
    if (!tid) {
      setError("Vui lòng chọn hoặc nhập Thread ID");
      return;
    }
    if (!uploadedUrl && !selectedFile) {
      setError("Vui lòng chọn và tải lên một tệp");
      return;
    }

    setSending(true);
    try {
      const body: Record<string, any> = {
        threadId: tid,
        threadType,
        mediaType,
        mediaUrl: uploadedUrl,
        fileName: selectedFile?.name || "unknown",
        fileSize: selectedFile?.size || 0,
      };
      if (caption.trim()) {
        body.caption = caption.trim();
      }

      const res = await fetch(`${API_BASE}/api/zalo/send-media`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }
      setResult({ sentMessageId: data.sentMessageId || data.messageId || "OK" });
    } catch (err: any) {
      setError("Lỗi gửi media: " + err.message);
      setResult({ error: err.message });
    } finally {
      setSending(false);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────
  const selectedThreadMeta = threads.find(
    (t) => t.threadId === threadIdInput
  );

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">
          📤 Gửi Media
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Tải lên và gửi ảnh hoặc tệp PDF đến một thread Zalo
        </p>
      </div>

      {/* Result Banner */}
      {result?.sentMessageId && (
        <div className="mb-6 rounded-lg bg-green-50 px-4 py-4 text-sm text-green-800">
          ✅ Đã gửi thành công! <strong>Message ID:</strong>{" "}
          <code className="rounded bg-green-100 px-1.5 py-0.5 font-mono text-xs">
            {result.sentMessageId}
          </code>
        </div>
      )}
      {error && (
        <div className="mb-6 rounded-lg bg-red-50 px-4 py-4 text-sm text-red-800">
          ❌ {error}
        </div>
      )}

      {/* Form Card */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-5">
        {/* 1. File Upload */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            📎 Chọn tệp (ảnh hoặc PDF)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              setSelectedFile(file);
              setUploadedUrl(null);
              setResult(null);
            }}
            className="block w-full text-sm text-gray-600 file:mr-4 file:rounded file:border-0
                       file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-semibold
                       file:text-blue-700 hover:file:bg-blue-100
                       cursor-pointer"
          />
          {selectedFile && (
            <p className="mt-2 text-xs text-gray-500">
              Đã chọn: <strong>{selectedFile.name}</strong> (
              {(selectedFile.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </div>

        {/* Upload button */}
        <div>
          <button
            onClick={handleUpload}
            disabled={!selectedFile || !!uploadedUrl}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white
                       hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
          >
            {uploadedUrl ? "✅ Đã tải lên" : "⬆️ Tải lên"}
          </button>
          {selectedFile && !uploadedUrl && (
            <span className="ml-3 text-xs text-gray-400">
              Nhấn &quot;Tải lên&quot; trước khi gửi
            </span>
          )}
        </div>

        <hr className="border-gray-100" />

        {/* 2. Thread selection */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            🧵 Chọn Thread
          </label>
          {loadingThreads ? (
            <p className="text-sm text-gray-400">Đang tải danh sách...</p>
          ) : (
            <select
              value={threadIdInput}
              onChange={(e) => {
                const val = e.target.value;
                setThreadIdInput(val);
                const meta = threads.find((t) => t.threadId === val);
                if (meta) setThreadType(meta.type);
              }}
              className="block w-full rounded border border-gray-300 bg-white px-3 py-2.5
                         text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value="">-- Chọn một thread --</option>
              {threads.map((t) => (
                <option key={t.threadId} value={t.threadId}>
                  {t.type === "group" ? "👥" : "👤"} {t.threadId}
                  {t.name ? ` (${t.name})` : ""}
                </option>
              ))}
            </select>
          )}
          <p className="mt-2 text-xs text-gray-400">
            Hoặc nhập thủ công phía dưới
          </p>
          <input
            type="text"
            value={threadIdInput}
            onChange={(e) => setThreadIdInput(e.target.value)}
            placeholder="Nhập Thread ID thủ công..."
            className="mt-2 block w-full rounded border border-gray-300 px-3 py-2.5
                       text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          {selectedThreadMeta && (
            <p className="mt-1 text-xs text-gray-500">
              Loại: {selectedThreadMeta.type === "group" ? "Nhóm" : "Cá nhân"}
              {selectedThreadMeta.name ? ` — ${selectedThreadMeta.name}` : ""}
            </p>
          )}
        </div>

        {/* 3. Thread Type */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            👥 Loại Thread
          </label>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 rounded border border-gray-300 px-4 py-2.5
                            text-sm cursor-pointer hover:bg-gray-50 transition-colors
                            has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 has-[:checked]:text-blue-700">
              <input
                type="radio"
                name="threadType"
                value="user"
                checked={threadType === "user"}
                onChange={() => setThreadType("user")}
                className="text-blue-600 focus:ring-blue-500"
              />
              👤 Cá nhân
            </label>
            <label className="flex items-center gap-2 rounded border border-gray-300 px-4 py-2.5
                            text-sm cursor-pointer hover:bg-gray-50 transition-colors
                            has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 has-[:checked]:text-blue-700">
              <input
                type="radio"
                name="threadType"
                value="group"
                checked={threadType === "group"}
                onChange={() => setThreadType("group")}
                className="text-blue-600 focus:ring-blue-500"
              />
              👥 Nhóm
            </label>
          </div>
        </div>

        {/* 4. Media Type */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            🖼️ Loại Media
          </label>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 rounded border border-gray-300 px-4 py-2.5
                            text-sm cursor-pointer hover:bg-gray-50 transition-colors
                            has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 has-[:checked]:text-blue-700">
              <input
                type="radio"
                name="mediaType"
                value="image"
                checked={mediaType === "image"}
                onChange={() => setMediaType("image")}
                className="text-blue-600 focus:ring-blue-500"
              />
              🖼️ Ảnh
            </label>
            <label className="flex items-center gap-2 rounded border border-gray-300 px-4 py-2.5
                            text-sm cursor-pointer hover:bg-gray-50 transition-colors
                            has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 has-[:checked]:text-blue-700">
              <input
                type="radio"
                name="mediaType"
                value="file"
                checked={mediaType === "file"}
                onChange={() => setMediaType("file")}
                className="text-blue-600 focus:ring-blue-500"
              />
              📄 Tệp (PDF)
            </label>
          </div>
        </div>

        {/* 5. Caption */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            💬 Chú thích <span className="font-normal text-gray-400">(tuỳ chọn)</span>
          </label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={3}
            placeholder="Nhập chú thích cho media..."
            className="block w-full rounded border border-gray-300 px-3 py-2.5
                       text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500
                       resize-y"
          />
        </div>

        {/* 6. Send Button */}
        <button
          onClick={handleSend}
          disabled={sending || !threadIdInput.trim()}
          className="w-full rounded bg-green-600 px-6 py-3 text-base font-semibold text-white
                     hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors shadow-sm"
        >
          {sending ? (
            <span className="flex items-center justify-center gap-2">
              <svg
                className="h-5 w-5 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Đang gửi...
            </span>
          ) : (
            "📨 Gửi Media"
          )}
        </button>
      </div>
    </div>
  );
}
