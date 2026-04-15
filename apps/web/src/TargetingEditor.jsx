import { useState, useEffect, useCallback } from "react";

const DEPARTMENTS = ["CSE", "IT", "ECE", "EEE", "MECH", "CIVIL"];
const YEARS = ["1", "2", "3", "4"];
const SEMESTERS = ["1", "2", "3", "4", "5", "6", "7", "8"];
const ROLES = ["student", "faculty", "hod"];

const API = import.meta.env.VITE_API_BASE_URL || `${location.protocol}//${location.hostname}:4000`;

export default function TargetingEditor({ tenantId, authToken, initialFilters, onFiltersChange, onPreviewUpdate }) {
  const headers = {
    "x-tenant-id": tenantId,
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    "Content-Type": "application/json"
  };

  const [filters, setFilters] = useState({
    departments: [],
    years: [],
    semesters: [],
    sections: [],
    roles: ["student"],
    isHostelStudent: null,
    hasArrears: null,
    ...initialFilters
  });

  const [preview, setPreview] = useState({ count: 0, students: [], appliedFilters: [] });
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchPreview = useCallback(async (f) => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/targeting/preview`, {
        method: "POST", headers, body: JSON.stringify({ filters: f })
      });
      const d = await r.json();
      setPreview(d);
      onPreviewUpdate?.(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    fetchPreview(filters);
  }, []);

  function update(key, value) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    onFiltersChange?.(next);
    fetchPreview(next);
  }

  function toggleChip(key, value) {
    const arr = filters[key] || [];
    const next = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
    update(key, next);
  }

  function toggleBool(key) {
    const current = filters[key];
    const next = current === true ? false : current === false ? null : true;
    update(key, next);
  }

  return (
    <div className="targeting-editor">
      <div className="te-header" onClick={() => setExpanded(!expanded)}>
        <span className="te-title">🎯 Targeting Filters</span>
        <span className="te-count">{loading ? "..." : `${preview.count} recipients`}</span>
        <span className="te-toggle">{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div className="te-body">
          {/* Departments */}
          <div className="te-group">
            <div className="te-label">🏫 Department</div>
            <div className="chip-group">
              {DEPARTMENTS.map(d => (
                <button key={d} className={`chip ${filters.departments.includes(d) ? "active" : ""}`} onClick={() => toggleChip("departments", d)}>{d}</button>
              ))}
            </div>
          </div>

          {/* Year */}
          <div className="te-group">
            <div className="te-label">📅 Year</div>
            <div className="chip-group">
              {YEARS.map(y => (
                <button key={y} className={`chip ${filters.years.includes(y) ? "active" : ""}`} onClick={() => toggleChip("years", y)}>Year {y}</button>
              ))}
            </div>
          </div>

          {/* Semester */}
          <div className="te-group">
            <div className="te-label">📖 Semester</div>
            <div className="chip-group">
              {SEMESTERS.map(s => (
                <button key={s} className={`chip sm ${filters.semesters.includes(s) ? "active" : ""}`} onClick={() => toggleChip("semesters", s)}>Sem {s}</button>
              ))}
            </div>
          </div>

          {/* Role */}
          <div className="te-group">
            <div className="te-label">👤 Role</div>
            <div className="chip-group">
              {ROLES.map(r => (
                <button key={r} className={`chip ${filters.roles.includes(r) ? "active" : ""}`} onClick={() => toggleChip("roles", r)}>{r}</button>
              ))}
            </div>
          </div>

          {/* Boolean toggles */}
          <div className="te-group">
            <div className="te-label">🔀 Conditions</div>
            <div className="chip-group">
              <button className={`chip toggle ${filters.isHostelStudent === true ? "active" : filters.isHostelStudent === false ? "negative" : ""}`} onClick={() => toggleBool("isHostelStudent")}>
                🏠 Hostel {filters.isHostelStudent === true ? "✓" : filters.isHostelStudent === false ? "✕" : "—"}
              </button>
              <button className={`chip toggle ${filters.hasArrears === true ? "active" : filters.hasArrears === false ? "negative" : ""}`} onClick={() => toggleBool("hasArrears")}>
                📉 Arrears {filters.hasArrears === true ? "✓" : filters.hasArrears === false ? "✕" : "—"}
              </button>
            </div>
          </div>

          {/* Applied filters summary */}
          {preview.appliedFilters?.length > 0 && (
            <div className="te-applied">
              <span className="te-label-sm">Active:</span>
              {preview.appliedFilters.map((f, i) => <span key={i} className="tag">{f}</span>)}
            </div>
          )}
        </div>
      )}

      {/* Compact preview */}
      <div className="te-preview-bar">
        <span className="te-preview-count">{loading ? "⏳" : "👥"} <strong>{preview.count}</strong> recipients will receive this notification</span>
        {!expanded && <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(true)}>Edit Filters</button>}
      </div>

      {/* Preview table (always visible below the bar) */}
      {expanded && preview.students.length > 0 && (
        <div className="te-preview-table">
          <table className="data-table">
            <thead>
              <tr><th>Reg No</th><th>Name</th><th>Dept</th><th>Year</th><th>Hostel</th><th>Arrears</th></tr>
            </thead>
            <tbody>
              {preview.students.slice(0, 20).map(s => (
                <tr key={s._id}>
                  <td>{s.registrationNo}</td>
                  <td><strong>{s.fullName}</strong></td>
                  <td><span className="badge primary">{s.department}</span></td>
                  <td>{s.year || "-"}</td>
                  <td>{s.isHostelStudent ? "✅" : "❌"}</td>
                  <td>{s.hasArrears ? <span className="badge danger">YES</span> : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.count > 20 && <div className="te-more">Showing 20 of {preview.count} — refine filters to narrow down</div>}
        </div>
      )}
    </div>
  );
}
