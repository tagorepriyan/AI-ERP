import { useState, useEffect, useCallback } from "react";
import TargetingEditor from "./TargetingEditor";

const API = import.meta.env.VITE_API_BASE_URL || `${location.protocol}//${location.hostname}:4000`;

export default function ReviewPanel({ tenantId, doc, extraction, recipients, onAction, onClose }) {
  const headers = { "x-tenant-id": tenantId, "Content-Type": "application/json" };
  const structured = extraction?.structured || {};

  const [deliveryMode, setDeliveryMode] = useState("both");
  const [priority, setPriority] = useState("normal");
  const [adminNote, setAdminNote] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [filters, setFilters] = useState({});
  const [previewCount, setPreviewCount] = useState(recipients?.length || 0);
  const [rejectReason, setRejectReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [tab, setTab] = useState("targeting");

  // Build initial filters from AI extraction
  useEffect(() => {
    const init = {};
    // Try to derive from matchedConditions of first recipient
    const conds = recipients?.[0]?.matchedConditions || [];
    const depts = new Set();
    const years = new Set();
    const sems = new Set();
    for (const c of conds) {
      if (c.startsWith("department:")) c.split(":")[1].split(",").forEach(d => depts.add(d.toUpperCase()));
      if (c.startsWith("year:")) c.split(":")[1].split(",").forEach(y => years.add(y));
      if (c.startsWith("semester:")) c.split(":")[1].split(",").forEach(s => sems.add(s));
      if (c === "isHostelStudent") init.isHostelStudent = true;
      if (c === "hasArrears:true" || c === "hasArrears") init.hasArrears = true;
    }
    if (depts.size) init.departments = [...depts];
    if (years.size) init.years = [...years];
    if (sems.size) init.semesters = [...sems];
    setFilters(init);
  }, [recipients]);

  async function handleApprove() {
    setProcessing(true);
    try {
      // First update targeting if filters changed
      await fetch(`${API}/targeting/update/${doc.id}`, {
        method: "POST", headers, body: JSON.stringify({ filters, adminNote })
      });

      // Then approve with delivery options
      const body = {
        approvedBy: "admin",
        deliveryMode,
        priority,
        content: adminNote,
        scheduledAt: scheduledAt || null,
        filters
      };
      const r = await fetch(`${API}/documents/${doc.id}/approve`, {
        method: "POST", headers, body: JSON.stringify(body)
      });
      const d = await r.json();
      onAction?.("approved", d);
    } catch (e) {
      console.error(e);
    }
    setProcessing(false);
  }

  async function handleReject() {
    setProcessing(true);
    try {
      const r = await fetch(`${API}/documents/${doc.id}/reject`, {
        method: "POST", headers, body: JSON.stringify({ reason: rejectReason || "Rejected by admin" })
      });
      const d = await r.json();
      onAction?.("rejected", d);
    } catch (e) { console.error(e); }
    setProcessing(false);
  }

  async function handleRemoveRecipient(notiId) {
    try {
      await fetch(`${API}/targeting/remove-recipients/${doc.id}`, {
        method: "POST", headers, body: JSON.stringify({ notificationIds: [notiId] })
      });
      onAction?.("refresh");
    } catch (e) { console.error(e); }
  }

  const tabs = [
    { id: "targeting", label: "🎯 Targeting" },
    { id: "recipients", label: `👥 Recipients (${previewCount})` },
    { id: "delivery", label: "📨 Delivery Options" },
    { id: "reject", label: "✕ Reject" }
  ];

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 720, maxHeight: "90vh" }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">🔍 Review: {doc.title}</div>
            <div className="text-sm text-muted" style={{ marginTop: 4 }}>
              {doc.docType?.toUpperCase()} · AI Confidence: {((extraction?.confidenceScore || 0) * 100).toFixed(0)}% · Provider: {extraction?.provider || "N/A"}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* AI Summary */}
        <div style={{ padding: "12px 24px", background: "var(--main-bg)", borderBottom: "1px solid var(--border)" }}>
          <div className="te-label-sm" style={{ marginBottom: 4 }}>AI Summary</div>
          <p className="text-sm" style={{ margin: 0, color: "var(--text)" }}>{structured.summary || "No summary extracted."}</p>
          <div className="tag-list mt-2">
            {(structured.targetAudience || []).map((a, i) => <span key={i} className="tag">{a}</span>)}
          </div>
        </div>

        {/* Tabs */}
        <div className="detail-tabs" style={{ padding: "0 24px", borderBottom: "1px solid var(--border)" }}>
          {tabs.map(t => (
            <button key={t.id} className={`detail-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        <div className="modal-body" style={{ overflowY: "auto", maxHeight: "calc(90vh - 280px)" }}>
          {/* TARGETING TAB */}
          {tab === "targeting" && (
            <TargetingEditor
              tenantId={tenantId}
              initialFilters={filters}
              onFiltersChange={setFilters}
              onPreviewUpdate={p => setPreviewCount(p.count)}
            />
          )}

          {/* RECIPIENTS TAB */}
          {tab === "recipients" && (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead><tr><th>Name</th><th>Role</th><th>Dept</th><th>Year</th><th>Conditions</th><th>Action</th></tr></thead>
                <tbody>
                  {recipients.map((r, i) => (
                    <tr key={r._id || i}>
                      <td><strong>{r.userFullName}</strong></td>
                      <td><span className="badge secondary">{r.userRole}</span></td>
                      <td>{r.userDepartment || "-"}</td>
                      <td>{r.userYear || "-"}</td>
                      <td><div className="tag-list">{(r.matchedConditions || []).map(c => <span key={c} className="tag" style={{ fontSize: 10 }}>{c}</span>)}</div></td>
                      <td>
                        {r.status === "pending" && (
                          <button className="btn btn-danger btn-sm" onClick={() => handleRemoveRecipient(r._id)}>Remove</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {recipients.length === 0 && <tr><td colSpan={6} className="text-sm text-muted" style={{ textAlign: "center", padding: 30 }}>No recipients. Use the Targeting tab to set filters.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* DELIVERY TAB */}
          {tab === "delivery" && (
            <>
              <div className="form-group">
                <label className="form-label">What to deliver</label>
                <div className="chip-group">
                  {[["both", "📋 Both (PDF + Summary)"], ["original", "📄 Original PDF Only"], ["ai_summary", "📝 AI Summary Only"]].map(([v, l]) => (
                    <button key={v} className={`chip ${deliveryMode === v ? "active" : ""}`} onClick={() => setDeliveryMode(v)}>{l}</button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Priority</label>
                <div className="chip-group">
                  {[["low", "🟢 Low"], ["normal", "🔵 Normal"], ["high", "🟠 High"], ["urgent", "🔴 Urgent"]].map(([v, l]) => (
                    <button key={v} className={`chip ${priority === v ? "active" : ""}`} onClick={() => setPriority(v)}>{l}</button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Schedule (leave empty for immediate send)</label>
                <input type="datetime-local" className="form-input" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
              </div>

              <div className="form-group">
                <label className="form-label">Admin Note (optional — appended to notification)</label>
                <textarea className="form-input" rows={3} value={adminNote} onChange={e => setAdminNote(e.target.value)} placeholder="Add a note for recipients..." style={{ resize: "vertical" }} />
              </div>
            </>
          )}

          {/* REJECT TAB */}
          {tab === "reject" && (
            <>
              <div className="intel-card" style={{ borderColor: "var(--danger)", background: "var(--danger-light)" }}>
                <div className="intel-card-label" style={{ color: "var(--danger)" }}>⚠️ Reject this document</div>
                <p className="text-sm" style={{ margin: "8px 0 0" }}>This will cancel all {recipients.length} pending notifications and mark the document as rejected.</p>
              </div>
              <div className="form-group mt-3">
                <label className="form-label">Rejection Reason</label>
                <textarea className="form-input" rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Why is this document being rejected?" style={{ resize: "vertical" }} />
              </div>
              <button className="btn btn-danger btn-full mt-3" disabled={processing} onClick={handleReject}>
                {processing ? "Rejecting..." : "✕ Confirm Rejection"}
              </button>
            </>
          )}
        </div>

        {/* Footer (only on non-reject tabs) */}
        {tab !== "reject" && (
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-success" disabled={processing || previewCount === 0} onClick={handleApprove}>
              {processing ? "Processing..." : scheduledAt ? `⏰ Schedule for ${previewCount} recipients` : `✅ Approve & Send to ${previewCount} recipients`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
