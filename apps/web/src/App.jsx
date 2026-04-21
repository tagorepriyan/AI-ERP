import { useEffect, useMemo, useState, useCallback, useRef, lazy, Suspense } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

const LoginPage = lazy(() => import("./LoginPage"));
const ReviewPanel = lazy(() => import("./ReviewPanel"));
const ComposeModal = lazy(() => import("./ComposeModal"));

const API = import.meta.env.VITE_API_BASE_URL || `${location.protocol}//${location.hostname}:4000`;
const APP_SECTIONS = ["dashboard", "documents", "students", "notifications", "settings"];
const DOCUMENT_TABS = ["intelligence", "trace", "schedule", "routing", "recipients", "raw"];
const NOTIFICATION_TABS = ["queue", "history"];
const HISTORY_STATUSES = ["delivered", "scheduled", "pending", "failed", "skipped", "all"];
const DEFAULT_WORKFLOW_SETTINGS = {
  fastMode: true,
  skipHybridOcr: true,
  bypassPdfParse: false,
  aiEnabled: true,
  useFallbacks: false
};

function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString();
}

function fmtTime(sec) {
  if (!sec || sec <= 0) return "< 1s";
  if (sec < 60) return `~${Math.round(sec)}s`;
  return `~${Math.round(sec / 60)}m`;
}

function getProgressHint(progress) {
  if (!progress || progress.stage === "done" || progress.stage === "error") {
    return "";
  }

  const provider = String(progress.uploadProvider || "ollama").toLowerCase();
  const isLocalProvider = provider === "ollama";

  if (progress.stage === "upload") {
    if (progress.uploadPhase === "awaiting_ack") {
      return "File transfer finished. Waiting for server acknowledgement before background processing starts.";
    }
    return "Uploading file bytes to server. Parsing/OCR/AI starts only after acknowledgement.";
  }

  if (progress.stage === "processing") {
    return isLocalProvider
      ? "Server acknowledged upload. Starting Local AI pipeline now."
      : "Server acknowledged upload. Starting OCR and cloud AI pipeline now.";
  }

  if (progress.stage === "parse") {
    return "Parsing PDF structure and metadata.";
  }

  if (progress.stage === "ocr") {
    return "Extracting text with OCR. Scanned pages can take longer in this step.";
  }

  if (progress.stage === "ai") {
    return isLocalProvider
      ? "Running Local AI analysis. Live text below shows conversion and generation progress."
      : "Running cloud AI extraction. Live text below streams model progress.";
  }

  if (progress.stage === "routing") {
    return "Computing recipient routing from extracted intelligence.";
  }

  if (progress.stage === "saving") {
    return "Saving extraction and routing results.";
  }

  return "";
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
  const authToken = sessionStorage.getItem("notify_token") || "";
  const [tenantId] = useState("default-campus");
  const headers = useMemo(() => {
    const h = { "x-tenant-id": tenantId };
    if (authToken) h["Authorization"] = `Bearer ${authToken}`;
    return h;
  }, [tenantId, authToken]);
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
  const [editDocId, setEditDocId] = useState(null);
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
  const docDetailCacheRef = useRef(new Map());
  const docDetailAbortRef = useRef(null);
  const uploadAttemptRef = useRef(null);

  // CSV import
  const csvRef = useRef();

  // Workflow Settings
  const [settings, setSettings] = useState(() => {
    try {
      return { ...DEFAULT_WORKFLOW_SETTINGS, ...(JSON.parse(localStorage.getItem("notify_settings")) || {}) };
    } catch {
      return { ...DEFAULT_WORKFLOW_SETTINGS };
    }
  });
  const fastMode = settings.fastMode !== false;
  const skipHybridOcr = settings.skipHybridOcr || false;
  const bypassPdfParse = settings.bypassPdfParse || false;
  const aiEnabled = settings.aiEnabled !== false;
  const useFallbacks = settings.useFallbacks !== false;

  const updateSetting = (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("notify_settings", JSON.stringify(next));
  };

  useEffect(() => {
    if (!jobProgress || jobProgress.stage !== "upload") return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setJobProgress((prev) => {
        if (!prev || prev.stage !== "upload") return prev;
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        const waitingForAck = prev.uploadPhase === "awaiting_ack";
        const baseline = waitingForAck
          ? Math.max(prev.pct || 64, Math.min(67, 64 + Math.floor(elapsed / 15)))
          : Math.min(60, Math.max(prev.pct || 8, 8 + Math.floor(elapsed / 3)));
        const label = waitingForAck
          ? `Upload transfer complete... waiting for server acknowledgement (${elapsed}s)`
          : `Uploading document to server... ${elapsed}s`;
        return { ...prev, pct: baseline, label };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [jobProgress?.stage]);

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
      const items = d.items || [];
      setDocs(items);
      return items;
    } catch (e) {
      console.error(e);
      return [];
    }
  }, [headers]);

  const fetchStudents = useCallback(async () => {
    try {
      const r = await fetch(`${API}/students`, { headers });
      const d = await r.json();
      setStudents(d.students || []);
    } catch (e) { console.error(e); }
  }, [headers]);

  const fetchDocDetail = useCallback(async (id, options = {}) => {
    const { force = false, apply = true, signal } = options;
    const cached = !force ? docDetailCacheRef.current.get(id) : null;
    if (cached) {
      if (apply) setSelectedDoc(cached);
      return cached;
    }

    if (apply) setLoadingDocDetail(true);
    try {
      const r = await fetch(`${API}/documents/${id}`, { headers, signal });
      const d = await r.json();
      docDetailCacheRef.current.set(id, d);
      if (apply) setSelectedDoc(d);
      return d;
    } catch (e) {
      if (e?.name !== "AbortError") console.error(e);
      return null;
    } finally {
      if (apply) setLoadingDocDetail(false);
    }
  }, [headers]);

  const fetchRecipients = useCallback(async (id) => {
    try {
      const r = await fetch(`${API}/notifications/document/${id}`, { headers });
      const d = await r.json();
      const notifications = d.notifications || [];
      setRecipients(notifications);
      return notifications;
    } catch (e) { console.error(e); }
    return [];
  }, [headers]);

  const prefetchDocDetail = useCallback((id) => {
    if (!id || docDetailCacheRef.current.has(id)) return;
    fetchDocDetail(id, { apply: false }).catch(() => {});
  }, [fetchDocDetail]);

  const fetchSentHistory = useCallback(async () => {
    try {
      const r = await fetch(`${API}/notifications?status=delivered`, { headers });
      const d = await r.json();
      setSentHistory(d.notifications || []);
    } catch (e) { console.error(e); }
  }, [headers]);

  const fetchScheduledNotifications = useCallback(async () => {
    try {
      const r = await fetch(`${API}/notifications?status=scheduled`, { headers });
      const d = await r.json();
      setScheduledNotifications(d.notifications || []);
    } catch (e) { console.error(e); }
  }, [headers]);

  const fetchNotificationHistory = useCallback(async (status = "delivered") => {
    try {
      const url = status === "all"
        ? `${API}/notifications`
        : `${API}/notifications?status=${encodeURIComponent(status)}`;
      const r = await fetch(url, { headers });
      const d = await r.json();
      setSentHistory(d.notifications || []);
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
    setRecipients([]);
    setRecipientsLoadedDocId(null);

    if (!routedDocId) {
      setSelectedDoc(null);
      return;
    }

    const cached = docDetailCacheRef.current.get(routedDocId);
    setSelectedDoc(cached || null);

    if (docDetailAbortRef.current) {
      docDetailAbortRef.current.abort();
    }
    const controller = new AbortController();
    docDetailAbortRef.current = controller;
    fetchDocDetail(routedDocId, { signal: controller.signal });

    return () => {
      controller.abort();
    };
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
  const parserOutput = selectedDoc?.latestVersion?.parserOutput || {};
  const extraction = selectedDoc?.latestVersion?.extraction || {};
  const structured = extraction?.structured || {};
  const events = extraction?.events || [];
  const extractionWarnings = Array.isArray(extraction?.warnings) ? extraction.warnings : [];
  const extractionStatus = extraction?.status || "pending";
  const hasStructuredSections = useMemo(
    () => Object.values(structured?.sections || {}).some((section) => Array.isArray(section) && section.length > 0),
    [structured]
  );
  const scheduleRows = Array.isArray(structured.sections?.schedule) ? structured.sections.schedule : [];
  const scheduleTimeline = useMemo(() => {
    const source = scheduleRows.length > 0 ? scheduleRows : events;
    const normalized = source
      .map((item) => ({
        date: item?.date || "TBA",
        startTime: item?.startTime || "",
        endTime: item?.endTime || "",
        subjectName: item?.subjectName || item?.title || item?.eventId || "Untitled event",
        subjectCode: item?.subjectCode || "",
        instructions: item?.instructions || "",
        departments: Array.isArray(item?.departments) ? item.departments : [],
        years: Array.isArray(item?.years) ? item.years : [],
        sections: Array.isArray(item?.sections) ? item.sections : [],
        confidence: Number(item?.confidence || 0)
      }))
      .filter((item) => item.subjectName || item.subjectCode || item.date !== "TBA");

    const grouped = new Map();
    normalized.forEach((entry) => {
      const key = entry.date || "TBA";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(entry);
    });

    return Array.from(grouped.entries()).map(([date, items]) => ({ date, items }));
  }, [scheduleRows, events]);
  const scheduleStats = useMemo(() => {
    const allItems = scheduleTimeline.flatMap((bucket) => bucket.items);
    const departments = new Set();
    allItems.forEach((item) => (item.departments || []).forEach((dep) => departments.add(dep)));

    return {
      dayCount: scheduleTimeline.length,
      eventCount: allItems.length,
      departmentCount: departments.size,
      confidence: allItems.length ? Math.round((allItems.reduce((sum, item) => sum + (item.confidence || 0), 0) / allItems.length) * 100) : 0
    };
  }, [scheduleTimeline]);

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
    setJobProgress({ pct: 8, label: "Preparing upload...", stage: "upload", uploadPhase: "transfer", uploadProvider: uProvider });
    
    // Per-request key to gate all XHR callbacks and prevent stale handlers from older uploads
    const attemptKey = `upload-${Date.now()}-${Math.random()}`;
    const isActiveAttempt = () => uploadAttemptRef.current?.key === attemptKey;
    
    uploadAttemptRef.current = {
      key: attemptKey,
      title: (uTitle || uFile?.name || "").trim(),
      fileName: (uFile?.name || "").trim(),
      startedAt: Date.now(),
      provider: uProvider,
      acknowledged: false,
      jobId: null
    };

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}/documents/upload`);
    xhr.setRequestHeader("x-tenant-id", tenantId);
    if (authToken) {
      xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
    }
    // Disable XHR timeout because slower networks / larger files can legitimately
    // take longer before the server can acknowledge upload completion.
    xhr.timeout = 0;

    xhr.upload.onprogress = (e) => {
      if (!isActiveAttempt() || !e.lengthComputable) return;
      const percent = 8 + Math.round((e.loaded / e.total) * 52);
      setJobProgress((prev) => prev ? { ...prev, pct: Math.min(percent, 60), label: "Uploading document to server...", uploadPhase: "transfer" } : prev);
    };

    xhr.onload = () => {
      if (!isActiveAttempt()) return;
      try {
        const d = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) {
          if (d.jobId) {
            // Mark this attempt as acknowledged so late transport errors don't override it
            if (uploadAttemptRef.current) {
              uploadAttemptRef.current.acknowledged = true;
              uploadAttemptRef.current.jobId = d.jobId;
            }
            setJobId(d.jobId);
            setJobProgress((prev) => prev
              ? {
                  ...prev,
                  pct: Math.max(prev.pct || 0, 68),
                  label: uProvider === "ollama"
                    ? "Upload acknowledged. Local AI pipeline is starting..."
                    : "Upload acknowledged. Cloud AI pipeline is starting...",
                  stage: "processing",
                  uploadPhase: "acknowledged",
                  uploadProvider: uProvider
                }
              : {
                  pct: 68,
                  label: uProvider === "ollama"
                    ? "Upload acknowledged. Local AI pipeline is starting..."
                    : "Upload acknowledged. Cloud AI pipeline is starting...",
                  stage: "processing",
                  uploadPhase: "acknowledged",
                  uploadProvider: uProvider
                });
          } else {
            uploadAttemptRef.current = null;
            setJobProgress({ pct: 100, label: "Done", stage: "done" });
            fetchDocs();
          }
          return;
        }

        uploadAttemptRef.current = null;
        setJobProgress({ pct: 0, label: `Error: ${d?.error?.message || d?.error || `Upload failed (HTTP ${xhr.status})`}`, stage: "error" });
      } catch (e) {
        uploadAttemptRef.current = null;
        setJobProgress({ pct: 0, label: "Error: Unable to parse upload response", stage: "error" });
      }
    };

    xhr.onerror = () => {
      if (!isActiveAttempt()) return;
      
      // If server already acknowledged, don't show hard error. Show soft notification instead.
      const attempt = uploadAttemptRef.current;
      if (attempt?.acknowledged) {
        setJobProgress((prev) => prev ? {
          ...prev,
          label: "Connection hiccup after acknowledgement. Continuing background processing...",
          uploadPhase: "acknowledged"
        } : prev);
        return;
      }
      
      uploadAttemptRef.current = null;
      setJobProgress({ pct: 0, label: "Error: Network error while uploading document", stage: "error" });
    };

    xhr.upload.onload = () => {
      if (!isActiveAttempt()) return;
      setJobProgress((prev) => prev
        ? { ...prev, pct: Math.max(prev.pct || 0, 64), label: "Upload transfer finished. Waiting for server acknowledgement...", stage: "upload", uploadPhase: "awaiting_ack" }
        : { pct: 64, label: "Upload transfer finished. Waiting for server acknowledgement...", stage: "upload", uploadPhase: "awaiting_ack", uploadProvider: uProvider });
    };

    xhr.ontimeout = () => {
      if (!isActiveAttempt()) return;
      
      // If server already acknowledged, don't show timeout error. Show soft notification instead.
      const attempt = uploadAttemptRef.current;
      if (attempt?.acknowledged) {
        setJobProgress((prev) => prev ? {
          ...prev,
          label: "Connection timeout after acknowledgement. Continuing background processing...",
          uploadPhase: "acknowledged"
        } : prev);
        return;
      }
      
      uploadAttemptRef.current = null;
      setJobProgress({ pct: 0, label: "Error: Upload timed out before server accepted the file", stage: "error" });
    };

    xhr.send(fd);
  }

  async function cancelJob() {
    if (!jobId) return;
    try {
      await fetch(`${API}/jobs/${jobId}/cancel`, { method: "POST", headers: jsonHeaders });
      uploadAttemptRef.current = null;
      setJobId(null);
      setJobProgress({ pct: 0, label: "Cancelled by user", stage: "error" });
    } catch(e) {}
  }

  // Poll job progress
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let consecutiveFailures = 0;
    let consecutive404 = 0;

    const tryRecoverFromMissingJob = async () => {
      const items = await fetchDocs();
      const attempt = uploadAttemptRef.current;
      if (!attempt) {
        return false;
      }

      const attemptTitle = (attempt.title || "").toLowerCase();
      const startedAt = Number(attempt.startedAt || 0);

      const exactTitleMatch = items.find((doc) => (doc.title || "").trim().toLowerCase() === attemptTitle);
      const closestByTime = items
        .filter((doc) => {
          const createdAt = new Date(doc.createdAt || 0).getTime();
          return Number.isFinite(createdAt) && startedAt > 0 && Math.abs(createdAt - startedAt) <= 20 * 60 * 1000;
        })
        .sort((a, b) => {
          const aDelta = Math.abs(new Date(a.createdAt || 0).getTime() - startedAt);
          const bDelta = Math.abs(new Date(b.createdAt || 0).getTime() - startedAt);
          return aDelta - bDelta;
        })[0];

      const recoveredDoc = exactTitleMatch || closestByTime;
      if (!recoveredDoc) {
        return false;
      }

      if (!active) {
        return true;
      }

      setJobId(null);
      setJobProgress({
        pct: 100,
        stage: "done",
        label: "Processing finished. Progress tracker reset; recovered from document list."
      });
      setSelectedDocId(recoveredDoc.id);
      navigate(`/documents/${encodeURIComponent(recoveredDoc.id)}`);
      uploadAttemptRef.current = null;
      return true;
    };

    const poll = async () => {
      try {
        const r = await fetch(`${API}/jobs/${jobId}`, { headers });
        if (!r.ok) {
          consecutiveFailures += 1;
          if (r.status === 404) {
            consecutive404 += 1;
          } else {
            consecutive404 = 0;
          }

          if (active && r.status === 404 && consecutive404 >= 5) {
            const recovered = await tryRecoverFromMissingJob();
            if (recovered) {
              return;
            }
          }

          if (active && consecutiveFailures >= 20) {
            setJobProgress((prev) => prev ? {
              ...prev,
              stage: "error",
              label: `Error: Unable to read job progress (HTTP ${r.status})`,
              pct: 0
            } : prev);
            return;
          }
          if (active) {
            setJobProgress((prev) => prev ? {
              ...prev,
              label: `Waiting for processor... (HTTP ${r.status})`
            } : prev);
            setTimeout(poll, 1000);
          }
          return;
        }

        consecutiveFailures = 0;
        consecutive404 = 0;
        const job = await r.json();
        if (active) {
          setJobProgress((prev) => ({
            ...job,
            uploadProvider: uploadAttemptRef.current?.provider || prev?.uploadProvider || "ollama"
          }));
        }
        if (job.stage === "done" || job.stage === "error") {
          uploadAttemptRef.current = null;
          fetchDocs();
          return;
        }
        if (active) setTimeout(poll, 800);
      } catch {
        consecutiveFailures += 1;
        if (active && consecutiveFailures >= 20) {
          setJobProgress((prev) => prev ? {
            ...prev,
            stage: "error",
            label: "Error: Lost connection while reading job progress",
            pct: 0
          } : prev);
          return;
        }
        if (active) {
          setJobProgress((prev) => prev ? {
            ...prev,
            label: "Reconnecting to processor..."
          } : prev);
          setTimeout(poll, 2000);
        }
      }
    };
    poll();
    return () => { active = false; };
  }, [jobId, headers, fetchDocs, navigate]);

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
        docDetailCacheRef.current.delete(docId);
        await fetchDocDetail(docId, { force: true });
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
      docDetailCacheRef.current.delete(selectedDocId);
      fetchDocDetail(selectedDocId, { force: true });
      if (detailTab === "recipients") fetchRecipients(selectedDocId);
    }
  }

  function openEditDocument() {
    if (!selectedDoc?.document) return;
    setEditDocId(selectedDoc.document.id);
    setEditDocTitle(selectedDoc.document.title || "");
    setEditDocType(selectedDoc.document.docType || "circular");
    setShowEditDoc(true);
  }

  async function saveDocumentChanges() {
    const targetId = editDocId || selectedDoc?.document?.id;
    if (!targetId || savingDoc) return;
    const title = editDocTitle.trim();
    if (!title) {
      setError("Document title cannot be empty");
      return;
    }
    setSavingDoc(true);
    try {
      const r = await fetch(`${API}/documents/${targetId}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ title, docType: editDocType })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message || "Failed to update document");

      setShowEditDoc(false);
      setEditDocId(null);
      await fetchDocs();
      docDetailCacheRef.current.delete(targetId);
      if (selectedDoc?.document?.id === targetId) {
        await fetchDocDetail(targetId, { force: true });
        if (detailTab === "recipients") await fetchRecipients(targetId);
      }
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
      docDetailCacheRef.current.delete(docId);
      if (editDocId === docId) setEditDocId(null);
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
    const cached = docDetailCacheRef.current.get(id);
    if (cached) {
      setSelectedDocId(id);
      setSelectedDoc(cached);
    }
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

  const progressHint = getProgressHint(jobProgress);

  if (!authed) {
    return (
      <Suspense fallback={<div className="app-loading">Loading login...</div>}>
        <LoginPage onLogin={(payload) => {
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
    { id: "notifications", icon: "🔔", label: "Notifications", badge: pendingDocs.length || null },
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
        <button className="nav-item" onClick={() => { sessionStorage.removeItem("notify_auth"); sessionStorage.removeItem("notify_token"); setAuthed(false); navigate("/login", { replace: true }); }} title="Logout">🚪</button>
      </nav>

      {/* ── Context Panel ─────────────────────────────────────── */}
      {(view === "documents" || view === "dashboard") && (
        <aside className="context-panel">
          <div className="panel-header">
            <div className="panel-title">Documents</div>
            <div className="panel-search">
              <span className="panel-search-icon">🔍</span>
              <input placeholder="Search documents..." />
            </div>
          </div>
          <div className="panel-body">
            {docs.map(doc => (
              <div key={doc.id} className={`doc-item ${selectedDocId === doc.id ? "active" : ""}`} onMouseEnter={() => prefetchDocDetail(doc.id)} onClick={() => selectDoc(doc.id)}>
                <div className="doc-item-main">
                  <div className="doc-item-title">{doc.title}</div>
                  <div className="doc-item-meta">
                    <span className={`badge ${doc.status}`}>{doc.status.replace(/_/g, " ")}</span>
                    <span className="badge secondary">{doc.docType}</span>
                    {doc.recipientCount > 0 && <span className="text-sm text-muted">👥 {doc.recipientCount}</span>}
                  </div>
                </div>
                <div className="doc-item-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn" title="Edit document" onClick={() => { setSelectedDocId(doc.id); setEditDocId(doc.id); setEditDocTitle(doc.title || ""); setEditDocType(doc.docType || "circular"); setShowEditDoc(true); selectDoc(doc.id); }}>✎</button>
                  <button className="icon-btn danger" title="Delete document" onClick={() => deleteDocument(doc.id)}>🗑</button>
                </div>
              </div>
            ))}
            {docs.length === 0 && <div className="empty-state"><p>No documents uploaded yet.</p></div>}
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
            {!selectedDoc ? (
              selectedDocId && loadingDocDetail ? (
                <div className="empty-state" style={{ flex: 1 }}><div className="empty-state-icon">⏳</div><h3>Loading document...</h3><p>Fetching AI analysis and routing details.</p></div>
              ) : (
              <div className="empty-state" style={{ flex: 1 }}><div className="empty-state-icon">📄</div><h3>Select a document</h3><p>Choose a document from the sidebar to view its AI analysis and routing details.</p></div>
              )
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
                    <div className="flex gap-2" style={{ alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <span className={`badge ${selectedDoc.document.status}`}>{selectedDoc.document.status?.replace(/_/g, " ")}</span>
                      <button className="btn btn-ghost btn-sm" onClick={openEditDocument}>✎ Edit</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => deleteDocument(selectedDoc.document.id)}>🗑 Delete</button>
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
                      {["file", "intelligence", "trace", "schedule", "routing", "recipients", "raw"].map(t => (
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
                        {t === "file"
                          ? "📄 File"
                          : t === "intelligence"
                            ? "🧠 Intelligence"
                            : t === "trace"
                              ? "🔎 AI Trace"
                              : t === "schedule"
                                ? "📅 Schedule"
                                : t === "routing"
                                  ? "🔀 Routing"
                                  : t === "recipients"
                                    ? `👥 Recipients (${recipients.length})`
                                    : "{ } Raw Data"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="detail-body">
                  {/* FILE VIEWER */}
                  {detailTab === "file" && (
                    <div className="file-viewer-wrapper" style={{ height: "100%", minHeight: "600px", background: "var(--main-bg)", borderRadius: 8, overflow: "hidden" }}>
                      {selectedDoc?.document?.id ? (
                        <iframe
                          key={selectedDoc.document.id}
                          src={`${API}/documents/${selectedDoc.document.id}/file?token=${authToken}`}
                          style={{ width: "100%", height: "100%", border: "none" }}
                          title={selectedDoc.document.title}
                        />
                      ) : (
                        <div className="empty-state">File unavailable</div>
                      )}
                    </div>
                  )}

                  {/* INTELLIGENCE */}
                  {detailTab === "intelligence" && (
                    <>
                      <div className="intelligence-grid">
                        <div className="intel-card">
                          <div className="intel-card-label">Document Title</div>
                          <div className="intel-card-value">{selectedDoc.document.title || structured.title}</div>
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

                  {/* TRACE */}
                  {detailTab === "trace" && (
                    <>
                      <div className="intelligence-grid mb-3">
                        <div className="intel-card">
                          <div className="intel-card-label">Processing Status</div>
                          <div className="flex gap-2 mt-2">
                            <span className={`badge ${extractionStatus === "completed" ? "success" : extractionStatus === "failed" ? "failed" : "pending"}`}>{extractionStatus}</span>
                            <span className={`badge ${extraction.provider || "secondary"}`}>{extraction.provider || "unknown"}</span>
                          </div>
                        </div>
                        <div className="intel-card">
                          <div className="intel-card-label">Model</div>
                          <div className="intel-card-value">{extraction.model || "-"}</div>
                        </div>
                        <div className="intel-card">
                          <div className="intel-card-label">Parser Stats</div>
                          <div className="intel-card-value">{parserOutput.pageCount || 0} pages</div>
                          <div className="text-sm text-muted mt-1">{(parserOutput.rawTextLength || 0).toLocaleString()} chars extracted</div>
                        </div>
                        <div className="intel-card">
                          <div className="intel-card-label">Trace Coverage</div>
                          <div className="intel-card-value">{events.length} events</div>
                          <div className="text-sm text-muted mt-1">{hasStructuredSections ? "Structured sections detected" : "No structured sections"}</div>
                        </div>
                      </div>

                      <div className="intel-card mb-3">
                        <div className="intel-card-label">Warnings</div>
                        {extractionWarnings.length > 0 ? (
                          <ul style={{ marginTop: 10, paddingLeft: 18, display: "grid", gap: 8 }}>
                            {extractionWarnings.map((warning, index) => (
                              <li key={index} className="text-sm" style={{ color: "var(--warning-text, #92400e)" }}>{warning}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-sm text-muted mt-2">No warnings emitted by the extractor.</div>
                        )}
                      </div>

                      <div className="intel-card">
                        <div className="intel-card-label">Line-by-Line Extraction Trace</div>
                        {events.length > 0 ? (
                          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                            {events.map((event, index) => (
                              <div key={event.eventId || index} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "var(--main-bg)" }}>
                                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
                                  {index + 1}. {event.subjectName || event.subjectCode || event.eventId || "Untitled event"}
                                </div>
                                <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                                  {event.date || "TBA"} {event.startTime ? `• ${event.startTime}` : ""}{event.endTime ? ` → ${event.endTime}` : ""}
                                </div>
                                <div className="text-sm" style={{ marginTop: 4 }}>
                                  {(event.departments || []).concat(event.years || []).concat(event.sections || []).filter(Boolean).join(" • ") || "General audience"}
                                </div>
                                {event.instructions && <div className="text-sm text-muted" style={{ marginTop: 4 }}>Note: {event.instructions}</div>}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-muted mt-2">No extracted events are available for this document.</div>
                        )}
                      </div>
                    </>
                  )}

                  {/* SCHEDULE */}
                  {detailTab === "schedule" && (
                    <div className="schedule-workspace">
                      <div className="schedule-hero">
                        <div>
                          <div className="schedule-eyebrow">📅 Schedule Intelligence</div>
                          <h3>{structured.title || selectedDoc.document.title}</h3>
                          <p>{structured.summary || "The extracted timetable is grouped by day for faster review, approval, and routing checks."}</p>
                        </div>
                        <div className="schedule-hero-pill">
                          <span className={`badge ${extraction.provider}`}>{extraction.provider || "unknown"}</span>
                          <span className="badge secondary">{scheduleStats.eventCount} events</span>
                        </div>
                      </div>

                      <div className="schedule-stats-grid">
                        <div className="intel-card compact"><div className="intel-card-label">Days Covered</div><div className="intel-card-value">{scheduleStats.dayCount}</div></div>
                        <div className="intel-card compact"><div className="intel-card-label">Events Extracted</div><div className="intel-card-value">{scheduleStats.eventCount}</div></div>
                        <div className="intel-card compact"><div className="intel-card-label">Departments</div><div className="intel-card-value">{scheduleStats.departmentCount || "-"}</div></div>
                        <div className="intel-card compact"><div className="intel-card-label">Avg Confidence</div><div className="intel-card-value">{scheduleStats.confidence}%</div></div>
                      </div>

                      <div className="schedule-grid">
                        <div className="schedule-panel schedule-panel-primary">
                          <div className="schedule-panel-header">
                            <div>
                              <div className="schedule-panel-title">Grouped by Date</div>
                              <div className="schedule-panel-subtitle">Each card represents all extracted rows for a single day.</div>
                            </div>
                          </div>
                          <div className="schedule-timeline">
                            {scheduleTimeline.length > 0 ? scheduleTimeline.map((bucket, bucketIndex) => (
                              <div key={bucketIndex} className="schedule-day-card">
                                <div className="schedule-day-header">
                                  <div>
                                    <div className="schedule-day-date">{bucket.date || "TBA"}</div>
                                    <div className="schedule-day-meta">{bucket.items.length} item{bucket.items.length > 1 ? "s" : ""} extracted</div>
                                  </div>
                                  <span className="badge secondary">Day {bucketIndex + 1}</span>
                                </div>
                                <div className="schedule-day-list">
                                  {bucket.items.map((item, itemIndex) => (
                                    <div key={itemIndex} className="schedule-entry">
                                      <div className="schedule-entry-main">
                                        <div className="schedule-entry-title">{item.subjectName || item.subjectCode || item.eventId || "Untitled event"}</div>
                                        <div className="schedule-entry-subtitle">
                                          {(item.departments || []).concat(item.years || []).concat(item.sections || []).filter(Boolean).join(" • ") || "General audience"}
                                        </div>
                                      </div>
                                      <div className="schedule-entry-meta">
                                        <span className="badge secondary">{item.startTime || "TBA"}{item.endTime ? ` → ${item.endTime}` : ""}</span>
                                        <span className={`badge ${(item.confidence || 0) > 0.7 ? "success" : "warning"}`}>{((item.confidence || 0) * 100).toFixed(0)}%</span>
                                      </div>
                                      {item.instructions && <div className="schedule-entry-note">{item.instructions}</div>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )) : (
                              <div className="empty-state schedule-empty">
                                <div className="empty-state-icon">🗓</div>
                                <h3>No schedule events extracted</h3>
                                <p>The document was processed, but no timetable rows were detected.</p>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="schedule-panel schedule-panel-secondary">
                          <div className="schedule-panel-header">
                            <div>
                              <div className="schedule-panel-title">Snapshot</div>
                              <div className="schedule-panel-subtitle">Useful at a glance for approval and sharing.</div>
                            </div>
                          </div>
                          <div className="schedule-snapshot-list">
                            {(events.length > 0 ? events : scheduleRows.flatMap((row, rowIndex) => {
                              const subjects = Array.isArray(row?.subjects) ? row.subjects : [];
                              return subjects.map((subject, subjectIndex) => ({
                                date: row?.date || "TBA",
                                subjectName: subject?.subjectName || subject?.subject || "Untitled",
                                subjectCode: subject?.subjectCode || subject?.code || "",
                                departments: [subject?.department].filter(Boolean),
                                confidence: 0.9,
                                key: `${rowIndex}-${subjectIndex}`
                              }));
                            })).slice(0, 8).map((item, index) => (
                              <div key={item.key || index} className="schedule-snapshot-item">
                                <div className="schedule-snapshot-date">{item.date || "TBA"}</div>
                                <div className="schedule-snapshot-title">{item.subjectName || item.subjectCode || "Untitled event"}</div>
                                <div className="schedule-snapshot-meta">{(item.departments || []).join(", ") || "General"}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
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
                  {detailTab === "raw" && (
                    <>
                      <div className="intel-card mb-3">
                        <div className="intel-card-label">Parser Output (metadata)</div>
                        <pre className="json-view" style={{ marginTop: 10 }}>{JSON.stringify(parserOutput, null, 2)}</pre>
                      </div>
                      <div className="intel-card">
                        <div className="intel-card-label">Extraction Output (full debug JSON)</div>
                        <pre className="json-view" style={{ marginTop: 10 }}>{JSON.stringify(extraction, null, 2)}</pre>
                      </div>
                    </>
                  )}
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
              <div><h2>Notifications</h2><p>Review queue and delivery history</p></div>
              <div className="flex gap-2">
                <button className="btn btn-primary btn-sm" onClick={openCompose}>✍️ Compose</button>
                <button className={`btn ${notiTab === "queue" ? "btn-primary" : "btn-ghost"} btn-sm`} onClick={() => { setNotificationsRouteState("queue", historyStatusFilter); fetchScheduledNotifications(); }}>⏳ Queue ({pendingDocs.length + scheduledNotifications.length})</button>
                <button className={`btn ${notiTab === "history" ? "btn-primary" : "btn-ghost"} btn-sm`} onClick={() => { setNotificationsRouteState("history", historyStatusFilter); fetchNotificationHistory(historyStatusFilter); }}>✅ History</button>
              </div>
            </div>
            <div className="main-body">
              {notiTab === "queue" && (
                <>
                  {pendingDocs.length === 0 && <div className="empty-state"><div className="empty-state-icon">✅</div><h3>All clear!</h3><p>No pending approvals.</p></div>}
                  {pendingDocs.map(doc => (
                    <div key={doc.id} className="review-card urgent">
                      <div className="review-card-header">
                        <div><div className="review-card-title">{doc.title}</div><div className="review-card-meta">{doc.docType} · Uploaded {fmtDate(doc.createdAt)} · {doc.recipientCount || 0} recipients</div></div>
                        <span className={`badge ${doc.status}`}>{doc.status.replace(/_/g, " ")}</span>
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
                    <thead><tr><th>Document</th><th>Recipient</th><th>Department</th><th>Conditions</th><th>Delivered At</th></tr></thead>
                    <tbody>
                      {sentHistory.map((n, i) => (
                        <tr key={i}>
                          <td><strong>{n.documentTitle}</strong></td>
                          <td>{n.userFullName}</td>
                          <td>{n.userDepartment || "-"}</td>
                          <td><div className="tag-list">{(n.matchedConditions || []).map(c => <span key={c} className="tag" style={{ fontSize: 10 }}>{c}</span>)}</div></td>
                          <td>{fmtDate(n.approvedAt || n.updatedAt)}</td>
                        </tr>
                      ))}
                      {sentHistory.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", padding: 40 }} className="text-sm text-muted">No sent notifications yet.</td></tr>}
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
                      <option value="ollama">Local AI (Gemma4:e2b via Ollama)</option>
                      <option value="gemini">Cloud AI (Gemini)</option>
                      <option value="azure_vision">Azure Computer Vision OCR + Cloud AI</option>
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
                    <input type="checkbox" checked={fastMode} onChange={e => updateSetting("fastMode", e.target.checked)} />
                    <strong>Fast Mode (Recommended)</strong>
                    <span className="text-muted ml-1">(Skips slow Python OCR warm-up and prioritizes quick Gemini/local parsing)</span>
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
                  <div className="form-group"><label className="form-label">AI Model</label><select className="form-select" value={uProvider} onChange={e => setUProvider(e.target.value)}><option value="ollama">Local AI (Gemma4:e2b via Ollama)</option><option value="gemini">Cloud AI (Gemini)</option><option value="azure_vision">Azure Computer Vision OCR + Cloud AI</option></select></div>
                  <button className="btn btn-primary btn-full mt-3" onClick={() => setWizStep(2)}>Next →</button>
                </>
              )}

              {wizStep === 2 && (
                <>
                  <div className="form-group">
                    <label className="form-label">Select File (PDF, image, or text)</label>
                    <input type="file" accept=".pdf,image/*,.txt,.md,.csv,.json,.log" className="form-input" onChange={e => setUFile(e.target.files?.[0] || null)} />
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

      {/* ═══ EDIT DOCUMENT MODAL ═══ */}
      {showEditDoc && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !savingDoc) { setShowEditDoc(false); setEditDocId(null); } }}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">✎ Edit Document</div>
              <button className="btn btn-ghost btn-sm" onClick={() => { if (!savingDoc) { setShowEditDoc(false); setEditDocId(null); } }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Title</label>
                <input className="form-input" value={editDocTitle} onChange={e => setEditDocTitle(e.target.value)} placeholder="Document title" />
              </div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-select" value={editDocType} onChange={e => setEditDocType(e.target.value)}>
                  <option value="circular">Circular</option>
                  <option value="exam_timetable">Timetable</option>
                  <option value="notice">Notice</option>
                  <option value="fee_reminder">Fee reminder</option>
                  <option value="general">General</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="flex gap-2 mt-3">
                <button className="btn btn-ghost" disabled={savingDoc} onClick={() => { setShowEditDoc(false); setEditDocId(null); }}>Cancel</button>
                <button className="btn btn-primary" disabled={savingDoc} onClick={saveDocumentChanges} style={{ flex: 1 }}>{savingDoc ? "Saving..." : "Save Changes"}</button>
              </div>
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
            {progressHint && (
              <div className="text-sm text-muted" style={{ marginTop: 4, width: "100%" }}>
                {progressHint}
              </div>
            )}
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
          {jobProgress.liveText && jobProgress.stage !== "done" && jobProgress.stage !== "error" && (
            <div className="progress-live-text" title={jobProgress.liveText}>{jobProgress.liveText}</div>
          )}
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
            authToken={authToken}
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
    </div>
  );
}
