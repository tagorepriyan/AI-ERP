import { useEffect, useMemo, useState } from "react";

const API_BASE = "http://localhost:4000";

function App() {
  const [tenantId, setTenantId] = useState("default-campus");
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState("exam_timetable");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [documents, setDocuments] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [loadingDocs, setLoadingDocs] = useState(false);

  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);

  async function fetchDocuments() {
    setLoadingDocs(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE}/documents`, { headers });
      if (!response.ok) {
        throw new Error("Failed to load documents");
      }
      const payload = await response.json();
      setDocuments(payload.items || []);
    } catch (fetchError) {
      setError(fetchError.message || "Unable to fetch documents");
    } finally {
      setLoadingDocs(false);
    }
  }

  async function fetchDocumentById(id) {
    setError("");

    try {
      const response = await fetch(`${API_BASE}/documents/${id}`, { headers });
      if (!response.ok) {
        throw new Error("Failed to load document details");
      }
      const payload = await response.json();
      setSelectedDoc(payload);
    } catch (fetchError) {
      setError(fetchError.message || "Unable to fetch document detail");
    }
  }

  async function onUpload(event) {
    event.preventDefault();

    if (!file) {
      setError("Select a PDF file before uploading.");
      return;
    }

    setUploading(true);
    setError("");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title || file.name);
    formData.append("docType", docType);

    try {
      const response = await fetch(`${API_BASE}/documents/upload`, {
        method: "POST",
        headers,
        body: formData
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message || "Upload failed");
      }

      setTitle("");
      setFile(null);
      await fetchDocuments();
      if (payload?.document?.id) {
        await fetchDocumentById(payload.document.id);
      }
    } catch (uploadError) {
      setError(uploadError.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    fetchDocuments();
  }, [tenantId]);

  return (
    <div className="app-shell">
      <header className="hero">
        <h1>AI-ERP Console</h1>
        <p>Upload campus documents and inspect extracted timeline insights.</p>
      </header>

      <section className="card controls">
        <label>
          Tenant ID
          <input value={tenantId} onChange={(event) => setTenantId(event.target.value)} />
        </label>
      </section>

      <section className="grid">
        <form className="card" onSubmit={onUpload}>
          <h2>Upload Document</h2>

          <label>
            Title
            <input
              placeholder="May 2026 Internal Exam Timetable"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label>
            Document Type
            <select value={docType} onChange={(event) => setDocType(event.target.value)}>
              <option value="exam_timetable">Exam Timetable</option>
              <option value="circular">Circular</option>
              <option value="notice">Notice</option>
            </select>
          </label>

          <label>
            PDF File
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>

          <button type="submit" disabled={uploading}>
            {uploading ? "Uploading..." : "Upload & Process"}
          </button>
        </form>

        <section className="card">
          <h2>Recent Documents</h2>
          <button className="secondary" onClick={fetchDocuments} disabled={loadingDocs}>
            {loadingDocs ? "Refreshing..." : "Refresh"}
          </button>

          <ul className="doc-list">
            {documents.map((doc) => (
              <li key={doc.id}>
                <button className="doc-link" onClick={() => fetchDocumentById(doc.id)}>
                  <strong>{doc.title}</strong>
                  <span>{doc.docType}</span>
                  <span className={`badge ${doc.status}`}>{doc.status}</span>
                </button>
              </li>
            ))}
            {documents.length === 0 && <li>No documents available for this tenant.</li>}
          </ul>
        </section>
      </section>

      <section className="card detail">
        <h2>Document Detail</h2>
        {!selectedDoc && <p>Select a document to inspect extraction output.</p>}

        {selectedDoc && (
          <div className="detail-body">
            <p>
              <strong>Title:</strong> {selectedDoc.document.title}
            </p>
            <p>
              <strong>Status:</strong> {selectedDoc.document.status}
            </p>
            <p>
              <strong>Event Count:</strong> {selectedDoc.latestVersion?.extraction?.events?.length || 0}
            </p>
            <pre>{JSON.stringify(selectedDoc.latestVersion?.extraction || {}, null, 2)}</pre>
          </div>
        )}
      </section>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default App;
