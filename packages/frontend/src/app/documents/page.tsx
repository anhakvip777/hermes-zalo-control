"use client";

import { useState, useEffect, useCallback } from "react";
import {
  listDocuments,
  ingestDocument,
  getDocument,
  getDocumentMarkdown,
  getDocumentChunks,
  askDocument,
  reingestDocument,
  deleteDocument,
  type DocumentOutput,
  type DocumentChunkOutput,
  type AskResult,
} from "../../lib/api-client";

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentOutput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ingest form
  const [ingestPath, setIngestPath] = useState("/tmp/hermes-media/documents/");
  const [ingesting, setIngesting] = useState(false);

  // Detail view
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [chunks, setChunks] = useState<DocumentChunkOutput[]>([]);
  const [jobs, setJobs] = useState<{ id: string; status: string; errorCode?: string | null }[]>([]);

  // Ask panel
  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [asking, setAsking] = useState(false);

  // Action states
  const [actioning, setActioning] = useState<string | null>(null);

  const fetchDocs = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listDocuments();
      setDocs(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  // ── Ingest ──────────────────────────────────────────────────
  const handleIngest = async () => {
    if (!ingestPath.trim()) return;
    setIngesting(true);
    setError(null);
    try {
      await ingestDocument({ path: ingestPath.trim(), source: "manual" });
      setIngestPath("");
      fetchDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setIngesting(false);
    }
  };

  // ── View detail ─────────────────────────────────────────────
  const viewDetail = async (docId: string) => {
    if (selectedDoc === docId) {
      setSelectedDoc(null);
      setMarkdown(null);
      setChunks([]);
      setJobs([]);
      setAskResult(null);
      return;
    }
    setSelectedDoc(docId);
    setAskResult(null);
    try {
      const [mdRes, chRes, docRes] = await Promise.all([
        getDocumentMarkdown(docId).catch(() => ({ data: null })),
        getDocumentChunks(docId).catch(() => ({ data: [] })),
        getDocument(docId).catch(() => ({ data: null })),
      ]);
      setMarkdown(mdRes.data ?? null);
      setChunks(chRes.data ?? []);

      // Fetch jobs
      if (docRes.data) {
        fetchJobs(docId);
      }
    } catch {
      setMarkdown(null);
      setChunks([]);
      setJobs([]);
    }
  };

  const fetchJobs = async (docId: string) => {
    try {
      const res = await fetch(`/api/documents/${docId}/jobs`);
      const json = await res.json();
      setJobs(json.data ?? []);
    } catch {
      setJobs([]);
    }
  };

  // ── Re-ingest ───────────────────────────────────────────────
  const handleReingest = async (docId: string) => {
    if (!confirm("Re-ingest tài liệu này? Job mới sẽ được tạo mà không xóa dữ liệu cũ.")) return;
    setActioning(docId);
    try {
      await reingestDocument(docId);
      fetchDocs();
      if (selectedDoc === docId) fetchJobs(docId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-ingest failed");
    } finally {
      setActioning(null);
    }
  };

  // ── Delete ──────────────────────────────────────────────────
  const handleDelete = async (docId: string) => {
    if (!confirm("Xóa tài liệu này? Tất cả chunks và jobs sẽ bị xóa vĩnh viễn.")) return;
    setActioning(docId);
    try {
      await deleteDocument(docId);
      if (selectedDoc === docId) setSelectedDoc(null);
      fetchDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setActioning(null);
    }
  };

  // ── Ask ─────────────────────────────────────────────────────
  const handleAsk = async () => {
    if (!selectedDoc || !question.trim()) return;
    setAsking(true);
    setAskResult(null);
    try {
      const res = await askDocument(selectedDoc, question.trim());
      setAskResult(res.data);
    } catch (err) {
      setAskResult({
        question: question,
        answer: `Lỗi: ${err instanceof Error ? err.message : "Unknown"}`,
        chunksUsed: 0,
        provider: "error",
      });
    } finally {
      setAsking(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1048576).toFixed(1)}MB`;
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "completed": return "text-green-600 bg-green-50";
      case "processing": return "text-blue-600 bg-blue-50";
      case "failed": return "text-red-600 bg-red-50";
      case "queued": return "text-yellow-600 bg-yellow-50";
      default: return "text-gray-500 bg-gray-100";
    }
  };

  type ErrorLevel = "critical" | "medium";
  const classifyError = (errorCode: string | null): { level: ErrorLevel; label: string } => {
    if (!errorCode) return { level: "medium", label: "Unknown error" };
    const CRITICAL_CODES = [
      "DOCLING_TIMEOUT", "DOCLING_SPAWN_ERROR", "DOCLING_POSTPROCESS_FAILED",
      "DOCUMENT_NOT_FOUND",
    ];
    if (CRITICAL_CODES.includes(errorCode)) {
      return { level: "critical", label: "⚡ System error" };
    }
    if (errorCode === "DOCLING_FAILED") {
      return { level: "medium", label: "📄 Conversion failed" };
    }
    if (errorCode === "DOCLING_NO_OUTPUT") {
      return { level: "medium", label: "📄 No extractable text" };
    }
    if (errorCode === "PROCESSING_FAILED") {
      return { level: "medium", label: "⚠️ Processing error" };
    }
    return { level: "medium", label: "⚠️ Other" };
  };

  const fileIcon = (ext: string) => {
    switch (ext.toLowerCase()) {
      case "pdf": return "📕";
      case "docx": return "📘";
      case "pptx": return "📊";
      case "xlsx": return "📈";
      case "txt": return "📄";
      case "md": return "📝";
      case "csv": return "📊";
      default: return "📎";
    }
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">📄 Documents</h1>
          <p className="text-gray-600 mt-1">
            Docling — đọc PDF, DOCX, PPTX, XLSX, TXT, MD, CSV
          </p>
        </div>
        <button
          onClick={fetchDocs}
          className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
        >
          🔄 Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* ── Ingest Panel ──────────────────────────────────────── */}
      <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
        <h2 className="font-semibold mb-3">📥 Ingest Document</h2>
        <div className="flex gap-3">
          <input
            className="flex-1 border rounded px-3 py-2 text-sm font-mono"
            placeholder="File path: /tmp/hermes-media/documents/test.pdf"
            value={ingestPath}
            onChange={(e) => setIngestPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleIngest()}
          />
          <button
            onClick={handleIngest}
            disabled={ingesting || !ingestPath.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
          >
            {ingesting ? "Processing..." : "Ingest"}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Safe dir: /tmp/hermes-media/documents/ — chỉ chấp nhận file trong thư mục này
        </p>
      </div>

      {/* ── Documents Table ────────────────────────────────────── */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : docs.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No documents yet. Ingest one above.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-3 font-medium">File</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Chunks</th>
                <th className="p-3 font-medium">Size</th>
                <th className="p-3 font-medium">Date</th>
                <th className="p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr
                  key={doc.id}
                  className="border-t hover:bg-gray-50 cursor-pointer"
                  onClick={() => viewDetail(doc.id)}
                >
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{fileIcon(doc.extension)}</span>
                      <div>
                        <span className="font-medium block">{doc.fileName}</span>
                        <span className="text-xs text-gray-400">.{doc.extension} · {doc.provider}</span>
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(doc.status)}`}>
                      {doc.status}
                    </span>
                    {doc.status === "failed" && doc.errorCode && (
                      <div className="mt-1 flex flex-col gap-0.5">
                        <span className={`text-[10px] font-medium ${classifyError(doc.errorCode).level === "critical" ? "text-red-700" : "text-orange-600"}`}>
                          {classifyError(doc.errorCode).label}
                        </span>
                        <code className="text-[10px] text-gray-400">{doc.errorCode}</code>
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-sm text-gray-600">
                    {doc.status === "completed" ? (
                      <span
                        className="text-blue-600 underline cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); viewDetail(doc.id); }}
                      >
                        View chunks →
                      </span>
                    ) : doc.status === "processing" || doc.status === "queued" ? (
                      "⏳"
                    ) : "—"}
                  </td>
                  <td className="p-3 text-xs text-gray-500">{formatBytes(doc.sizeBytes)}</td>
                  <td className="p-3 text-xs text-gray-500">
                    {new Date(doc.createdAt).toLocaleString("vi-VN")}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      {doc.status === "failed" && (
                        <button
                          onClick={() => handleReingest(doc.id)}
                          disabled={actioning === doc.id}
                          className="px-2 py-1 text-xs bg-amber-100 text-amber-700 rounded hover:bg-amber-200 disabled:opacity-50"
                        >
                          {actioning === doc.id ? "..." : "🔄 Re-ingest"}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(doc.id)}
                        disabled={actioning === doc.id}
                        className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100 disabled:opacity-50"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Detail Panel ───────────────────────────────────────── */}
      {selectedDoc && (
        <div className="p-4 bg-white border rounded-lg space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold">📋 Document Detail</h2>
            <div className="flex gap-2">
              <button
                onClick={() => handleReingest(selectedDoc)}
                disabled={actioning === selectedDoc}
                className="px-3 py-1 text-sm bg-amber-100 text-amber-700 rounded hover:bg-amber-200 disabled:opacity-50"
              >
                {actioning === selectedDoc ? "..." : "🔄 Re-ingest"}
              </button>
              <button
                onClick={() => handleDelete(selectedDoc)}
                disabled={actioning === selectedDoc}
                className="px-3 py-1 text-sm bg-red-50 text-red-600 rounded hover:bg-red-100 disabled:opacity-50"
              >
                🗑️ Delete
              </button>
            </div>
          </div>

          {/* Error info for failed docs */}
          {(() => {
            const selected = docs.find(d => d.id === selectedDoc);
            if (!selected || selected.status !== "failed") return null;
            const cls = classifyError(selected.errorCode);
            return (
              <div className={`p-3 rounded border text-sm ${cls.level === "critical" ? "bg-red-50 border-red-300 text-red-800" : "bg-orange-50 border-orange-300 text-orange-800"}`}>
                <div className="font-medium">{cls.label}</div>
                {selected.errorCode && <code className="text-xs block mt-1">{selected.errorCode}</code>}
                {selected.errorMessage && <div className="text-xs mt-1 opacity-80">{selected.errorMessage}</div>}
              </div>
            );
          })()}

          {/* File info */}
          {(() => {
            const selected = docs.find(d => d.id === selectedDoc);
            if (!selected) return null;
            return (
              <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
                <div><span className="font-medium">File:</span> {fileIcon(selected.extension)} {selected.fileName}</div>
                <div><span className="font-medium">Size:</span> {formatBytes(selected.sizeBytes)}</div>
                <div><span className="font-medium">Type:</span> {selected.mimeType ?? "." + selected.extension}</div>
                <div><span className="font-medium">Provider:</span> {selected.provider}</div>
                <div><span className="font-medium">Source:</span> {selected.source ?? "manual"}</div>
                <div><span className="font-medium">Created:</span> {new Date(selected.createdAt).toLocaleString("vi-VN")}</div>
              </div>
            );
          })()}

          {/* Ingestion Jobs */}
          {jobs.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">🔄 Ingestion Jobs ({jobs.length})</h3>
              <div className="space-y-1">
                {jobs.map((j) => (
                  <div key={j.id} className="flex items-center gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded font-medium ${statusColor(j.status)}`}>{j.status}</span>
                    <code className="text-gray-400">{j.id.slice(0, 12)}...</code>
                    {j.errorCode && <span className="text-red-500">{j.errorCode}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ask panel */}
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
            <h3 className="text-sm font-medium mb-2">💬 Ask Document</h3>
            <div className="flex gap-2 mb-2">
              <input
                className="flex-1 border rounded px-3 py-2 text-sm"
                placeholder="Hỏi về nội dung tài liệu..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAsk()}
              />
              <button
                onClick={handleAsk}
                disabled={asking || !question.trim()}
                className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium disabled:opacity-50"
              >
                {asking ? "..." : "Ask"}
              </button>
            </div>
            {askResult && (
              <div className="p-2 bg-white rounded border text-sm">
                <div className="text-xs text-gray-500 mb-1">
                  Dùng {askResult.chunksUsed} chunks · {askResult.provider}
                </div>
                <div className="whitespace-pre-wrap">{askResult.answer}</div>
              </div>
            )}
          </div>

          {/* Chunks count */}
          <div className="text-sm text-gray-600">
            {chunks.length} chunks · {markdown ? `${markdown.length} chars` : "no markdown"}
          </div>

          {/* Markdown preview */}
          {markdown && (
            <div>
              <h3 className="text-sm font-medium mb-2">Markdown Preview</h3>
              <pre className="max-h-60 overflow-y-auto p-3 bg-gray-50 rounded border text-xs whitespace-pre-wrap">
                {markdown.slice(0, 2000)}
                {markdown.length > 2000 && "\n... (truncated)"}
              </pre>
            </div>
          )}

          {/* Chunks list */}
          {chunks.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">Chunks ({chunks.length})</h3>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {chunks.slice(0, 10).map((c) => (
                  <div key={c.id} className="p-2 bg-gray-50 rounded border text-xs">
                    <span className="font-mono text-gray-400">#{c.chunkIndex}</span>
                    {c.heading && <span className="font-medium ml-2">{c.heading}</span>}
                    <span className="text-gray-500 ml-2">({c.tokenEstimate ?? "?"} tokens)</span>
                    <div className="text-gray-600 mt-1">{c.text.slice(0, 150)}...</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
