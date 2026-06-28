"use client";

import { useState, useEffect, useCallback } from "react";
import {
  listDocuments,
  ingestDocument,
  getDocument,
  getDocumentMarkdown,
  getDocumentChunks,
  askDocument,
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

  // Ask panel
  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [asking, setAsking] = useState(false);

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
      setAskResult(null);
      return;
    }
    setSelectedDoc(docId);
    setAskResult(null);
    try {
      const [mdRes, chRes] = await Promise.all([
        getDocumentMarkdown(docId).catch(() => ({ data: null })),
        getDocumentChunks(docId).catch(() => ({ data: [] })),
      ]);
      setMarkdown(mdRes.data ?? null);
      setChunks(chRes.data ?? []);
    } catch {
      setMarkdown(null);
      setChunks([]);
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
      default: return "text-gray-500 bg-gray-100";
    }
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">📄 Documents</h1>
          <p className="text-gray-600 mt-1">
            Docling — đọc PDF, DOCX, PPTX, XLSX, TXT, MD...
          </p>
        </div>
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
                <th className="p-3 font-medium">Size</th>
                <th className="p-3 font-medium">Preview</th>
                <th className="p-3 font-medium">Date</th>
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
                    <span className="font-medium">{doc.fileName}</span>
                    <span className="text-xs text-gray-400 ml-2">.{doc.extension}</span>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(doc.status)}`}>
                      {doc.status}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-gray-500">{formatBytes(doc.sizeBytes)}</td>
                  <td className="p-3 text-xs text-gray-500 max-w-xs truncate">
                    {doc.textPreview?.slice(0, 80) ?? "—"}
                  </td>
                  <td className="p-3 text-xs text-gray-500">
                    {new Date(doc.createdAt).toLocaleString("vi-VN")}
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
          <h2 className="font-semibold">📋 Document Detail</h2>

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
