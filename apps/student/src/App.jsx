import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import LoginPage from "./LoginPage";

const API = import.meta.env.VITE_API_BASE_URL || `${location.protocol}//${location.hostname}:4000`;

const TYPE_ICONS = {
  circular:       "📢",
  exam_timetable: "📅",
  fee_reminder:   "💰",
  notice:         "📌",
  custom:         "✉️",
  general:        "🔔",
};

const TYPE_LABELS = {
  circular:       "Circular",
  exam_timetable: "Exam Schedule",
  fee_reminder:   "Fee Reminder",
  notice:         "Notice",
  custom:         "Message",
  general:        "General",
};

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function formatFull(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    + " at " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function App() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("student_auth") === "1");
  const studentToken  = sessionStorage.getItem("student_token") || "";
  const studentId     = sessionStorage.getItem("student_id") || "";
  const studentName   = sessionStorage.getItem("student_name") || "Student";
  const studentReg    = sessionStorage.getItem("student_reg") || "";
  const studentDept   = sessionStorage.getItem("student_dept") || "";

  const [notifications, setNotifications] = useState([]);
  const [readIds, setReadIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sp_read") || "[]")); }
    catch { return new Set(); }
  });
  const [profile, setProfile] = useState(null);

  const [activeTab, setActiveTab]       = useState("inbox");   // "inbox" | "profile"
  const [search, setSearch]             = useState("");
  const [filterType, setFilterType]     = useState("all");
  const [selectedNoti, setSelectedNoti] = useState(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");

  const prevCountRef  = useRef(0);
  const initializedRef = useRef(false);

  const headers = { "x-tenant-id": "default-campus", "Authorization": `Bearer ${studentToken}` };

  // ── Persist read state ────────────────────────────────────────
  function markRead(id) {
    setReadIds(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem("sp_read", JSON.stringify([...next]));
      return next;
    });
    // Also persist to server (best-effort)
    fetch(`${API}/notifications/${id}/read?userId=${studentId}`, {
      method: "PATCH", headers
    }).catch(() => {});
  }

  // ── Fetch notifications ───────────────────────────────────────
  const fetchNotifications = useCallback(async (silent = false) => {
    if (!authed || !studentId) return;
    if (!silent) setLoading(true);
    try {
      const r = await fetch(`${API}/notifications?userId=${studentId}&status=delivered`, { headers });
      const d = await r.json();
      const items = (d.notifications || []).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
      setNotifications(items);

      // Native notification push
      if (initializedRef.current && items.length > prevCountRef.current && Notification.permission === "granted") {
        const diff = items.length - prevCountRef.current;
        const latest = items[0];
        new Notification(latest?.documentTitle || "New Notification", {
          body: latest?.content?.slice(0, 80) || `You have ${diff} new notification${diff > 1 ? "s" : ""}`,
          icon: "/vite.svg",
          badge: "/vite.svg",
          tag: "student-portal"
        });
      }
      prevCountRef.current = items.length;
      initializedRef.current = true;
    } catch (e) {
      if (!silent) setError("Could not load notifications");
    } finally {
      setLoading(false);
    }
  }, [authed, studentId]);

  // ── Fetch profile ─────────────────────────────────────────────
  const fetchProfile = useCallback(async () => {
    if (!authed || !studentId) return;
    try {
      const r = await fetch(`${API}/students/me?id=${studentId}`, { headers });
      const d = await r.json();
      if (d.success) setProfile(d.student);
    } catch {}
  }, [authed, studentId]);

  // ── Request push permission ───────────────────────────────────
  useEffect(() => {
    if (authed && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [authed]);

  // ── Initial load + polling ────────────────────────────────────
  useEffect(() => {
    if (!authed) return;
    fetchNotifications();
    fetchProfile();
    const poll = setInterval(() => fetchNotifications(true), 10000);
    return () => clearInterval(poll);
  }, [authed]);

  function handleLogin() { setAuthed(true); }

  function handleLogout() {
    sessionStorage.clear();
    setAuthed(false);
    setNotifications([]);
    setSelectedNoti(null);
    setProfile(null);
  }

  function openNoti(n) {
    setSelectedNoti(n);
    if (!readIds.has(n._id)) markRead(n._id);
  }

  // ── Derived data ──────────────────────────────────────────────
  const unreadCount = useMemo(
    () => notifications.filter(n => !readIds.has(n._id)).length,
    [notifications, readIds]
  );

  const filtered = useMemo(() => {
    let list = notifications;
    if (filterType !== "all") list = list.filter(n => n.documentType === filterType || n.notificationType === filterType);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(n =>
        n.documentTitle?.toLowerCase().includes(q) ||
        n.content?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [notifications, filterType, search]);

  const filterTypes = useMemo(() => {
    const types = new Set(notifications.map(n => n.documentType || n.notificationType));
    return ["all", ...types].filter(Boolean);
  }, [notifications]);

  if (!authed) return <LoginPage onLogin={handleLogin} />;

  return (
    <div className="sp-shell">

      {/* ── Top Bar ─────────────────────────────────────────── */}
      <header className="sp-topbar">
        <div className="sp-topbar-badge">
          <span className="sp-topbar-title">
            {activeTab === "inbox" ? "Inbox" : "Profile"}
          </span>
          {activeTab === "inbox" && unreadCount > 0 && (
            <span className="sp-unread-pill">{unreadCount} new</span>
          )}
        </div>

        {activeTab === "inbox" && (
          <button
            className="sp-topbar-action"
            onClick={() => fetchNotifications()}
            title="Refresh"
          >
            {loading ? "⏳" : "🔄"}
          </button>
        )}
      </header>

      {loading && <div className="sp-refresh-bar" />}

      {/* ── Screens ─────────────────────────────────────────── */}
      <div className="sp-screen">
        {/* ────────── INBOX ────────── */}
        {activeTab === "inbox" && (
          <>
            {/* Search */}
            <div className="sp-search-wrap">
              <span className="sp-search-icon">🔍</span>
              <input
                className="sp-search-input"
                placeholder="Search notifications..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {/* Filter chips */}
            <div className="sp-filters">
              {filterTypes.map(type => (
                <button
                  key={type}
                  className={`sp-filter-chip ${filterType === type ? "active" : ""}`}
                  onClick={() => setFilterType(type)}
                >
                  {type === "all" ? "🌐" : TYPE_ICONS[type] || "📋"}
                  &nbsp;{type === "all" ? "All" : TYPE_LABELS[type] || type}
                </button>
              ))}
            </div>

            {/* Notification list */}
            <div className="sp-noti-list">
              {error && (
                <div style={{ padding: "10px 14px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 10, color: "var(--danger)", fontSize: 13 }}>
                  {error}
                </div>
              )}

              {filtered.length === 0 && !loading && (
                <div className="sp-empty">
                  <div className="sp-empty-icon">
                    {search ? "🔎" : "📭"}
                  </div>
                  <h3>{search ? "No results" : "All caught up!"}</h3>
                  <p>{search ? `No notifications match "${search}"` : "New notifications will appear here when sent."}</p>
                </div>
              )}

              {filtered.map(n => {
                const type = n.documentType || n.notificationType || "general";
                const isUnread = !readIds.has(n._id);
                const hasFile = (n.deliveryMode === "both" || n.deliveryMode === "original") && n.documentId;
                return (
                  <div
                    key={n._id}
                    className={`sp-noti-card ${isUnread ? "unread" : ""}`}
                    onClick={() => openNoti(n)}
                  >
                    <div className="sp-noti-header">
                      <div className={`sp-noti-icon ${type}`}>
                        {TYPE_ICONS[type] || "🔔"}
                      </div>
                      <div className="sp-noti-meta">
                        <div className={`sp-noti-type ${type}`}>{TYPE_LABELS[type] || type}</div>
                        <div className="sp-noti-date">{timeAgo(n.sentAt)}</div>
                      </div>
                      {isUnread && <div className="sp-unread-dot" />}
                    </div>
                    <div className="sp-noti-title">{n.documentTitle}</div>
                    {n.content && (
                      <div className="sp-noti-preview">{n.content}</div>
                    )}
                    {hasFile && (
                      <div className="sp-noti-footer">
                        <span className="sp-tag has-file">📄 Has attachment</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ────────── PROFILE ────────── */}
        {activeTab === "profile" && (
          <div className="sp-profile">
            {/* Hero Card */}
            <div className="sp-profile-hero">
              <div className="sp-avatar">🎓</div>
              <div className="sp-profile-name">{studentName}</div>
              <div className="sp-profile-reg">{studentReg}</div>
            </div>

            {/* Academic Info */}
            {profile ? (
              <>
                <div>
                  <div className="sp-section-title">Academic Details</div>
                  <div className="sp-info-grid">
                    <div className="sp-info-card">
                      <div className="sp-info-label">Department</div>
                      <div className="sp-info-value">{profile.department || "—"}</div>
                    </div>
                    <div className="sp-info-card">
                      <div className="sp-info-label">Year</div>
                      <div className="sp-info-value">{profile.year ? `Year ${profile.year}` : "—"}</div>
                    </div>
                    <div className="sp-info-card">
                      <div className="sp-info-label">Semester</div>
                      <div className="sp-info-value">{profile.semester ? `Sem ${profile.semester}` : "—"}</div>
                    </div>
                    <div className="sp-info-card">
                      <div className="sp-info-label">Section</div>
                      <div className="sp-info-value">{profile.section || "—"}</div>
                    </div>
                    <div className="sp-info-card">
                      <div className="sp-info-label">Program</div>
                      <div className="sp-info-value">{profile.program || "—"}</div>
                    </div>
                    <div className="sp-info-card">
                      <div className="sp-info-label">Role</div>
                      <div className="sp-info-value" style={{ textTransform: "capitalize" }}>{profile.role || "Student"}</div>
                    </div>
                    <div className="sp-info-card full">
                      <div className="sp-info-label">Email</div>
                      <div className="sp-info-value" style={{ fontSize: 13 }}>{profile.email || "—"}</div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="sp-section-title">Status Flags</div>
                  <div className="sp-info-grid">
                    <div className="sp-info-card">
                      <div className="sp-info-label">Hostel</div>
                      <span className={`sp-status ${profile.isHostelStudent ? "yes" : "no"}`}>
                        {profile.isHostelStudent ? "✓ Yes" : "✗ No"}
                      </span>
                    </div>
                    <div className="sp-info-card">
                      <div className="sp-info-label">Arrears</div>
                      <span className={`sp-status ${profile.hasArrears ? "no" : "yes"}`}>
                        {profile.hasArrears ? "⚠ Yes" : "✓ Clear"}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ textAlign: "center", color: "var(--text-dim)", padding: 20, fontSize: 14 }}>
                Loading profile...
              </div>
            )}

            {/* Notifications summary */}
            <div>
              <div className="sp-section-title">Notification Summary</div>
              <div className="sp-info-grid">
                <div className="sp-info-card">
                  <div className="sp-info-label">Received</div>
                  <div className="sp-info-value" style={{ fontSize: 24, fontWeight: 800, color: "var(--primary)" }}>
                    {notifications.length}
                  </div>
                </div>
                <div className="sp-info-card">
                  <div className="sp-info-label">Unread</div>
                  <div className="sp-info-value" style={{ fontSize: 24, fontWeight: 800, color: unreadCount > 0 ? "var(--accent)" : "var(--success)" }}>
                    {unreadCount}
                  </div>
                </div>
              </div>
            </div>

            <button className="sp-logout-btn" onClick={handleLogout}>
              🚪 Sign Out
            </button>
          </div>
        )}
      </div>

      {/* ── Bottom Navigation ───────────────────────────────── */}
      <nav className="sp-bottomnav">
        <button
          className={`sp-nav-item ${activeTab === "inbox" ? "active" : ""}`}
          onClick={() => setActiveTab("inbox")}
        >
          <div className="sp-nav-icon">
            📥
            {unreadCount > 0 && activeTab !== "inbox" && <div className="sp-nav-dot" />}
          </div>
          <span className="sp-nav-label">Inbox</span>
        </button>

        <button
          className={`sp-nav-item ${activeTab === "profile" ? "active" : ""}`}
          onClick={() => setActiveTab("profile")}
        >
          <div className="sp-nav-icon">👤</div>
          <span className="sp-nav-label">Profile</span>
        </button>
      </nav>

      {/* ── Notification Detail Drawer ──────────────────────── */}
      {selectedNoti && (() => {
        const n = selectedNoti;
        const type = n.documentType || n.notificationType || "general";
        const hasFile = (n.deliveryMode === "both" || n.deliveryMode === "original") && n.documentId;
        return (
          <div className="sp-drawer-overlay" onClick={e => { if (e.target === e.currentTarget) setSelectedNoti(null); }}>
            <div className="sp-drawer">
              <div className="sp-drawer-handle" />
              
              <div className="sp-drawer-header">
                <div className="sp-drawer-type-row">
                  <span className={`sp-noti-type ${type}`}>
                    {TYPE_ICONS[type] || "🔔"} {TYPE_LABELS[type] || type}
                  </span>
                  <button className="sp-drawer-close" onClick={() => setSelectedNoti(null)}>✕</button>
                </div>
                <div className="sp-drawer-title">{n.documentTitle}</div>
                <div className="sp-drawer-date">📅 {formatFull(n.sentAt)}</div>
              </div>

              <div className="sp-drawer-body">
                {n.content && (
                  <div className="sp-message-card">
                    <div className="sp-message-label">Message from Administration</div>
                    <div className="sp-message-text">{n.content}</div>
                  </div>
                )}

                {hasFile && (
                  <div>
                    <div className="sp-pdf-label">📄 Attached Document</div>
                    <div className="sp-pdf-container">
                      <iframe
                        src={`${API}/documents/${n.documentId}/file`}
                        title={n.documentTitle}
                        allow="fullscreen"
                      />
                    </div>
                  </div>
                )}

                {!n.content && !hasFile && (
                  <div className="sp-empty">
                    <div className="sp-empty-icon">📋</div>
                    <h3>No content</h3>
                    <p>This notification has no message or attachment.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
