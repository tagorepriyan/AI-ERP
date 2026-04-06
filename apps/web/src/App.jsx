import { useEffect, useMemo, useState } from "react";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:4000`;

function toDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

const MAX_FILE_MB = 20;

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
  const [detailTab, setDetailTab] = useState(() => localStorage.getItem("ai_erp_detail_tab") || "summary");
  const [wizardStep, setWizardStep] = useState(1);
  const [processLine, setProcessLine] = useState("Idle");
  const [processMeta, setProcessMeta] = useState("Waiting to process");
  const [docQuery, setDocQuery] = useState(() => localStorage.getItem("ai_erp_doc_query") || "");
  const [docStatusFilter, setDocStatusFilter] = useState(() => localStorage.getItem("ai_erp_doc_status") || "");
  const [docTypeFilter, setDocTypeFilter] = useState(() => localStorage.getItem("ai_erp_doc_type") || "");
  const [eventExpanded, setEventExpanded] = useState({});
  const [filterDept, setFilterDept] = useState(() => localStorage.getItem("ai_erp_filter_dept") || "");
  const [filterYear, setFilterYear] = useState(() => localStorage.getItem("ai_erp_filter_year") || "");
  const [filterSection, setFilterSection] = useState(() => localStorage.getItem("ai_erp_filter_section") || "");
  const [checkingAi, setCheckingAi] = useState(false);
  const [aiHealth, setAiHealth] = useState(null);
  const [showOcrText, setShowOcrText] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const [wizardError, setWizardError] = useState("");
  const [lastSelectedDocId, setLastSelectedDocId] = useState(() => localStorage.getItem("ai_erp_selected_doc") || "");

  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);
  const extraction = selectedDoc?.latestVersion?.extraction || {};
  const events = extraction?.events || [];
  const isTimetableDoc = selectedDoc?.document?.docType === "exam_timetable" || extraction?.structured?.documentType === "timetable";

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      const matchQuery = doc.title?.toLowerCase().includes(docQuery.toLowerCase());
      const matchStatus = docStatusFilter ? doc.status === docStatusFilter : true;
      const matchDocType = docTypeFilter ? doc.docType === docTypeFilter : true;
      return matchQuery && matchStatus && matchDocType;
    });
  }, [documents, docQuery, docStatusFilter, docTypeFilter]);

  const quickStats = useMemo(() => {
    return {
      total: documents.length,
      published: documents.filter((doc) => doc.status === "published").length,
      review: documents.filter((doc) => doc.status === "review_required").length
    };
  }, [documents]);

  const availableFilters = useMemo(() => {
    if (!events.length) return { departments: [], years: [], sections: [] };
    return {
      departments: [...new Set(events.flatMap((e) => e.departments || []))].sort(),
      years: [...new Set(events.flatMap((e) => e.years || []))].sort(),
      sections: [...new Set(events.flatMap((e) => e.sections || []))].sort()
    };
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (filterDept && !(event.departments || []).includes(filterDept)) return false;
      if (filterYear && !(event.years || []).includes(filterYear)) return false;
      if (filterSection && !(event.sections || []).includes(filterSection)) return false;
      return true;
    });
  }, [events, filterDept, filterYear, filterSection]);

  const sortedByDeadline = useMemo(() => {
    return [...filteredEvents].sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date) - new Date(b.date);
    });
  }, [filteredEvents]);

  const confidenceScore = useMemo(() => {
    if (!events.length) return 0;
    const scores = events.map((event) => event.confidence || 0);
    return scores.reduce((sum, current) => sum + current, 0) / scores.length;
  }, [events]);

  const confidenceClass =
    confidenceScore >= 0.85 ? "conf-good" : confidenceScore >= 0.65 ? "conf-medium" : "conf-low";

  const fallbackTriggered =
    extraction?.stub === true || extraction?.fallback === true || String(extraction?.provider || "").toLowerCase().includes("stub");

  const timetableRows = useMemo(() => {
    if (!isTimetableDoc) return [];
    if (Array.isArray(extraction?.structured?.schedule)) {
      return extraction.structured.schedule;
    }

    const groupedByDate = {};
    for (const event of filteredEvents) {
      const key = event.date || "TBA";
      if (!groupedByDate[key]) groupedByDate[key] = [];
      groupedByDate[key].push(event);
    }

    return Object.entries(groupedByDate).map(([date, entries]) => ({ date, entries }));
  }, [isTimetableDoc, extraction, filteredEvents]);

  useEffect(() => {
    localStorage.setItem("ai_erp_detail_tab", detailTab);
  }, [detailTab]);

  useEffect(() => {
    localStorage.setItem("ai_erp_doc_query", docQuery);
    localStorage.setItem("ai_erp_doc_status", docStatusFilter);
    localStorage.setItem("ai_erp_doc_type", docTypeFilter);
  }, [docQuery, docStatusFilter, docTypeFilter]);

  useEffect(() => {
    localStorage.setItem("ai_erp_filter_dept", filterDept);
    localStorage.setItem("ai_erp_filter_year", filterYear);
    localStorage.setItem("ai_erp_filter_section", filterSection);
  }, [filterDept, filterYear, filterSection]);

  useEffect(() => {
    if (lastSelectedDocId) {
      localStorage.setItem("ai_erp_selected_doc", lastSelectedDocId);
    }
  }, [lastSelectedDocId]);

  async function fetchDocuments() {
    setLoadingDocs(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/documents`, { headers });
      if (!response.ok) throw new Error("Failed to load documents");
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
    setShowOcrText(false);
    setEventExpanded({});
    try {
      const response = await fetch(`${API_BASE}/documents/${id}`, { headers });
      if (!response.ok) throw new Error("Failed to load document details");
      const payload = await response.json();
      setSelectedDoc(payload);
      setLastSelectedDocId(id);
    } catch (fetchError) {
      setError(fetchError.message || "Unable to fetch document detail");
    }
  }

  async function checkAiProviders() {
    setCheckingAi(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/health/ai`, { headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message || "Unable to check AI providers");
      }
      setAiHealth(payload);
    } catch (healthError) {
      setError(healthError.message || "Unable to check AI providers");
    } finally {
      setCheckingAi(false);
    }
  }

  function downloadDebugJson() {
    if (!selectedDoc) return;
    const blob = new Blob([JSON.stringify(selectedDoc.latestVersion?.extraction || {}, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedDoc.document?.title || "document"}-debug.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function runFallbackProvider() {
    if (!selectedDoc?.document?.id) return;
    setError("");
    try {
      const response = await fetch(`${API_BASE}/documents/${selectedDoc.document.id}/fallback`, {
        method: "POST",
        headers
      });
      if (!response.ok) {
        throw new Error("Fallback provider endpoint is not available in current API routes");
      }
      await fetchDocumentById(selectedDoc.document.id);
    } catch (fallbackError) {
      setError(fallbackError.message || "Unable to run fallback provider");
    }
  }

  function toggleEvent(index) {
    setEventExpanded((current) => ({
      ...current,
      [index]: !current[index]
    }));
  }

  async function onUpload(event) {
    event.preventDefault();

    if (!title.trim()) {
      setWizardError("Step 1 validation: title is required.");
      setWizardStep(1);
      return;
    }

    if (!file) {
      setWizardError("Step 2 validation: select a PDF file before uploading.");
      setWizardStep(2);
      return;
    }

    if (file.type !== "application/pdf") {
      setWizardError("Step 2 validation: only PDF files are allowed.");
      setWizardStep(2);
      return;
    }

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setWizardError(`Step 2 validation: file exceeds ${MAX_FILE_MB}MB limit.`);
      setWizardStep(2);
      return;
    }

    setUploading(true);
    setError("");
    setWizardError("");
    setUploadNote("");
    setProcessLine("Preparing request");
    setProcessMeta("Provider: from pipeline routing | Model: assigned by backend");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title || file.name);
    formData.append("docType", docType);

    try {
      setProcessLine("Uploading document");

      const response = await fetch(`${API_BASE}/documents/upload`, {
        method: "POST",
        headers,
        body: formData
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error?.message || "Upload failed");
      }

      setProcessLine("Extraction completed");
      setProcessMeta(
        `Events: ${payload?.extractionSummary?.eventCount ?? 0} | Confidence: ${Math.round((payload?.extractionSummary?.confidenceScore || 0) * 100)}%`
      );
      setUploadNote(`Success. Next action: ${payload?.document?.nextAction || "inspect document"}`);

      setTitle("");
      setFile(null);
      await fetchDocuments();
      if (payload?.document?.id) {
        await fetchDocumentById(payload.document.id);
      }
      setWizardStep(3);
      setProcessLine("Completed");
    } catch (uploadError) {
      setError(uploadError.message || "Upload failed");
      setProcessLine("Failed");
      setProcessMeta("See error message below");
    } finally {
      setUploading(false);
    }
  }

  function onContinueToFile() {
    if (!title.trim()) {
      setWizardError("Step 1 validation: title is required.");
      return;
    }
    setWizardError("");
    setWizardStep(2);
  }

  function onDocListKeyDown(event, index, id) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fetchDocumentById(id);
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    event.preventDefault();
    if (!filteredDocuments.length) return;

    const nextIndex = event.key === "ArrowDown"
      ? Math.min(index + 1, filteredDocuments.length - 1)
      : Math.max(index - 1, 0);

    const nextDoc = filteredDocuments[nextIndex];
    if (nextDoc) {
      fetchDocumentById(nextDoc.id);
    }
  }

  useEffect(() => {
    fetchDocuments();
  }, [tenantId]);

  useEffect(() => {
    if (!lastSelectedDocId || selectedDoc?.document?.id === lastSelectedDocId) {
      return;
    }

    const existsInList = documents.some((doc) => String(doc.id) === String(lastSelectedDocId));
    if (existsInList) {
      fetchDocumentById(lastSelectedDocId);
    }
  }, [documents, lastSelectedDocId]);

  return (
    <div className="app-shell">
      <header className="hero hero-grid">
        <div className="hero-left">
          <h1>AI-ERP Document Console</h1>
          <p>Smart ingestion pipeline for campus timetables, circulars, and notices with extracted and personalized output.</p>
        </div>
        <div className="hero-right">
          <div className="quick-stat">
            <span>Total docs</span>
            <strong>{quickStats.total}</strong>
          </div>
          <div className="quick-stat">
            <span>Published</span>
            <strong>{quickStats.published}</strong>
          </div>
          <div className="quick-stat">
            <span>Review required</span>
            <strong>{quickStats.review}</strong>
          </div>
        </div>
      </header>

      <section className="card controls">
        <label>
          Tenant ID
          <input value={tenantId} onChange={(event) => setTenantId(event.target.value)} />
        </label>
        <button className="secondary" onClick={checkAiProviders} disabled={checkingAi}>
          {checkingAi ? "Checking AI..." : "Check AI Health"}
        </button>
        {aiHealth?.providers?.length > 0 && (
          <div className="ai-health-pill-list">
            {aiHealth.providers.map((provider) => (
              <span key={provider.provider} className={`ai-pill ${provider.active ? "ok" : "down"}`}>
                {provider.provider}: {provider.status}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="grid">
        <form className="card" onSubmit={onUpload}>
          <h2>Upload Wizard</h2>
          <div className="wizard-steps">
            <span className={wizardStep === 1 ? "active" : ""}>Step 1: Document info</span>
            <span className={wizardStep === 2 ? "active" : ""}>Step 2: File</span>
            <span className={wizardStep === 3 ? "active" : ""}>Step 3: Processing result</span>
          </div>

          {wizardStep === 1 && (
            <div className="wizard-panel">
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
              <button type="button" onClick={onContinueToFile}>
                Continue to File
              </button>
              {wizardError && <p className="inline-error">{wizardError}</p>}
            </div>
          )}

          {wizardStep === 2 && (
            <div className="wizard-panel">
              <label>
                PDF File
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
              </label>
              <button type="submit" disabled={uploading}>
                {uploading ? "Upload & Process..." : "Upload & Process"}
              </button>
              <div className="tiny-status-line">{processLine} | {processMeta}</div>
              {wizardError && <p className="inline-error">{wizardError}</p>}
              {uploadNote && <p className="inline-success">{uploadNote}</p>}
            </div>
          )}

          {wizardStep === 3 && (
            <div className="wizard-panel">
              <p className="result-line">Processing complete. You can inspect extraction output in the detail panel.</p>
              <button
                type="button"
                onClick={() => {
                  setWizardStep(1);
                  setProcessLine("Idle");
                  setProcessMeta("Waiting to process");
                  setUploadNote("");
                }}
              >
                Start New Upload
              </button>
              {uploadNote && <p className="inline-success">{uploadNote}</p>}
            </div>
          )}
        </form>

        <section className="card">
          <h2>Recent Documents</h2>
          <div className="doc-filters">
            <input
              placeholder="Search title"
              value={docQuery}
              onChange={(event) => setDocQuery(event.target.value)}
            />
            <select value={docStatusFilter} onChange={(event) => setDocStatusFilter(event.target.value)}>
              <option value="">All status</option>
              <option value="published">Published</option>
              <option value="review_required">Review required</option>
              <option value="failed">Failed</option>
            </select>
            <select value={docTypeFilter} onChange={(event) => setDocTypeFilter(event.target.value)}>
              <option value="">All doc types</option>
              <option value="exam_timetable">Exam timetable</option>
              <option value="circular">Circular</option>
              <option value="notice">Notice</option>
            </select>
          </div>
          <button className="secondary" onClick={fetchDocuments} disabled={loadingDocs}>
            {loadingDocs ? "Refreshing..." : "Refresh"}
          </button>

          <ul className="doc-list dense">
            {filteredDocuments.map((doc, index) => (
              <li key={doc.id}>
                <button
                  className={`doc-link dense ${selectedDoc?.document?.id === doc.id ? "selected" : ""}`}
                  onClick={() => fetchDocumentById(doc.id)}
                  onKeyDown={(event) => onDocListKeyDown(event, index, doc.id)}
                >
                  <strong>{doc.title}</strong>
                  <span className="doc-meta-line">{doc.docType} • {toDate(doc.createdAt)}</span>
                  <span className={`badge ${doc.status}`}>{doc.status}</span>
                </button>
              </li>
            ))}
            {filteredDocuments.length === 0 && <li>No documents match current search/filter.</li>}
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

            <div className="view-tabs">
              <button className={`tab-btn ${detailTab === "summary" ? "active" : ""}`} onClick={() => setDetailTab("summary")}>
                Summary
              </button>
              <button className={`tab-btn ${detailTab === "events" ? "active" : ""}`} onClick={() => setDetailTab("events")}>
                Events
              </button>
              <button className={`tab-btn ${detailTab === "timeline" ? "active" : ""}`} onClick={() => setDetailTab("timeline")}>
                Timeline
              </button>
              {isTimetableDoc && (
                <button className={`tab-btn ${detailTab === "timetable" ? "active" : ""}`} onClick={() => setDetailTab("timetable")}>
                  Timetable Preview
                </button>
              )}
              <button className={`tab-btn ${detailTab === "json" ? "active" : ""}`} onClick={() => setDetailTab("json")}>
                Raw JSON
              </button>
            </div>

            {(detailTab === "events" || detailTab === "timeline") && (
              <div className="filters-section">
                <h4>Event Filters</h4>
                {availableFilters.departments.length > 0 && (
                  <label>
                    Department
                    <select value={filterDept} onChange={(event) => setFilterDept(event.target.value)}>
                      <option value="">All</option>
                      {availableFilters.departments.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {availableFilters.years.length > 0 && (
                  <label>
                    Year
                    <select value={filterYear} onChange={(event) => setFilterYear(event.target.value)}>
                      <option value="">All</option>
                      {availableFilters.years.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {availableFilters.sections.length > 0 && (
                  <label>
                    Section
                    <select value={filterSection} onChange={(event) => setFilterSection(event.target.value)}>
                      <option value="">All</option>
                      {availableFilters.sections.map((section) => (
                        <option key={section} value={section}>
                          {section}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}

            {detailTab === "summary" && (
              <div className="summary-grid">
                <div className="summary-card">
                  <h3>Extraction Summary</h3>
                  <p>
                    <strong>Provider used:</strong> {extraction.provider || extraction.meta?.provider || "Unknown"}
                  </p>
                  <p>
                    <strong>Model:</strong> {extraction.model || extraction.meta?.model || "Unknown"}
                  </p>
                  <p>
                    <strong>Confidence:</strong>{" "}
                    <span className={`confidence-scale ${confidenceClass}`}>{(confidenceScore * 100).toFixed(0)}%</span>
                  </p>
                  {fallbackTriggered && (
                    <div className="warning-banner">
                      Fallback or stub provider appears to be used. Validate outputs before publishing.
                    </div>
                  )}
                </div>
                <div className="summary-card">
                  <h3>Counts</h3>
                  <p>
                    <strong>Events extracted:</strong> {events.length}
                  </p>
                  <p>
                    <strong>Departments:</strong> {availableFilters.departments.length || 0}
                  </p>
                  <p>
                    <strong>Years:</strong> {availableFilters.years.length || 0}
                  </p>
                </div>
              </div>
            )}

            {detailTab === "events" && (
              <div className="events-table-wrap">
                {filteredEvents.length === 0 ? (
                  <div className="empty-state-card">
                    <h3>No events extracted</h3>
                    <p>Probable reason: OCR quality low or timetable pattern not recognized.</p>
                    <div className="empty-actions">
                      <button className="secondary" onClick={runFallbackProvider}>Run fallback provider</button>
                      <button className="secondary" onClick={() => setShowOcrText((current) => !current)}>View OCR text</button>
                      <button className="secondary" onClick={downloadDebugJson}>Download debug JSON</button>
                    </div>
                  </div>
                ) : (
                  <table className="events-table compact">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Time</th>
                        <th>Subject</th>
                        <th>Scope</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map((event, index) => (
                        <>
                          <tr key={`row-${index}`}>
                            <td>{event.date || "-"}</td>
                            <td>{event.time || event.startTime || "-"}</td>
                            <td>{event.subjectName || event.subjectCode || "Unknown"}</td>
                            <td>
                              <div className="chips">
                                {(event.departments || []).map((dept) => (
                                  <span key={`${index}-${dept}`} className="chip">{dept}</span>
                                ))}
                                {(event.years || []).map((year) => (
                                  <span key={`${index}-${year}`} className="chip alt">Y{year}</span>
                                ))}
                                {(event.sections || []).map((section) => (
                                  <span key={`${index}-${section}`} className="chip alt">S{section}</span>
                                ))}
                              </div>
                            </td>
                            <td>
                              <button className="secondary tiny" onClick={() => toggleEvent(index)}>
                                {eventExpanded[index] ? "Hide" : "Expand"}
                              </button>
                            </td>
                          </tr>
                          {eventExpanded[index] && (
                            <tr key={`expand-${index}`} className="expanded-row">
                              <td colSpan={5}>
                                <strong>Instructions:</strong> {event.instructions || "No instructions"}
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                )}

                {showOcrText && (
                  <pre className="json-view">
                    {extraction.rawText || extraction.ocrText || "OCR text is not available in this payload."}
                  </pre>
                )}
              </div>
            )}

            {detailTab === "timeline" && (
              <div className="timeline-view">
                {sortedByDeadline.length === 0 ? (
                  <div className="empty-state-card">
                    <h3>No events extracted</h3>
                    <p>Probable reason: parser did not find date-linked records for this document.</p>
                    <div className="empty-actions">
                      <button className="secondary" onClick={runFallbackProvider}>Run fallback provider</button>
                      <button className="secondary" onClick={() => setShowOcrText((current) => !current)}>View OCR text</button>
                      <button className="secondary" onClick={downloadDebugJson}>Download debug JSON</button>
                    </div>
                  </div>
                ) : (
                  <div className="timeline">
                    {sortedByDeadline.map((event, index) => (
                      <div key={event.eventId || index} className="timeline-item">
                        <div className="timeline-date">{event.date || "No date"}</div>
                        <div className="timeline-content">
                          <h4>{event.subjectName || event.subjectCode || "Unknown event"}</h4>
                          <p>{event.instructions || "No instructions"}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {isTimetableDoc && detailTab === "timetable" && (
              <div className="timetable-preview">
                {timetableRows.length === 0 ? (
                  <p className="no-events">No timetable rows found for this document.</p>
                ) : (
                  timetableRows.map((row, index) => (
                    <div key={index} className="timetable-day-card">
                      <h4>{row.date}</h4>
                      <ul>
                        {(row.entries || row.subjects || []).map((entry, rowIndex) => (
                          <li key={rowIndex}>
                            {entry.subjectName || entry.subjectCode || entry.subject || "Subject"}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            )}

            {detailTab === "json" && (
              <pre className="json-view">{JSON.stringify(selectedDoc.latestVersion?.extraction || {}, null, 2)}</pre>
            )}
          </div>
        )}
      </section>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default App;
