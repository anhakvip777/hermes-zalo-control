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
import {
  Card,
  PageHeader,
  LoadingSpinner,
  EmptyState,
  ErrorBanner,
  DarkButton,
  DarkInput,
  StatusPill,
  DarkTable,
  DarkThead,
  DarkTh,
  DarkTr,
  DarkTd,
  SectionLabel,
  CodeBlock,
  Kv,
} from "../../components/ui/dark";

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

  const viewDetail = async (docId: string) => {
    if (selectedDoc === docId) {
      setSelectedDoc(null); setMarkdown(null); setChunks([]); setJobs([]); setAskResult(null);
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
      if (docRes.data) fetchJobs(docId);
    } catch {
      setMarkdown(null); setChunks([]); setJobs([]);
    }
  };

  const fetchJobs = async (docId: string) => {
    try {
      const res = await fetch(`/api/documents/${docId}/jobs`);
      const json = await res.json();
      setJobs(json.data ?? []);
    } catch { setJobs([]); }
  };

  const handleReingest = async (docId: string) => {
    if (!confirm("Re-ingest tài liệu này? Job mới sẽ được tạo mà không xóa dữ liệu cũ.")) return;
    setActioning(docId);
    try {
      await reingestDocument(docId);
      fetchDocs();
      if (selectedDoc === docId) fetchJobs(docId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-ingest failed");
    } finally { setActioning(null); }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm("Xóa tài liệu này? Tất cả chunks và jobs sẽ bị xóa vĩnh viễn.")) return;
    setActioning(docId);
    try {
      await deleteDocument(docId);
      if (selectedDoc === docId) setSelectedDoc(null);
      fetchDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally { setActioning(null); }
  };

  const handleAsk = async () => {
    if (!selectedDoc || !question.trim()) return;
    setAsking(true); setAskResult(null);
    try {
      const res = await askDocument(selectedDoc, question.trim());
      setAskResult(res.data);
    } catch (err) {
      setAskResult({ question, answer: `Lỗi: ${err instanceof Error ? err.message : "Unknown"}`, chunksUsed: 0, provider: "error" });
    } finally { setAsking(false); }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1048576).toFixed(1)}MB`;
  };

  const docStatusVariant = (status: string) => {
    switch (status) {
      case "completed": return "ready";
      case "processing": return "info";
      case "failed": return "failed";
      case "queued": return "warn";
      default: return "inactive";
    }
  };

  const classifyError = (errorCode: string | null) => {
    if (!errorCode) return { level: "medium" as const, label: "Unknown error" };
    const CRITICAL = ["DOCLING_TIMEOUT", "DOCLING_SPAWN_ERROR", "DOCLING_POSTPROCESS_FAILED", "DOCUMENT_NOT_FOUND"];
    if (CRITICAL.includes(errorCode)) return { level: "critical" as const, label: "⚡ System error" };
    if (errorCode === "DOCLING_FAILED") return { level: "medium" as const, label: "📄 Conversion failed" };
    if (errorCode === "DOCLING_NO_OUTPUT") return { level: "medium" as const, label: "📄 No extractable text" };
    if (errorCode === "PROCESSING_FAILED") return { level: "medium" as const, label: "⚠️ Processing error" };
    return { level: "medium" as const, label: "⚠️ Other" };
  };

  const fileIcon = (ext: string) => {
    switch (ext.toLowerCase()) {
      case "pdf": return "📕"; case "docx": return "📘"; case "pptx": return "📊";
      case "xlsx": return "📈"; case "txt": return "📄"; case "md": return "📝";
      case "csv": return "📊"; default: return "📎";
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="📄 Documents" subtitle="Docling — đọc PDF, DOCX, PPTX, XLSX, TXT, MD, CSV" onRefresh={fetchDocs} />

      {error && <ErrorBanner message={error} />}

      {/* Ingest Panel */}
      <Card>
        <h2 className="font-semibold text-slate-100 mb-3">📥 Ingest Document</h2>
        <div className="flex gap-3">
          <DarkInput
            className="flex-1 font-mono"
            placeholder="File path: /tmp/hermes-media/documents/test.pdf"
            value={ingestPath}
            onChange={(e) => setIngestPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleIngest()}
          />
          <DarkButton variant="primary" size="md" onClick={handleIngest} disabled={ingesting || !ingestPath.trim()}>
            {ingesting ? "Processing..." : "Ingest"}
          </DarkButton>
        </div>
        <p className="text-xs text-slate-600 mt-2">Safe dir: /tmp/hermes-media/documents/ — chỉ chấp nhận file trong thư mục này</p>
      </Card>

      {/* Documents Table */}
      {loading ? (
        <LoadingSpinner />
      ) : docs.length === 0 ? (
        <EmptyState message="Chưa có tài liệu nào. Ingest một file để bắt đầu." icon="📄" />
      ) : (
        <DarkTable>
          <DarkThead>
            <DarkTh>File</DarkTh>
            <DarkTh>Status</DarkTh>
            <DarkTh>Chunks</DarkTh>
            <DarkTh>Size</DarkTh>
            <DarkTh>Date</DarkTh>
            <DarkTh>Actions</DarkTh>
          </DarkThead>
          <tbody>
            {docs.map((doc) => (
              <DarkTr key={doc.id} highlight={selectedDoc === doc.id ? "blue" : undefined}>
                <DarkTd>
                  <button onClick={() => viewDetail(doc.id)} className="flex items-center gap-2 text-left hover:text-blue-400 transition-colors">
                    <span className="text-lg">{fileIcon(doc.extension)}</span>
                    <div>
                      <span className="font-medium text-slate-200 block text-sm">{doc.fileName}</span>
                      <span className="text-xs text-slate-500">.{doc.extension} · {doc.provider}</span>
                    </div>
                  </button>
                </DarkTd>
                <DarkTd>
                  <StatusPill variant={docStatusVariant(doc.status) as "ready" | "info" | "failed" | "warn" | "inactive"}>
                    {doc.status}
                  </StatusPill>
                  {doc.status === "failed" && doc.errorCode && (
                    <div className="mt-1">
                      <span className={`text-[10px] font-medium ${classifyError(doc.errorCode).level === "critical" ? "text-red-400" : "text-orange-400"}`}>
                        {classifyError(doc.errorCode).label}
                      </span>
                      <code className="text-[10px] text-slate-500 block">{doc.errorCode}</code>
                    </div>
                  )}
                </DarkTd>
                <DarkTd>
                  {doc.status === "completed" ? (
                    <button onClick={() => viewDetail(doc.id)} className="text-blue-400 hover:underline text-xs">View chunks →</button>
                  ) : doc.status === "processing" || doc.status === "queued" ? (
                    <span className="text-slate-500 text-xs">⏳</span>
                  ) : <span className="text-slate-600 text-xs">—</span>}
                </DarkTd>
                <DarkTd><span className="text-slate-400 text-xs">{formatBytes(doc.sizeBytes)}</span></DarkTd>
                <DarkTd><span className="text-slate-500 text-xs">{new Date(doc.createdAt).toLocaleString("vi-VN")}</span></DarkTd>
                <DarkTd>
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    {doc.status === "failed" && (
                      <DarkButton variant="warn" size="sm" onClick={() => handleReingest(doc.id)} disabled={actioning === doc.id}>
                        {actioning === doc.id ? "..." : "🔄"}
                      </DarkButton>
                    )}
                    <DarkButton variant="danger" size="sm" onClick={() => handleDelete(doc.id)} disabled={actioning === doc.id}>
                      🗑️
                    </DarkButton>
                  </div>
                </DarkTd>
              </DarkTr>
            ))}
          </tbody>
        </DarkTable>
      )}

      {/* Detail Panel */}
      {selectedDoc && (() => {
        const sel = docs.find(d => d.id === selectedDoc);
        return (
          <Card>
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold text-slate-100">📋 Document Detail</h2>
              <div className="flex gap-2">
                <DarkButton variant="warn" size="sm" onClick={() => handleReingest(selectedDoc)} disabled={actioning === selectedDoc}>
                  {actioning === selectedDoc ? "..." : "🔄 Re-ingest"}
                </DarkButton>
                <DarkButton variant="danger" size="sm" onClick={() => handleDelete(selectedDoc)} disabled={actioning === selectedDoc}>
                  🗑️ Delete
                </DarkButton>
              </div>
            </div>

            {sel?.status === "failed" && (() => {
              const cls = classifyError(sel.errorCode ?? null);
              return (
                <div className={`p-3 rounded-lg border text-sm mb-4 ${cls.level === "critical" ? "bg-red-900/20 border-red-700/50 text-red-300" : "bg-orange-900/20 border-orange-700/50 text-orange-300"}`}>
                  <div className="font-medium">{cls.label}</div>
                  {sel.errorCode && <code className="text-xs block mt-1 opacity-75">{sel.errorCode}</code>}
                </div>
              );
            })()}

            {sel && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 mb-4">
                <Kv label="File" value={`${fileIcon(sel.extension)} ${sel.fileName}`} />
                <Kv label="Size" value={formatBytes(sel.sizeBytes)} />
                <Kv label="Type" value={sel.mimeType ?? "." + sel.extension} />
                <Kv label="Provider" value={sel.provider} />
                <Kv label="Source" value={sel.source ?? "manual"} />
                <Kv label="Created" value={new Date(sel.createdAt).toLocaleString("vi-VN")} />
              </div>
            )}

            {jobs.length > 0 && (
              <div className="mb-4">
                <SectionLabel>Ingestion Jobs ({jobs.length})</SectionLabel>
                <div className="space-y-1">
                  {jobs.map((j) => (
                    <div key={j.id} className="flex items-center gap-2 text-xs">
                      <StatusPill variant={docStatusVariant(j.status) as "ready" | "info" | "failed" | "warn" | "inactive"}>{j.status}</StatusPill>
                      <code className="text-slate-500">{j.id.slice(0, 12)}...</code>
                      {j.errorCode && <span className="text-red-400">{j.errorCode}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Ask panel */}
            <div className="rounded-lg border border-blue-700/40 bg-blue-900/10 p-4 mb-4">
              <SectionLabel>💬 Ask Document</SectionLabel>
              <div className="flex gap-2 mb-2">
                <DarkInput
                  className="flex-1"
                  placeholder="Hỏi về nội dung tài liệu..."
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAsk()}
                />
                <DarkButton variant="success" size="md" onClick={handleAsk} disabled={asking || !question.trim()}>
                  {asking ? "..." : "Ask"}
                </DarkButton>
              </div>
              {askResult && (
                <div className="rounded-lg bg-slate-900 border border-slate-700 p-3 text-sm">
                  <div className="text-xs text-slate-500 mb-1">Dùng {askResult.chunksUsed} chunks · {askResult.provider}</div>
                  <div className="text-slate-200 whitespace-pre-wrap">{askResult.answer}</div>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-500 mb-2">{chunks.length} chunks · {markdown ? `${markdown.length} chars` : "no markdown"}</p>

            {markdown && (
              <div className="mb-4">
                <SectionLabel>Markdown Preview</SectionLabel>
                <CodeBlock>
                  {markdown.slice(0, 2000)}
                  {markdown.length > 2000 ? "\n... (truncated)" : ""}
                </CodeBlock>
              </div>
            )}

            {chunks.length > 0 && (
              <div>
                <SectionLabel>Chunks ({chunks.length})</SectionLabel>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {chunks.slice(0, 10).map((c) => (
                    <div key={c.id} className="rounded-lg border border-slate-700 bg-slate-800/60 p-2 text-xs">
                      <span className="font-mono text-slate-500">#{c.chunkIndex}</span>
                      {c.heading && <span className="font-medium text-slate-300 ml-2">{c.heading}</span>}
                      <span className="text-slate-500 ml-2">({c.tokenEstimate ?? "?"} tokens)</span>
                      <div className="text-slate-400 mt-1">{c.text.slice(0, 150)}...</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        );
      })()}
    </div>
  );
}
