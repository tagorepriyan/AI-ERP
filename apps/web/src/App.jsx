import { useEffect, useMemo, useState, useCallback, useRef, lazy, Suspense } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

const LoginPage = lazy(() => import("./LoginPage"));
const ReviewPanel = lazy(() => import("./ReviewPanel"));
const ComposeModal = lazy(() => import("./ComposeModal"));

const API = import.meta.env.VITE_API_BASE_URL || `${location.protocol}//${location.hostname}:4000`;
const APP_SECTIONS = ["dashboard", "documents", "students", "notifications", "settings"];
const DOCUMENT_TABS = ["intelligence", "schedule", "routing", "recipients", "raw"];
const NOTIFICATION_TABS = ["queue", "history"];
const HISTORY_STATUSES = ["delivered", "scheduled", "pending", "failed", "skipped", "all"];

function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString();
}

function fmtDateTime(v) {
  if (!v) return "-";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleString();
}

function getNotificationEventTime(notification) {
  return notification?.sentAt || notification?.scheduledAt || notification?.approvedAt || notification?.updatedAt || notification?.createdAt;
}

function formatNotificationStatus(status) {
  return (status || "-").replace(/_/g, " ");
}

function fmtTime(sec) {
  if (!sec || sec <= 0) return "< 1s";
  if (sec < 60) return `~${Math.round(sec)}s`;
  return `~${Math.round(sec / 60)}m`;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const pathSegments = useMemo(() => {
    const clean = location.pathname.replace(/^\/+|\/+$/g, "");
    return clean ? clean.split("/") : [];
  }, [location.pathname]);

  const topSegment = pathSegments[0] || "";
  const section = topSegment || "dashboard";
  const view = APP_SECTIONS.includes(section) ? section : "dashboard";
  const isLoginRoute = section === "login";
  const routedDocId = section === "documents" && pathSegments[1] ? decodeURIComponent(pathSegments[1]) : null;
  const isReviewRoute = section === "documents" && pathSegments.length === 3 && pathSegments[2] === "review";
  const isComposeRoute = section === "notifications" && pathSegments.length === 2 && pathSegments[1] === "compose";

  const docTabParam = searchParams.get("tab");
  const detailTab = DOCUMENT_TABS.includes(docTabParam) ? docTabParam : "intelligence";

  const notiTabParam = searchParams.get("tab");
  const notiTab = NOTIFICATION_TABS.includes(notiTabParam) ? notiTabParam : "queue";
  const statusParam = searchParams.get("status");
  const historyStatusFilter = HISTORY_STATUSES.includes(statusParam) ? statusParam : "delivered";

  const [authed, setAuthed] = useState(() => sessionStorage.getItem("notify_auth") === "1");
  const [tenantId] = useState("default-campus");
  const [token, setToken] = useState(() => sessionStorage.getItem("notify_token") || "");
  const headers = useMemo(() => ({
    "x-tenant-id": tenantId,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }), [tenantId, token]);
  const jsonHeaders = useMemo(() => ({ ...headers, "Content-Type": "application/json" }), [headers]);

  // ── Data state ──────────────────────────────────────────────────────────────
  const [docs, setDocs] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [loadingDocDetail, setLoadingDocDetail] = useState(false);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [recipientsLoadedDocId, setRecipientsLoadedDocId] = useState(null);
  const [docSearch, setDocSearch] = useState("");
  const [error, setError] = useState("");
  const [showEditDoc, setShowEditDoc] = useState(false);
  const [editDocTitle, setEditDocTitle] = useState("");
  const [editDocType, setEditDocType] = useState("circular");
  const [savingDoc, setSavingDoc] = useState(false);

  // Upload wizard
  const [showUpload, setShowUpload] = useState(false);
  const [wizStep, setWizStep] = useState(1);
  const [uTitle, setUTitle] = useState("");
  const [uDocType, setUDocType] = useState("circular");
  const [uProvider, setUProvider] = useState("ollama");
  const [uFile, setUFile] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [jobProgress, setJobProgress] = useState(null);

  // Review panel (replaces old simple approval modal)
  const [showReview, setShowReview] = useState(null);

  // AI status
  const [aiStatus, setAiStatus] = useState("checking");

  // System stats
  const [sysStats, setSysStats] = useState(null);

  // Notification history
  const [sentHistory, setSentHistory] = useState([]);
  const [scheduledNotifications, setScheduledNotifications] = useState([]);

  // CSV import
  const csvRef = useRef();

  // Workflow Settings
  const [settings, setSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem("notify_settings")) || {}; }
    catch { return {}; }
  });
  const skipHybridOcr = settings.skipHybridOcr || false;
  const bypassPdfParse = settings.bypassPdfParse || false;
  const aiEnabled = settings.aiEnabled !== false;
  const useFallbacks = settings.useFallbacks !== false;

  const updateSetting = (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("notify_settings", JSON.stringify(next));
  };

  const navigateSection = useCallback((target) => {
    navigate(`/${target}`);
  }, [navigate]);

  const updateRouteSearch = useCallback((updates, { replace = true } = {}) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    setSearchParams(params, { replace });
  }, [searchParams, setSearchParams]);

  const setDocumentTab = useCallback((tab) => {
    updateRouteSearch({ tab: tab === "intelligence" ? null : tab });
  }, [updateRouteSearch]);

  const setNotificationsRouteState = useCallback((tab, status = historyStatusFilter) => {
    const params = new URLSearchParams();
    if (tab === "history") {
      params.set("tab", "history");
      if (status && status !== "delivered") {
        params.set("status", status);
      }
    }
    const q = params.toString();
    navigate(`/notifications${q ? `?${q}` : ""}`);
  }, [historyStatusFilter, navigate]);

  // ── Fetchers ────────────────────────────────────────────────────────────────
  const fetchDocs = useCallback(async () => {
    try {
      const r = await fetch(`${API}/documents`, { headers });
      const d = await r.json();
      setDocs(d.items || []);
    } catch (e) { console.error(e); }
  }, [headers]);

  const fetchStudents = useCallback(async () => {
    try {
      const r = await fetch(`${API}/students`, { headers });
      const d = await r.json();
      setStudents(d.students || []);
    } catch (e) { console.error(e); }
  }, [headers]);

  const fetchDocDetail = useCallback(async (id) => {
    setLoadingDocDetail(true);
    try {
      const r = await fetch(`${API}/documents/${id}`, { headers });
      const d = await r.json();
      setSelectedDoc(d);
      return d;
    } catch (e) { console.error(e); }
    finally { setLoadingDocDetail(false); }
  }, [headers]);

  const fetchRecipients = useCallback(async (id) => {
    if (!id) return [];
    setLoadingRecipients(true);
    try {
      const r = await fetch(`${API}/notifications/document/${id}`, { headers });
      const d = await r.json();
      const items = d.notifications || [];
      setRecipients(items);
      setRecipientsLoadedDocId(id);
      return items;
    } catch (e) { console.error(e); }
    finally { setLoadingRecipients(false); }
  }, [headers]);

  const fetchNotificationHistory = useCallback(async (status = historyStatusFilter) => {
    try {
      const query = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
      const r = await fetch(`${API}/notifications${query}`, { headers });
      const d = await r.json();
      setSentHistory(d.notifications || []);
    } catch (e) { console.error(e); }
  }, [headers, historyStatusFilter]);

  const fetchScheduledNotifications = useCallback(async () => {
    try {
      const r = await fetch(`${API}/notifications?status=scheduled`, { headers });
      const d = await r.json();
      setScheduledNotifications(d.notifications || []);
    } catch (e) { console.error(e); }
  }, [headers]);

  const checkAi = useCallback(async () => {
    setAiStatus("checking");
    try {
      const r = await fetch("http://127.0.0.1:11434/api/tags");
      if (r.ok) setAiStatus("online");
      else setAiStatus("offline");
    } catch { setAiStatus("offline"); }
  }, []);

  const fetchSysStats = useCallback(async () => {
    try {
      const r = await fetch(`${API}/system`, { headers });
      if (r.ok) setSysStats(await r.json());
    } catch { /* silent */ }
  }, [headers]);

  useEffect(() => {
    if (!authed) {
      if (location.pathname !== "/login") {
        navigate("/login", { replace: true });
      }
      return;
    }

    if (location.pathname === "/" || isLoginRoute) {
      navigate("/dashboard", { replace: true });
      return;
    }

    if (!APP_SECTIONS.includes(section)) {
      navigate("/dashboard", { replace: true });
      return;
    }

    if (section === "documents") {
      const isValidDocPath = pathSegments.length <= 3 && (pathSegments.length < 3 || pathSegments[2] === "review");
      if (!isValidDocPath) {
        navigate("/documents", { replace: true });
      }
    }

    if (section === "notifications" && pathSegments.length > 2) {
      navigate("/notifications", { replace: true });
    }
  }, [authed, location.pathname, navigate, isLoginRoute, section, pathSegments]);

  useEffect(() => {
    if (!authed) return;
    if (selectedDocId === routedDocId) return;

    setSelectedDocId(routedDocId || null);
    setSelectedDoc(null);
    setRecipients([]);
    setRecipientsLoadedDocId(null);

    if (routedDocId) {
      fetchDocDetail(routedDocId);
    }
  }, [authed, selectedDocId, routedDocId, fetchDocDetail]);

  useEffect(() => {
    if (!authed) return;
    fetchDocs(); fetchStudents(); checkAi(); fetchSysStats();
    const i1 = setInterval(checkAi, 30000);
    const i2 = setInterval(fetchSysStats, 2500);
    return () => { clearInterval(i1); clearInterval(i2); };
  }, [authed]);

  useEffect(() => {
    if (!authed || view !== "notifications") return;
    fetchScheduledNotifications();
    if (notiTab === "history") {
      fetchNotificationHistory(historyStatusFilter);
    }
  }, [authed, view, notiTab, historyStatusFilter, fetchScheduledNotifications, fetchNotificationHistory]);

  // ── Derived data ────────────────────────────────────────────────────────────
  const pendingDocs = useMemo(() => docs.filter(d => d.status === "pending_approval"), [docs]);
  const publishedDocs = useMemo(() => docs.filter(d => d.status === "published"), [docs]);
  const filteredDocs = useMemo(() => {
    const q = docSearch.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => {
      const title = (d.title || "").toLowerCase();
      const type = (d.docType || "").toLowerCase();
      const status = (d.status || "").toLowerCase();
      return title.includes(q) || type.includes(q) || status.includes(q);
    });
  }, [docs, docSearch]);
  const extraction = selectedDoc?.latestVersion?.extraction || {};
  const structured = extraction?.structured || {};
  const events = extraction?.events || [];

  function handleUpload() {
    if (!uFile) return;
    const fd = new FormData();
    fd.append("file", uFile);
    fd.append("title", uTitle || uFile.name);
    fd.append("docType", uDocType);
    fd.append("provider", uProvider);
    fd.append("settings", JSON.stringify(settings));

    // Close the modal immediately so the user is NOT blocked
    setShowUpload(false);
    setWizStep(1);
    setJobProgress({ pct: 0, label: "Uploading document...", stage: "upload" });

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}/documents/upload`);
    xhr.setRequestHeader("x-tenant-id", tenantId);

    // Track upload progress natively BEFORE the backend processing even starts
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 5); // Upload is first 5% of pipeline
        setJobProgress(prev => prev ? { ...prev, pct: percent } : null);
      }
    };

    xhr.onload = () => {
      try {
        const d = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          if (d.jobId) {
            setJobId(d.jobId);
          } else {
            setJobProgress({ pct: 100, label: "Done", stage: "done" });
            fetchDocs();
          }
        } else {
          setJobProgress({ pct: 0, label: `Error: ${d.error || 'Upload failed'}`, stage: "error" });
        }
      } catch (e) {
        setJobProgress({ pct: 0, label: `Error parsing response`, stage: "error" });
      }
    };

    xhr.onerror = () => {
      setJobProgress({ pct: 0, label: `Network error`, stage: "error" });
    };

    xhr.send(fd);
  }

  async function cancelJob() {
    if (!jobId) return;
    try {
      await fetch(`${API}/jobs/${jobId}/cancel`, { method: "POST", headers: jsonHeaders });
      setJobId(null);
      setJobProgress({ pct: 0, label: "Cancelled by user", stage: "error" });
    } catch(e) {}
  }

  // Poll job progress
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    const poll = async () => {
      try {
        const r = await fetch(`${API}/jobs/${jobId}`, { headers });
        if (!r.ok) return;
        const job = await r.json();
        if (active) setJobProgress(job);
        if (job.stage === "done" || job.stage === "error") {
          fetchDocs();
          return;
        }
        if (active) setTimeout(poll, 800);
      } catch { if (active) setTimeout(poll, 2000); }
    };
    poll();
    return () => { active = false; };
  }, [jobId]);

  async function prepareReviewContext(doc) {
    if (!doc?.id) return null;

    // For a doc from the list (minimal data), fetch full detail first
    if (selectedDocId === doc.id) {
      let latestRecipients = recipients;
      if (recipientsLoadedDocId !== doc.id) {
        latestRecipients = await fetchRecipients(doc.id);
      }
      const payload = { doc, extraction, recipients: latestRecipients || [] };
      setShowReview(payload);
      return payload;
    } else {
      setRecipients([]);
      setRecipientsLoadedDocId(null);

      const [detail, latestRecipients] = await Promise.all([
        fetchDocDetail(doc.id),
        fetchRecipients(doc.id),
      ]);

      const payload = {
        doc: detail?.document ? { id: detail.document.id, ...detail.document } : doc,
        extraction: detail?.latestVersion?.extraction || null,
        recipients: latestRecipients || []
      };
      setShowReview(payload);
      return payload;
    }
  }

  async function openReview(doc) {
    const reviewDocId = doc?.id || selectedDocId;
    if (!reviewDocId) return;

    await prepareReviewContext(doc || { id: reviewDocId, title: selectedDoc?.document?.title || "Document" });
    navigate(`/documents/${encodeURIComponent(reviewDocId)}/review`);
  }

  async function approveDoc(docId) {
    if (!docId) return;
    try {
      const r = await fetch(`${API}/documents/${docId}/approve`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ approvedBy: "admin" })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.error?.message || "Approval failed");
      }
      await fetchDocs();
      if (selectedDocId === docId) {
        await fetchDocDetail(docId);
        if (detailTab === "recipients") await fetchRecipients(docId);
      }
    } catch (e) {
      setError(e.message || "Failed to approve document");
    }
  }

  function handleReviewAction(action) {
    const currentReviewDocId = showReview?.doc?.id || selectedDocId;
    setShowReview(null);
    if (currentReviewDocId) {
      navigate(`/documents/${encodeURIComponent(currentReviewDocId)}`);
    } else {
      navigate("/documents");
    }
    fetchDocs();
    if (selectedDocId) {
      fetchDocDetail(selectedDocId);
      if (detailTab === "recipients") fetchRecipients(selectedDocId);
    }
  }

  function openEditDocument() {
    if (!selectedDoc?.document) return;
    setEditDocTitle(selectedDoc.document.title || "");
    setEditDocType(selectedDoc.document.docType || "circular");
    setShowEditDoc(true);
  }

  async function saveDocumentChanges() {
    if (!selectedDoc?.document?.id || savingDoc) return;
    const title = editDocTitle.trim();
    if (!title) {
      setError("Document title cannot be empty");
      return;
    }
    setSavingDoc(true);
    try {
      const r = await fetch(`${API}/documents/${selectedDoc.document.id}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ title, docType: editDocType })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message || "Failed to update document");

      setShowEditDoc(false);
      await fetchDocs();
      await fetchDocDetail(selectedDoc.document.id);
      if (detailTab === "recipients") await fetchRecipients(selectedDoc.document.id);
    } catch (e) {
      setError(e.message || "Failed to update document");
    } finally {
      setSavingDoc(false);
    }
  }

  async function deleteDocument(docId) {
    if (!docId) return;
    const confirmed = window.confirm("Delete this document and all related notifications? This action cannot be undone.");
    if (!confirmed) return;
    try {
      const r = await fetch(`${API}/documents/${docId}`, {
        method: "DELETE",
        headers
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message || "Failed to delete document");

      if (selectedDocId === docId) {
        navigate("/documents");
        setSelectedDoc(null);
        setRecipients([]);
        setRecipientsLoadedDocId(null);
      }
      await fetchDocs();
    } catch (e) {
      setError(e.message || "Failed to delete document");
    }
  }

  async function seedStudents() {
    try {
      await fetch(`${API}/students/seed`, { method: "POST", headers });
      fetchStudents();
    } catch (e) { setError(e.message); }
  }

  async function importCsv(csvText) {
    try {
      const r = await fetch(`${API}/students/import-csv`, { method: "POST", headers: { ...headers, "Content-Type": "text/csv" }, body: csvText });
      const d = await r.json();
      alert(d.message || "Import complete");
      fetchStudents();
    } catch (e) { setError(e.message); }
  }

  function selectDoc(id) {
    navigate(`/documents/${encodeURIComponent(id)}`);
  }

  useEffect(() => {
    if (!authed || !isReviewRoute || !routedDocId) return;
    if (showReview?.doc?.id === routedDocId) return;

    const doc = docs.find((item) => item.id === routedDocId) || { id: routedDocId, title: selectedDoc?.document?.title || "Document" };
    prepareReviewContext(doc);
  }, [authed, isReviewRoute, routedDocId, showReview, docs, selectedDoc, prepareReviewContext]);

  useEffect(() => {
    if (isReviewRoute) return;
    if (showReview) setShowReview(null);
  }, [isReviewRoute, showReview]);

  const closeCompose = useCallback(() => {
    navigate(`/notifications${location.search || ""}`);
  }, [navigate, location.search]);

  const openCompose = useCallback(() => {
    navigate(`/notifications/compose${location.search || ""}`);
  }, [navigate, location.search]);

  if (!authed) {
    return (
      <Suspense fallback={<div className="app-loading">Loading login...</div>}>
        <LoginPage onLogin={(payload) => {
          setToken(payload?.token || sessionStorage.getItem("notify_token") || "");
          setAuthed(true);
          navigate("/dashboard", { replace: true });
        }} />
      </Suspense>
    );
  }

  // ── Nav items ───────────────────────────────────────────────────────────────
  const navItems = [
    { id: "dashboard", icon: "📊", label: "Dashboard" },
    { id: "documents", icon: "📄", label: "Documents" },
    { id: "students", icon: "👥", label: "Students" },
    { id: "notifications", icon: "🔔", label: "Notifications", badge: (pendingDocs.length + scheduledNotifications.length) || null },
    { id: "settings", icon: "⚙️", label: "Settings" },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      {/* ── Nav Rail ──────────────────────────────────────────── */}
      <nav className="nav-rail">
        <div className="nav-logo">🔔</div>
        {navItems.map(n => (
          <button key={n.id} className={`nav-item ${view === n.id ? "active" : ""}`} onClick={() => navigateSection(n.id)} title={n.label}>
            {n.icon}
            {n.badge ? <span className="nav-badge">{n.badge}</span> : null}
          </button>
        ))}
        <div className="nav-spacer" />

        {/* Mini system monitor — hover to expand */}
        {sysStats && (
          <div className="nav-sysmon">
            <div className="nav-sysmon-dots">
              <div className="sysmon-dot" style={{ background: sysStats.cpu.load > 80 ? 'var(--danger)' : sysStats.cpu.load > 50 ? 'var(--warning)' : 'var(--success)' }} />
              <div className="sysmon-dot" style={{ background: sysStats.ram.usagePct > 85 ? 'var(--danger)' : sysStats.ram.usagePct > 60 ? 'var(--warning)' : 'var(--primary)' }} />
              <div className="sysmon-dot" style={{ background: (sysStats.gpu.utilizationPct ?? 0) > 80 ? 'var(--danger)' : 'var(--primary)' }} />
            </div>
            <span className="nav-hw-label">SYS</span>

            {/* Popout panel on hover */}
            <div className="sysmon-popout">
              <div className="sysmon-popout-title">🖥️ System Monitor</div>

              <div className="sysmon-section">
                <div className="sysmon-row">
                  <span className="sysmon-name">⚡ CPU</span>
                  <span className="sysmon-val">{sysStats.cpu.load}%</span>
                </div>
                <div className="sysmon-bar"><div className="sysmon-bar-fill" style={{ width: `${sysStats.cpu.load}%`, background: sysStats.cpu.load > 80 ? 'var(--danger)' : sysStats.cpu.load > 50 ? 'var(--warning)' : 'var(--success)' }} /></div>
                <div className="sysmon-sub">{sysStats.cpu.cores} cores{sysStats.cpu.tempC != null ? ` · ${sysStats.cpu.tempC}°C` : ''}</div>
              </div>

              <div className="sysmon-section">
                <div className="sysmon-row">
                  <span className="sysmon-name">🧠 RAM</span>
                  <span className="sysmon-val">{sysStats.ram.usedGB} / {sysStats.ram.totalGB} GB</span>
                </div>
                <div className="sysmon-bar"><div className="sysmon-bar-fill" style={{ width: `${sysStats.ram.usagePct}%`, background: sysStats.ram.usagePct > 85 ? 'var(--danger)' : sysStats.ram.usagePct > 60 ? 'var(--warning)' : 'var(--primary)' }} /></div>
                <div className="sysmon-sub">{sysStats.ram.freeGB} GB free · {sysStats.ram.usagePct}% used</div>
              </div>

              <div className="sysmon-section">
                <div className="sysmon-row">
                  <span className="sysmon-name">🎮 GPU</span>
                  <span className="sysmon-val">{sysStats.gpu.utilizationPct != null ? `${sysStats.gpu.utilizationPct}%` : '-'}</span>
                </div>
                {sysStats.gpu.utilizationPct != null && (
                  <div className="sysmon-bar"><div className="sysmon-bar-fill" style={{ width: `${sysStats.gpu.utilizationPct}%`, background: 'var(--primary)' }} /></div>
                )}
                <div className="sysmon-sub">{sysStats.gpu.model}</div>
                {sysStats.gpu.vramTotalMB > 0 && <div className="sysmon-sub">VRAM: {sysStats.gpu.vramTotalMB} MB{sysStats.gpu.vramUsedMB != null ? ` (${sysStats.gpu.vramUsedMB} used)` : ''}</div>}
                {sysStats.gpu.clockMHz != null && <div className="sysmon-sub">Clock: {sysStats.gpu.clockMHz} MHz{sysStats.gpu.memClockMHz ? ` · Mem: ${sysStats.gpu.memClockMHz} MHz` : ''}</div>}
                {sysStats.gpu.tempC != null && <div className="sysmon-sub">🌡️ {sysStats.gpu.tempC}°C</div>}
              </div>
            </div>
          </div>
        )}

        <div className="nav-ai-status" title={`Local AI: ${aiStatus}`}>
          <div className={`ai-dot ${aiStatus}`} />
          <span className="ai-label">{aiStatus === "online" ? "AI ON" : aiStatus === "checking" ? "..." : "OFF"}</span>
        </div>
        <button className="nav-item" onClick={() => { sessionStorage.removeItem("notify_auth"); sessionStorage.removeItem("notify_token"); setToken(""); setAuthed(false); navigate("/login", { replace: true }); }} title="Logout">🚪</button>
      </nav>

      {/* ── Context Panel ─────────────────────────────────────── */}
      {(view === "documents" || view === "dashboard") && (
        <aside className="context-panel">
          <div className="panel-header">
            <div className="panel-title">Documents</div>
            <div className="panel-search">
              <span className="panel-search-icon">🔍</span>
              <input
                placeholder="Search documents..."
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="panel-body">
            {filteredDocs.map(doc => (
              <div key={doc.id} className={`doc-item ${selectedDocId === doc.id ? "active" : ""}`} onClick={() => selectDoc(doc.id)}>
                <div className="doc-item-title">{doc.title}</div>
                <div className="doc-item-meta">
                  <span className={`badge ${doc.status}`}>{doc.status.replace(/_/g, " ")}</span>
                  <span className="badge secondary">{doc.docType}</span>
                  {doc.recipientCount > 0 && <span className="text-sm text-muted">👥 {doc.recipientCount}</span>}
                </div>
              </div>
            ))}
            {docs.length === 0 && <div className="empty-state"><p>No documents uploaded yet.</p></div>}
            {docs.length > 0 && filteredDocs.length === 0 && <div className="empty-state"><p>No documents match your search.</p></div>}
          </div>
          <div className="panel-actions">
            <button className="btn btn-primary btn-full" onClick={() => { setShowUpload(true); setWizStep(1); setJobId(null); setJobProgress(null); }}>📤 Upload Document</button>
          </div>
        </aside>
      )}

      {/* ── Main Content ──────────────────────────────────────── */}
      <main className="main-content">
        {/* ═══ DASHBOARD ═══ */}
        {view === "dashboard" && (
          <>
            <div className="main-header"><div><h2>Dashboard</h2><p>AI-Powered Communication System Overview</p></div></div>
            <div className="main-body">
              <div className="stats-grid">
                <div className="stat-card"><div className="stat-card-icon">📄</div><div className="stat-card-value">{docs.length}</div><div className="stat-card-label">Total Documents</div></div>
                <div className={`stat-card ${pendingDocs.length > 0 ? "warning" : ""}`}><div className="stat-card-icon">⏳</div><div className="stat-card-value">{pendingDocs.length}</div><div className="stat-card-label">Awaiting Approval</div></div>
                <div className="stat-card"><div className="stat-card-icon">👥</div><div className="stat-card-value">{students.length}</div><div className="stat-card-label">Students Enrolled</div></div>
                <div className="stat-card success"><div className="stat-card-icon">✅</div><div className="stat-card-value">{publishedDocs.length}</div><div className="stat-card-label">Notifications Sent</div></div>
              </div>

              <div className="dashboard-grid">
                <div className="section-card">
                  <div className="section-card-header"><div className="section-card-title">⏳ Pending Approvals</div></div>
                  <div className="section-card-body">
                    {pendingDocs.length === 0 && <p className="text-sm text-muted">No pending documents. All clear!</p>}
                    {pendingDocs.map(doc => (
                      <div key={doc.id} className="approval-item" onClick={() => selectDoc(doc.id)}>
                        <div className="approval-icon">📋</div>
                        <div className="approval-info">
                          <div className="approval-title">{doc.title}</div>
                          <div className="approval-meta">{doc.docType} · {doc.recipientCount || 0} recipients matched</div>
                        </div>
                        <button className="btn btn-warning btn-sm" onClick={e => { e.stopPropagation(); openReview(doc); }}>Review</button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="section-card">
                  <div className="section-card-header"><div className="section-card-title">📊 Recent Activity</div></div>
                  <div className="section-card-body">
                    {docs.slice(0, 6).map(doc => (
                      <div key={doc.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                        <span style={{ fontSize: 12, flex: 1 }} className="truncate">{doc.title}</span>
                        <span className={`badge ${doc.status}`}>{doc.status.replace(/_/g, " ")}</span>
                      </div>
                    ))}
                    {docs.length === 0 && <p className="text-sm text-muted">No recent activity.</p>}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ═══ DOCUMENTS DETAIL ═══ */}
        {view === "documents" && (
          <>
            {loadingDocDetail ? (
              <div className="detail-loading">
                <div className="skeleton-block skeleton-title" />
                <div className="skeleton-block skeleton-subtitle" />
                <div className="skeleton-grid">
                  <div className="skeleton-block skeleton-card" />
                  <div className="skeleton-block skeleton-card" />
                  <div className="skeleton-block skeleton-card" />
                  <div className="skeleton-block skeleton-card" />
                </div>
                <div className="skeleton-block skeleton-panel" />
              </div>
            ) : !selectedDoc ? (
              <div className="empty-state" style={{ flex: 1 }}><div className="empty-state-icon">📄</div><h3>Select a document</h3><p>Choose a document from the sidebar to view its AI analysis and routing details.</p></div>
            ) : (
              <div className="detail-shell">
                <div className="detail-header">
                  <div className="detail-title-row">
                    <div>
                      <div className="detail-title">{selectedDoc.document.title}</div>
                      <div className="detail-subtitle">
                        {selectedDoc.document.docType?.toUpperCase()} · Provider: {extraction.provider || "N/A"} · {fmtDate(selectedDoc.document.createdAt)}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn btn-ghost btn-sm" onClick={openEditDocument}>✏️ Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteDocument(selectedDoc.document.id)}>🗑 Delete</button>
                      <span className={`badge ${selectedDoc.document.status}`}>{selectedDoc.document.status?.replace(/_/g, " ")}</span>
                      {selectedDoc.document.status === "pending_approval" && (
                        <button className="btn btn-warning btn-sm" onClick={() => openReview({ id: selectedDoc.document.id, ...selectedDoc.document })}>Review & Approve</button>
                      )}
                    </div>
                  </div>

                  {selectedDoc.document.status === "pending_approval" && (
                    <div className="approval-banner">
                      <div className="approval-banner-icon">⚠️</div>
                      <div className="approval-banner-text">
                        <strong>Awaiting Admin Approval</strong>
                        <span>{selectedDoc.recipientCount || 0} users matched — notifications held until approved.</span>
                      </div>
                      <div className="approval-banner-actions">
                        <button className="btn btn-success btn-sm" onClick={() => approveDoc(selectedDoc.document.id)}>✓ Approve</button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={async () => {
                            const payload = await prepareReviewContext({ id: selectedDoc.document.id, ...selectedDoc.document });
                            if (payload) {
                              setShowReview({ ...payload, initialTab: "reject" });
                              navigate(`/documents/${encodeURIComponent(selectedDoc.document.id)}/review`);
                            }
                          }}
                        >
                          ✕ Reject
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="detail-tabs">
                    {["intelligence", "schedule", "routing", "recipients", "raw"].map(t => (
                      <button
                        key={t}
                        className={`detail-tab ${detailTab === t ? "active" : ""}`}
                        onClick={() => {
                          setDocumentTab(t);
                          if (t === "recipients" && selectedDocId && recipientsLoadedDocId !== selectedDocId) {
                            fetchRecipients(selectedDocId);
                          }
                        }}
                      >
                        {t === "intelligence" ? "🧠 Intelligence" : t === "schedule" ? "📅 Schedule" : t === "routing" ? "🔀 Routing" : t === "recipients" ? `👥 Recipients (${recipients.length})` : "{ } Raw Data"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="detail-body">
                  {/* INTELLIGENCE */}
                  {detailTab === "intelligence" && (
                    <>
                      <div className="intelligence-grid">
                        <div className="intel-card">
                          <div className="intel-card-label">Document Title</div>
                          <div className="intel-card-value">{structured.title || selectedDoc.document.title}</div>
                        </div>
                        <div className="intel-card">
                          <div className="intel-card-label">Date</div>
                          <div className="intel-card-value">{structured.date || "-"}</div>
                        </div>
                        <div className="intel-card">
                          <div className="intel-card-label">Intent</div>
                          <div className="intel-card-value">{structured.intent?.purpose || "-"} / {structured.intent?.mode || "-"}</div>
                        </div>
                        <div className="intel-card">
                          <div className="intel-card-label">AI Confidence</div>
                          <div className="intel-card-value">{((extraction.confidenceScore || 0) * 100).toFixed(0)}%</div>
                          <div className="confidence-bar-track">
                            <div className="confidence-bar-fill" style={{ width: `${(extraction.confidenceScore || 0) * 100}%`, background: (extraction.confidenceScore || 0) > 0.7 ? "var(--success)" : "var(--warning)" }} />
                          </div>
                        </div>
                      </div>
                      <div className="intel-card mb-3">
                        <div className="intel-card-label">AI Summary</div>
                        <div className="intel-card-value" style={{ fontSize: 13, fontWeight: 400, lineHeight: 1.6 }}>{structured.summary || "No summary extracted."}</div>
                      </div>
                      <div className="intel-card mb-3">
                        <div className="intel-card-label">Target Audience</div>
                        <div className="tag-list mt-2">
                          {(structured.targetAudience || []).map((a, i) => <span key={i} className="tag">{a}</span>)}
                          {(!structured.targetAudience || structured.targetAudience.length === 0) && <span className="text-sm text-muted">All users (no specific audience detected)</span>}
                        </div>
                      </div>
                      <div className="intel-card">
                        <div className="intel-card-label">Provider / Model</div>
                        <div className="flex gap-2 mt-2">
                          <span className={`badge ${extraction.provider}`}>{extraction.provider}</span>
                          <span className="badge secondary">{extraction.model}</span>
                        </div>
                      </div>
                    </>
                  )}

                  {/* SCHEDULE */}
                  {detailTab === "schedule" && (
                    <div className="data-table-wrap">
                      <table className="data-table">
                        <thead><tr><th>Event</th><th>Date</th><th>Time</th><th>Scope</th><th>Instructions</th><th>Conf.</th></tr></thead>
                        <tbody>
                          {events.map((ev, i) => (
                            <tr key={i}>
                              <td><strong>{ev.subjectName || ev.eventId || "-"}</strong></td>
                              <td>{ev.date || "TBA"}</td>
                              <td>{ev.startTime || "-"}{ev.endTime ? ` → ${ev.endTime}` : ""}</td>
                              <td>{(ev.departments || []).concat(ev.years || []).join(", ") || "-"}</td>
                              <td style={{ fontSize: 12, maxWidth: 200 }}>{ev.instructions || "-"}</td>
                              <td><span className={`badge ${(ev.confidence||0) > 0.7 ? "success" : "warning"}`}>{((ev.confidence||0)*100).toFixed(0)}%</span></td>
                            </tr>
                          ))}
                          {events.length === 0 && <tr><td colSpan={6} className="text-sm text-muted" style={{ textAlign: "center", padding: 40 }}>No schedule events extracted.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* ROUTING */}
                  {detailTab === "routing" && (
                    <div className="routing-flow">
                      <div className="routing-step">
                        <div className="routing-step-label">Step 1 — Document Analysis</div>
                        <p className="text-sm">AI identified this as a <strong>{structured.documentType || selectedDoc.document.docType}</strong> with intent: <strong>{structured.intent?.purpose}</strong></p>
                      </div>
                      <div className="routing-step">
                        <div className="routing-step-label">Step 2 — Audience Detection</div>
                        <div className="tag-list mt-2">{(structured.targetAudience || ["all users"]).map((a, i) => <span key={i} className="tag">{a}</span>)}</div>
                      </div>
                      <div className="routing-step">
                        <div className="routing-step-label">Step 3 — Condition Extraction</div>
                        <div className="tag-list mt-2">
                          {(structured.sections?.schedule || []).map((s, i) => (
                            <span key={i} className="tag" style={{ background: "#fef3c7", color: "#92400e" }}>
                              {s.semester || s.exam || s.students || JSON.stringify(s).slice(0, 60)}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="routing-step">
                        <div className="routing-step-label">Step 4 — Recipient Match</div>
                        <p className="text-sm"><strong>{selectedDoc.recipientCount || recipients.length}</strong> students/faculty matched the conditions above</p>
                      </div>
                    </div>
                  )}

                  {/* RECIPIENTS */}
                  {detailTab === "recipients" && (
                    <div className="data-table-wrap">
                      {loadingRecipients && <div className="inline-loading">Loading recipients...</div>}
                      <table className="data-table">
                        <thead><tr><th>User ID</th><th>Full Name</th><th>Role</th><th>Department</th><th>Year</th><th>Conditions</th><th>Status</th></tr></thead>
                        <tbody>
                          {recipients.map((r, i) => (
                            <tr key={i}>
                              <td>{r.userId}</td>
                              <td><strong>{r.userFullName}</strong></td>
                              <td><span className="badge secondary">{r.userRole}</span></td>
                              <td>{r.userDepartment || "-"}</td>
                              <td>{r.userYear || "-"}</td>
                              <td><div className="tag-list">{(r.matchedConditions || []).map(c => <span key={c} className="tag" style={{ fontSize: 10 }}>{c}</span>)}</div></td>
                              <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                            </tr>
                          ))}
                          {recipients.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: 40 }} className="text-sm text-muted">No recipients matched. Seed students first.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* RAW DATA */}
                  {detailTab === "raw" && <pre className="json-view">{JSON.stringify(extraction, null, 2)}</pre>}
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══ STUDENTS ═══ */}
        {view === "students" && (
          <>
            <div className="main-header">
              <div><h2>Student Directory</h2><p>Manage student profiles for intelligent notification routing</p></div>
              <div className="flex gap-2">
                <button className="btn btn-ghost btn-sm" onClick={seedStudents}>🌱 Seed Demo</button>
                <input type="file" accept=".csv" ref={csvRef} hidden onChange={e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => importCsv(ev.target.result); r.readAsText(f); }} />
                <button className="btn btn-ghost btn-sm" onClick={() => csvRef.current?.click()}>📥 Import CSV</button>
              </div>
            </div>
            <div className="main-body">
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead><tr><th>Reg. No</th><th>Name</th><th>Dept</th><th>Year</th><th>Sem</th><th>Gender</th><th>Hostel</th><th>Arrears</th><th>Category</th></tr></thead>
                  <tbody>
                    {students.map(s => (
                      <tr key={s._id}>
                        <td><strong>{s.registrationNo}</strong></td>
                        <td>{s.fullName}</td>
                        <td><span className="badge primary">{s.department || "-"}</span></td>
                        <td>{s.year || "-"}</td>
                        <td>{s.semester || "-"}</td>
                        <td>{s.gender || "-"}</td>
                        <td>{s.isHostelStudent ? "✅" : "❌"}</td>
                        <td>{s.hasArrears ? <span className="badge danger">YES</span> : "No"}</td>
                        <td>{s.category || "-"}</td>
                      </tr>
                    ))}
                    {students.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", padding: 40 }} className="text-sm text-muted">No students. Use "Seed Demo" or "Import CSV".</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ═══ NOTIFICATIONS ═══ */}
        {view === "notifications" && (
          <>
            <div className="main-header">
              <div><h2>Notifications</h2><p>Review pending approvals, scheduled deliveries, and delivery history</p></div>
              <div className="flex gap-2">
                <button className="btn btn-primary btn-sm" onClick={openCompose}>✍️ Compose</button>
                <button className={`btn ${notiTab === "queue" ? "btn-primary" : "btn-ghost"} btn-sm`} onClick={() => { setNotificationsRouteState("queue", historyStatusFilter); fetchScheduledNotifications(); }}>⏳ Queue ({pendingDocs.length + scheduledNotifications.length})</button>
                <button className={`btn ${notiTab === "history" ? "btn-primary" : "btn-ghost"} btn-sm`} onClick={() => { setNotificationsRouteState("history", historyStatusFilter); fetchNotificationHistory(historyStatusFilter); }}>✅ History</button>
              </div>
            </div>
            <div className="main-body">
              {notiTab === "queue" && (
                <>
                  <div className="section-card" style={{ marginBottom: 16 }}>
                    <div className="section-card-header"><div className="section-card-title">Pending approvals</div></div>
                    <div className="section-card-body">
                      {pendingDocs.length === 0 && <div className="empty-state"><div className="empty-state-icon">✅</div><h3>All clear!</h3><p>No pending approvals.</p></div>}
                      {pendingDocs.map(doc => (
                        <div key={doc.id} className="review-card urgent">
                          <div className="review-card-header">
                            <div><div className="review-card-title">{doc.title}</div><div className="review-card-meta">{doc.docType} · Uploaded {fmtDate(doc.createdAt)} · {doc.recipientCount || 0} recipients</div></div>
                            <span className={`badge ${doc.status}`}>{formatNotificationStatus(doc.status)}</span>
                          </div>
                          <div className="review-card-footer">
                            <span className="text-sm text-muted">AI Provider: <strong>{doc.provider}</strong> · Confidence: {((doc.confidenceScore || 0) * 100).toFixed(0)}%</span>
                            <div className="flex gap-2">
                              <button className="btn btn-warning btn-sm" onClick={() => openReview(doc)}>🔍 Review</button>
                              <button className="btn btn-ghost btn-sm" onClick={() => selectDoc(doc.id)}>View Details</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="section-card">
                    <div className="section-card-header"><div className="section-card-title">Scheduled deliveries</div></div>
                    <div className="section-card-body">
                      {scheduledNotifications.length === 0 && <div className="empty-state"><div className="empty-state-icon">⏳</div><h3>No scheduled deliveries</h3><p>Scheduled notifications will appear here.</p></div>}
                      {scheduledNotifications.length > 0 && (
                        <div className="data-table-wrap">
                          <table className="data-table">
                            <thead><tr><th>Notification</th><th>Recipient</th><th>Department</th><th>Conditions</th><th>Scheduled For</th></tr></thead>
                            <tbody>
                              {scheduledNotifications.map((n) => (
                                <tr key={n._id}>
                                  <td><strong>{n.documentTitle}</strong><div className="text-xs text-muted">{formatNotificationStatus(n.status)}</div></td>
                                  <td>{n.userFullName}</td>
                                  <td>{n.userDepartment || "-"}</td>
                                  <td><div className="tag-list">{(n.matchedConditions || []).map(c => <span key={c} className="tag" style={{ fontSize: 10 }}>{c}</span>)}</div></td>
                                  <td>{fmtDateTime(n.scheduledAt || n.createdAt)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
              {notiTab === "history" && (
                <div className="data-table-wrap">
                  <div className="flex gap-2 mb-3" style={{ flexWrap: "wrap" }}>
                    {[
                      ["delivered", "Delivered"],
                      ["scheduled", "Scheduled"],
                      ["pending", "Pending"],
                      ["failed", "Failed"],
                      ["skipped", "Skipped"],
                      ["all", "All"]
                    ].map(([status, label]) => (
                      <button
                        key={status}
                        className={`btn ${historyStatusFilter === status ? "btn-primary" : "btn-ghost"} btn-sm`}
                        onClick={() => { setNotificationsRouteState("history", status); fetchNotificationHistory(status); }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <table className="data-table">
                    <thead><tr><th>Notification</th><th>Recipient</th><th>Department</th><th>Status</th><th>Conditions</th><th>Event Time</th></tr></thead>
                    <tbody>
                      {sentHistory.map((n, i) => (
                        <tr key={i}>
                          <td><strong>{n.documentTitle}</strong></td>
                          <td>{n.userFullName}</td>
                          <td>{n.userDepartment || "-"}</td>
                          <td><span className={`badge ${n.status}`}>{formatNotificationStatus(n.status)}</span></td>
                          <td><div className="tag-list">{(n.matchedConditions || []).map(c => <span key={c} className="tag" style={{ fontSize: 10 }}>{c}</span>)}</div></td>
                          <td>{fmtDateTime(getNotificationEventTime(n))}</td>
                        </tr>
                      ))}
                      {sentHistory.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 40 }} className="text-sm text-muted">No notifications found for this status.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ═══ SETTINGS ═══ */}
        {view === "settings" && (
          <>
            <div className="main-header"><div><h2>Settings</h2><p>AI provider config and system settings</p></div></div>
            <div className="main-body">
              <div className="section-card" style={{ maxWidth: 500 }}>
                <div className="section-card-header"><div className="section-card-title">🤖 AI Provider</div></div>
                <div className="section-card-body">
                  <div className="form-group">
                    <label className="form-label">Default Provider</label>
                    <select className="form-select" value={uProvider} onChange={e => setUProvider(e.target.value)}>
                      <option value="ollama">Local AI (Qwen2.5-VL 3B via Ollama)</option>
                      <option value="gemini">Cloud AI (Gemini)</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-3 mt-3">
                    <div className={`ai-dot ${aiStatus}`} style={{ width: 14, height: 14 }} />
                    <span className="text-sm">Ollama Status: <strong>{aiStatus === "online" ? "Connected" : aiStatus === "checking" ? "Checking..." : "Offline"}</strong></span>
                    <button className="btn btn-ghost btn-sm" onClick={checkAi}>Refresh</button>
                  </div>
                </div>
              </div>

              <div className="section-card" style={{ maxWidth: 500 }}>
                <div className="section-card-header"><div className="section-card-title">⚙️ Workflow Configuration</div></div>
                <div className="section-card-body">
                  <label className="flex items-center gap-2 mb-3 cursor-pointer text-sm">
                    <input type="checkbox" checked={aiEnabled} onChange={e => updateSetting("aiEnabled", e.target.checked)} />
                    <strong>Enable AI Processing</strong>
                    <span className="text-muted ml-1">(If disabled, only local text heuristics run)</span>
                  </label>
                  <label className="flex items-center gap-2 mb-3 cursor-pointer text-sm">
                    <input type="checkbox" checked={useFallbacks} onChange={e => updateSetting("useFallbacks", e.target.checked)} disabled={!aiEnabled} />
                    <strong>Use AI Fallbacks</strong>
                    <span className="text-muted ml-1">(Try Groq/OpenRouter if primary fails)</span>
                  </label>
                  <label className="flex items-center gap-2 mb-3 cursor-pointer text-sm">
                    <input type="checkbox" checked={skipHybridOcr} onChange={e => updateSetting("skipHybridOcr", e.target.checked)} />
                    <span>
                      <strong>Skip Hybrid OCR</strong>
                      <span className="text-muted ml-1">(Bypass Python text extraction and send raw PDF directly to the selected AI's visual engine)</span>
                    </span>
                  </label>
                  <label className="flex items-center gap-2 mb-3 cursor-pointer text-sm">
                    <input type="checkbox" checked={bypassPdfParse} onChange={e => updateSetting("bypassPdfParse", e.target.checked)} />
                    <span>
                      <strong>Bypass PDF-Parse</strong>
                      <span className="text-muted ml-1">(Do not extract text with Node whatsoever. Send raw document purely to Local AI Vision/Gemini.)</span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* ═══ UPLOAD MODAL (steps 1 & 2 only — non-blocking) ═══ */}
      {showUpload && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowUpload(false); }}>
          <div className="modal">
            <div className="modal-header"><div className="modal-title">📤 Upload Document</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowUpload(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="wizard-steps">{[1,2].map(s => <div key={s} className={`wizard-step-dot ${wizStep > s ? "done" : wizStep === s ? "active" : ""}`} />)}</div>

              {wizStep === 1 && (
                <>
                  <div className="form-group"><label className="form-label">Title</label><input className="form-input" value={uTitle} onChange={e => setUTitle(e.target.value)} placeholder="Document title" /></div>
                  <div className="form-group"><label className="form-label">Type</label><select className="form-select" value={uDocType} onChange={e => setUDocType(e.target.value)}><option value="circular">Circular</option><option value="exam_timetable">Timetable</option><option value="notice">Notice</option></select></div>
                  <div className="form-group"><label className="form-label">AI Model</label><select className="form-select" value={uProvider} onChange={e => setUProvider(e.target.value)}><option value="ollama">Local AI (Mistral)</option><option value="gemini">Cloud AI (Gemini)</option></select></div>
                  <button className="btn btn-primary btn-full mt-3" onClick={() => setWizStep(2)}>Next →</button>
                </>
              )}

              {wizStep === 2 && (
                <>
                  <div className="form-group">
                    <label className="form-label">Select PDF File</label>
                    <input type="file" accept=".pdf" className="form-input" onChange={e => setUFile(e.target.files?.[0] || null)} />
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button className="btn btn-ghost" onClick={() => setWizStep(1)}>← Back</button>
                    <button className="btn btn-primary" disabled={!uFile} onClick={handleUpload} style={{ flex: 1 }}>Upload & Analyze</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ FLOATING PROGRESS WIDGET (non-blocking) ═══ */}
      {jobProgress && (
        <div className="floating-progress">
          <div className="floating-progress-header">
            <div className={`progress-step-label ${jobProgress.stage !== "done" && jobProgress.stage !== "error" ? "spinning" : ""}`}>
              {jobProgress.stage === "done" ? "✅" : jobProgress.stage === "error" ? "❌" : "🔔"} {jobProgress.label || "Processing..."}
            </div>
            {(jobProgress.stage !== "done" && jobProgress.stage !== "error") && (
              <button className="btn btn-ghost btn-sm text-danger" style={{ padding: "2px 6px", fontSize: 11 }} onClick={cancelJob}>✕ Cancel</button>
            )}
            {(jobProgress.stage === "done" || jobProgress.stage === "error") && (
              <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", fontSize: 11 }} onClick={() => { setJobId(null); setJobProgress(null); }}>✕</button>
            )}
          </div>
          <div className="progress-track" style={{ height: 6 }}>
            <div className={`progress-fill ${jobProgress.stage === "done" ? "done" : jobProgress.stage === "error" ? "error" : ""}`} style={{ width: `${jobProgress.pct || 5}%` }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span className="progress-pct">{jobProgress.pct || 0}%{jobProgress.elapsedSec ? ` · ${jobProgress.elapsedSec}s` : ""}</span>
            {jobProgress.estimatedRemainingSec > 0 && <span className="progress-eta">ETA: {fmtTime(jobProgress.estimatedRemainingSec)}</span>}
          </div>
        </div>
      )}

      {/* ═══ REVIEW PANEL (replaces old approval modal) ═══ */}
      {showReview && (
        <Suspense fallback={<div className="modal-overlay"><div className="modal">Loading review panel...</div></div>}>
          <ReviewPanel
            tenantId={tenantId}
            authToken={token}
            doc={showReview.doc}
            extraction={showReview.extraction || extraction}
            recipients={showReview.recipients || recipients}
            initialTab={showReview.initialTab}
            onAction={handleReviewAction}
            onClose={() => {
              setShowReview(null);
              if (showReview?.doc?.id) {
                navigate(`/documents/${encodeURIComponent(showReview.doc.id)}`);
              } else {
                navigate("/documents");
              }
            }}
          />
        </Suspense>
      )}

      {/* ═══ COMPOSE MODAL ═══ */}
      {isComposeRoute && (
        <Suspense fallback={<div className="modal-overlay"><div className="modal">Loading composer...</div></div>}>
          <ComposeModal
            tenantId={tenantId}
            authToken={token}
            onClose={closeCompose}
            onSent={() => { fetchDocs(); fetchScheduledNotifications(); fetchNotificationHistory(historyStatusFilter); }}
          />
        </Suspense>
      )}

      {/* ═══ ERROR TOAST ═══ */}
      {error && (
        <div style={{ position: "fixed", bottom: 20, right: 20, padding: "12px 24px", background: "#fee2e2", color: "#991b1b", borderRadius: 12, border: "1px solid #fca5a5", boxShadow: "var(--shadow-lg)", zIndex: 200, cursor: "pointer" }} onClick={() => setError("")}>
          {error}
        </div>
      )}

      {/* ═══ EDIT DOCUMENT MODAL ═══ */}
      {showEditDoc && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowEditDoc(false); }}>
          <div className="modal" style={{ width: 520 }}>
            <div className="modal-header">
              <div className="modal-title">✏️ Edit Document</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowEditDoc(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Title</label>
                <input
                  className="form-input"
                  value={editDocTitle}
                  onChange={e => setEditDocTitle(e.target.value)}
                  placeholder="Document title"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-select" value={editDocType} onChange={e => setEditDocType(e.target.value)}>
                  <option value="circular">Circular</option>
                  <option value="exam_timetable">Timetable</option>
                  <option value="notice">Notice</option>
                  <option value="fee_reminder">Fee Reminder</option>
                  <option value="general">General</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowEditDoc(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={savingDoc} onClick={saveDocumentChanges}>
                {savingDoc ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
