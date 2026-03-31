import { useEffect, useMemo, useState } from "react";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:4000`;

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
  const [viewMode, setViewMode] = useState("table"); // "table", "timeline", "json"
  const [filterDept, setFilterDept] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterSection, setFilterSection] = useState("");

  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);

  const filteredEvents = useMemo(() => {
    if (!selectedDoc?.latestVersion?.extraction?.events) {
      return [];
    }

    return selectedDoc.latestVersion.extraction.events.filter((event) => {
      if (filterDept && !event.departments.includes(filterDept)) {
        return false;
      }
      if (filterYear && !event.years.includes(filterYear)) {
        return false;
      }
      if (filterSection && !event.sections.includes(filterSection)) {
        return false;
      }
      return true;
    });
  }, [selectedDoc, filterDept, filterYear, filterSection]);

  const availableFilters = useMemo(() => {
    if (!selectedDoc?.latestVersion?.extraction?.events) {
      return { departments: [], years: [], sections: [] };
    }

    const allEvents = selectedDoc.latestVersion.extraction.events;
    const departments = [...new Set(allEvents.flatMap((e) => e.departments))].sort();
    const years = [...new Set(allEvents.flatMap((e) => e.years))].sort();
    const sections = [...new Set(allEvents.flatMap((e) => e.sections))].sort();

    return { departments, years, sections };
  }, [selectedDoc]);

  const sortedByDeadline = useMemo(() => {
    return [...filteredEvents].sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date) - new Date(b.date);
    });
  }, [filteredEvents]);

  // Group events intelligently by subject/category
  const groupedEvents = useMemo(() => {
    if (!filteredEvents.length) return [];

    const grouped = {};
    filteredEvents.forEach((event) => {
      const groupKey = event.subjectName || event.subjectCode || "Uncategorized";
      if (!grouped[groupKey]) {
        grouped[groupKey] = [];
      }
      grouped[groupKey].push(event);
    });

    return Object.entries(grouped).map(([key, events]) => ({
      name: key,
      events: events.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(a.date) - new Date(b.date);
      })
    }));
  }, [filteredEvents]);

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

            {/* View Mode Tabs */}
            <div className="view-tabs">
              <button
                className={`tab-btn ${viewMode === "table" ? "active" : ""}`}
                onClick={() => setViewMode("table")}
              >
                Table View
              </button>
              <button
                className={`tab-btn ${viewMode === "timeline" ? "active" : ""}`}
                onClick={() => setViewMode("timeline")}
              >
                Timeline
              </button>
              <button
                className={`tab-btn ${viewMode === "json" ? "active" : ""}`}
                onClick={() => setViewMode("json")}
              >
                JSON
              </button>
            </div>

            {/* Filters */}
            {(viewMode === "table" || viewMode === "timeline") && (
              <div className="filters-section">
                <h4>Filters</h4>
                {availableFilters.departments.length > 0 && (
                  <label>
                    Department
                    <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
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
                    <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)}>
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
                    <select value={filterSection} onChange={(e) => setFilterSection(e.target.value)}>
                      <option value="">All</option>
                      {availableFilters.sections.map((section) => (
                        <option key={section} value={section}>
                          {section}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {(filterDept || filterYear || filterSection) && (
                  <button
                    className="secondary clear-filters"
                    onClick={() => {
                      setFilterDept("");
                      setFilterYear("");
                      setFilterSection("");
                    }}
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            )}

            {/* Table View */}
            {viewMode === "table" && (
              <div className="table-view">
                {filteredEvents.length === 0 ? (
                  <p className="no-events">No events match the selected filters.</p>
                ) : (
                  <div className="grouped-cards">
                    {groupedEvents.map((group, groupIndex) => (
                      <div key={groupIndex} className="event-group-card">
                        <div className="group-header">
                          <h3>{group.name}</h3>
                          <span className="event-count">{group.events.length} item(s)</span>
                        </div>

                        {group.events.map((event, eventIndex) => (
                          <div key={eventIndex} className="event-item">
                            {event.date && (
                              <div className="event-date">
                                <span className="label">Deadline:</span>
                                <span className="value">{event.date}</span>
                              </div>
                            )}

                            {event.instructions && (
                              <div className="event-instruction">
                                <span className="label">Action Required:</span>
                                <p className="value">{event.instructions}</p>
                              </div>
                            )}

                            {event.subjectCode && (
                              <div className="event-code">
                                <span className="label">Code:</span>
                                <span className="value">{event.subjectCode}</span>
                              </div>
                            )}

                            {(event.departments.length > 0 || event.years.length > 0 || event.sections.length > 0) && (
                              <div className="event-meta">
                                {event.departments.length > 0 && (
                                  <span className="meta-item">
                                    <strong>Dept:</strong> {event.departments.join(", ")}
                                  </span>
                                )}
                                {event.years.length > 0 && (
                                  <span className="meta-item">
                                    <strong>Year:</strong> {event.years.join(", ")}
                                  </span>
                                )}
                                {event.sections.length > 0 && (
                                  <span className="meta-item">
                                    <strong>Section:</strong> {event.sections.join(", ")}
                                  </span>
                                )}
                              </div>
                            )}

                            <div className="event-confidence">
                              <span className="confidence-badge">{(event.confidence * 100).toFixed(0)}% confidence</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Timeline View */}
            {viewMode === "timeline" && (
              <div className="timeline-view">
                {sortedByDeadline.length === 0 ? (
                  <p className="no-events">No events match the selected filters.</p>
                ) : (
                  <div className="timeline">
                    {sortedByDeadline.map((event, index) => (
                      <div key={event.eventId || index} className="timeline-item">
                        <div className="timeline-date">{event.date || "No Date"}</div>
                        <div className="timeline-content">
                          <h4>{event.subjectName || event.subjectCode || "Unknown Event"}</h4>
                          {event.subjectCode && <p><strong>Code:</strong> {event.subjectCode}</p>}
                          {event.instructions && <p><strong>Action:</strong> {event.instructions}</p>}
                          {event.departments.length > 0 && (
                            <p><strong>Dept:</strong> {event.departments.join("; ")}</p>
                          )}
                          <div className="timeline-meta">
                            <span className="confidence">{(event.confidence * 100).toFixed(0)}% confidence</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* JSON View */}
            {viewMode === "json" && (
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
