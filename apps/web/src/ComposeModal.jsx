import { useState } from "react";
import TargetingEditor from "./TargetingEditor";

const API = import.meta.env.VITE_API_BASE_URL || `${location.protocol}//${location.hostname}:4000`;

export default function ComposeModal({ tenantId, authToken, onClose, onSent }) {
  const headers = {
    "x-tenant-id": tenantId,
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    "Content-Type": "application/json"
  };

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [notiType, setNotiType] = useState("custom");
  const [priority, setPriority] = useState("normal");
  const [deliveryMode, setDeliveryMode] = useState("ai_summary");
  const [scheduledAt, setScheduledAt] = useState("");
  const [filters, setFilters] = useState({});
  const [previewCount, setPreviewCount] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function handleSend() {
    if (!content.trim()) { setError("Content is required"); return; }
    if (previewCount === 0) { setError("No recipients matched"); return; }
    setError("");
    setSending(true);
    try {
      const body = {
        title: title || "Custom Notification",
        content,
        notificationType: notiType,
        priority,
        deliveryMode,
        filters,
        scheduledAt: scheduledAt || null
      };
      const r = await fetch(`${API}/notifications/compose`, {
        method: "POST", headers, body: JSON.stringify(body)
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error?.message || "Failed"); setSending(false); return; }
      onSent?.(d);
      onClose();
    } catch (e) {
      setError(e.message);
      setSending(false);
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
            <label className="form-label">Content</label>
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
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={sending || !content.trim() || previewCount === 0} onClick={handleSend}>
            {sending ? "Sending..." : scheduledAt ? `⏰ Schedule to ${previewCount} recipients` : `📨 Send to ${previewCount} recipients`}
          </button>
        </div>
      </div>
    </div>
  );
}
