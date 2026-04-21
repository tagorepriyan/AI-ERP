import { useState } from "react";
import TargetingEditor from "./TargetingEditor";

const API = import.meta.env.VITE_API_BASE_URL || `${location.protocol}//${location.hostname}:4000`;


export default function ComposeModal({ tenantId, onClose, onSent }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [notiType, setNotiType] = useState("custom");
  const [priority, setPriority] = useState("normal");
  const [deliveryMode, setDeliveryMode] = useState("ai_summary");
  const [scheduledAt, setScheduledAt] = useState("");
  const [filters, setFilters] = useState({});
  const [previewCount, setPreviewCount] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendStep, setSendStep] = useState("");
  const [error, setError] = useState("");
  const [file, setFile] = useState(null);

  async function handleSend() {
    if (!content.trim() && !file) { setError("Content or file is required"); return; }
    if (previewCount === 0) { setError("No recipients matched — use the targeting filter to add recipients"); return; }
    setError("");
    setSending(true);
    setSendStep("Preparing...");
    try {
      const fd = new FormData();
      fd.append("title", title || "Custom Notification");
      fd.append("content", content);
      fd.append("notificationType", notiType);
      fd.append("priority", priority);
      fd.append("deliveryMode", deliveryMode);
      if (scheduledAt) fd.append("scheduledAt", scheduledAt);
      fd.append("filters", JSON.stringify(filters));
      if (file) fd.append("file", file);

      const headers = { "x-tenant-id": tenantId };
      const authToken = sessionStorage.getItem("notify_token");
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

      setSendStep(`Sending to ${previewCount} recipients...`);
      const r = await fetch(`${API}/notifications/compose`, {
        method: "POST", headers, body: fd
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error?.message || "Failed to send"); setSending(false); setSendStep(""); return; }
      setSendStep("");
      onSent?.(d);
      onClose();
    } catch (e) {
      setError(e.message || "Network error — please try again");
      setSending(false);
      setSendStep("");
    }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 640, maxHeight: "90vh" }}>
        <div className="modal-header">
          <div className="modal-title">✍️ Compose Custom Notification</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ overflowY: "auto", maxHeight: "calc(90vh - 140px)" }}>
          {/* Title & Content */}
          <div className="form-group">
            <label className="form-label">Title</label>
            <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Notification title" />
          </div>
          <div className="form-group">
            <label className="form-label">Attached File (optional)</label>
            <input type="file" className="form-input" onChange={e => setFile(e.target.files?.[0] || null)} />
            <div className="text-sm text-muted" style={{ marginTop: 4 }}>This file will bypass AI parsing and go straight to recipients.</div>
          </div>
          <div className="form-group">
            <label className="form-label">Content or Message text</label>
            <textarea className="form-input" rows={4} value={content} onChange={e => setContent(e.target.value)} placeholder="Type the notification content..." style={{ resize: "vertical" }} />
          </div>

          {/* Type & Priority */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-select" value={notiType} onChange={e => setNotiType(e.target.value)}>
                <option value="custom">Custom</option>
                <option value="circular">Circular</option>
                <option value="notice">Notice</option>
                <option value="fee_reminder">Fee Reminder</option>
                <option value="general">General</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Priority</label>
              <select className="form-select" value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="low">🟢 Low</option>
                <option value="normal">🔵 Normal</option>
                <option value="high">🟠 High</option>
                <option value="urgent">🔴 Urgent</option>
              </select>
            </div>
          </div>

          {/* Delivery mode */}
          <div className="form-group">
            <label className="form-label">Delivery Mode</label>
            <div className="chip-group">
              {[["ai_summary", "📝 Text Summary"], ["original", "📄 Original Doc"], ["both", "📋 Both"]].map(([v, l]) => (
                <button key={v} className={`chip ${deliveryMode === v ? "active" : ""}`} onClick={() => setDeliveryMode(v)}>{l}</button>
              ))}
            </div>
          </div>

          {/* Schedule */}
          <div className="form-group">
            <label className="form-label">Schedule (optional)</label>
            <input type="datetime-local" className="form-input" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
          </div>

          <div className="divider" />

          {/* Targeting */}
          <TargetingEditor
            tenantId={tenantId}
            initialFilters={{}}
            onFiltersChange={setFilters}
            onPreviewUpdate={p => setPreviewCount(p.count)}
          />

          {error && <div className="login-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={sending}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={sending || (!content.trim() && !file) || previewCount === 0}
            onClick={handleSend}
            style={{ minWidth: 200 }}
          >
            {sending
              ? <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                  {sendStep || "Sending..."}
                </span>
              : scheduledAt
                ? `⏰ Schedule to ${previewCount}`
                : `📨 Send to ${previewCount} recipients`
            }
          </button>
        </div>
      </div>
    </div>
  );
}
