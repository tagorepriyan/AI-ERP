import { useState, useEffect, useRef, useMemo } from "react";

const DEPARTMENTS = ["CSE", "IT", "ECE", "EEE", "MECH", "CIVIL"];
const YEARS       = ["1", "2", "3", "4"];
const SEMESTERS   = ["1", "2", "3", "4", "5", "6", "7", "8"];
const ROLES       = ["student", "faculty", "hod"];

const API = import.meta.env.VITE_API_BASE_URL || `${location.protocol}//${location.hostname}:4000`;

// ── Module-level cache so students survive modal open/close ──────────────────
let _cachedStudents = null;
let _cacheKey = null; // tenantId that was fetched

function applyFilters(students, f) {
  return students.filter(s => {
    if (f.departments?.length && !f.departments.some(d => d.toLowerCase() === (s.department || "").toLowerCase())) return false;
    if (f.years?.length && !f.years.includes(s.year)) return false;
    if (f.semesters?.length && !f.semesters.includes(s.semester)) return false;
    if (f.sections?.length && !f.sections.some(sc => sc.toLowerCase() === (s.section || "").toLowerCase())) return false;
    if (f.roles?.length && !f.roles.includes(s.role)) return false;
    if (f.isHostelStudent === true && !s.isHostelStudent) return false;
    if (f.isHostelStudent === false && s.isHostelStudent) return false;
    if (f.hasArrears === true && !s.hasArrears) return false;
    if (f.hasArrears === false && s.hasArrears) return false;
    return true;
  });
}

export default function TargetingEditor({ tenantId, initialFilters, onFiltersChange, onPreviewUpdate }) {
  const [allStudents, setAllStudents] = useState(_cachedStudents || []);
  const [fetchState, setFetchState] = useState(_cachedStudents ? "done" : "idle"); // idle | loading | done | error
  const [expanded, setExpanded] = useState(false);

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

  // ── Client-side filter — pure computed, instant ───────────────────────────
  const matched = useMemo(() => applyFilters(allStudents, filters), [allStudents, filters]);

  // Notify parent whenever matched list changes
  useEffect(() => {
    const appliedFilters = [];
    if (filters.departments?.length) appliedFilters.push(`dept:${filters.departments.join(",")}`);
    if (filters.years?.length) appliedFilters.push(`year:${filters.years.join(",")}`);
    if (filters.semesters?.length) appliedFilters.push(`sem:${filters.semesters.join(",")}`);
    if (filters.roles?.length) appliedFilters.push(`role:${filters.roles.join(",")}`);
    if (filters.isHostelStudent === true) appliedFilters.push("hostel:yes");
    if (filters.isHostelStudent === false) appliedFilters.push("hostel:no");
    if (filters.hasArrears === true) appliedFilters.push("arrears:yes");
    onFiltersChange?.(filters);
    onPreviewUpdate?.({ count: matched.length, students: matched, appliedFilters });
  }, [matched]);

  // ── Load all students ONCE, cache at module level ─────────────────────────
  const abortRef = useRef(null);

  useEffect(() => {
    if (_cachedStudents && _cacheKey === tenantId) {
      setAllStudents(_cachedStudents);
      setFetchState("done");
      return;
    }
    setFetchState("loading");
    const controller = new AbortController();
    abortRef.current = controller;

    fetch(`${API}/students/all`, {
      headers: { "x-tenant-id": tenantId || "default-campus" },
      signal: controller.signal
    })
      .then(r => r.json())
      .then(d => {
        const list = d.students || [];
        _cachedStudents = list;
        _cacheKey = tenantId;
        setAllStudents(list);
        setFetchState("done");
      })
      .catch(e => {
        if (e.name !== "AbortError") setFetchState("error");
      });

    return () => controller.abort();
  }, [tenantId]);

  // ── Filter update helpers ─────────────────────────────────────────────────
  function update(key, value) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }
  function toggleChip(key, value) {
    setFilters(prev => {
      const arr = prev[key] || [];
      return { ...prev, [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] };
    });
  }
  function toggleBool(key) {
    setFilters(prev => {
      const cur = prev[key];
      return { ...prev, [key]: cur === true ? false : cur === false ? null : true };
    });
  }

  const isLoading = fetchState === "loading";
  const countColor = matched.length > 0 ? "var(--success)" : "var(--danger)";

  return (
    <div className="targeting-editor">
      <div className="te-header" onClick={() => setExpanded(e => !e)}>
        <span className="te-title">🎯 Targeting Filters</span>
        <span className="te-count" style={{ color: countColor, fontWeight: 700 }}>
          {isLoading
            ? <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
                <span style={{ width:10, height:10, border:"2px solid #ccc", borderTopColor:"var(--primary)", borderRadius:"50%", display:"inline-block", animation:"spin 0.6s linear infinite"}} />
                Loading…
              </span>
            : `${matched.length} of ${allStudents.length} recipients`
          }
        </span>
        <span className="te-toggle">{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div className="te-body">
          <div className="te-group">
            <div className="te-label">🏫 Department</div>
            <div className="chip-group">
              {DEPARTMENTS.map(d => (
                <button key={d} className={`chip ${filters.departments.includes(d) ? "active" : ""}`} onClick={() => toggleChip("departments", d)}>{d}</button>
              ))}
            </div>
          </div>

          <div className="te-group">
            <div className="te-label">📅 Year</div>
            <div className="chip-group">
              {YEARS.map(y => (
                <button key={y} className={`chip ${filters.years.includes(y) ? "active" : ""}`} onClick={() => toggleChip("years", y)}>Year {y}</button>
              ))}
            </div>
          </div>

          <div className="te-group">
            <div className="te-label">📖 Semester</div>
            <div className="chip-group">
              {SEMESTERS.map(s => (
                <button key={s} className={`chip sm ${filters.semesters.includes(s) ? "active" : ""}`} onClick={() => toggleChip("semesters", s)}>Sem {s}</button>
              ))}
            </div>
          </div>

          <div className="te-group">
            <div className="te-label">👤 Role</div>
            <div className="chip-group">
              {ROLES.map(r => (
                <button key={r} className={`chip ${filters.roles.includes(r) ? "active" : ""}`} onClick={() => toggleChip("roles", r)}>{r}</button>
              ))}
            </div>
          </div>

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
        </div>
      )}

      {/* Preview bar */}
      <div className="te-preview-bar">
        <span className="te-preview-count">
          {isLoading
            ? "Loading recipients…"
            : fetchState === "error"
              ? <span style={{ color: "var(--danger)" }}>⚠ Could not load students — check API</span>
              : <><strong style={{ color: countColor, fontSize: 15 }}>{matched.length}</strong> of {allStudents.length} total students</>
          }
        </span>
        {!expanded && !isLoading && (
          <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(true)}>Edit Filters</button>
        )}
      </div>

      {/* Recipient preview table */}
      {expanded && matched.length > 0 && (
        <div className="te-preview-table">
          <table className="data-table">
            <thead>
              <tr><th>Reg No</th><th>Name</th><th>Dept</th><th>Year</th><th>Hostel</th><th>Arrears</th></tr>
            </thead>
            <tbody>
              {matched.slice(0, 30).map(s => (
                <tr key={s._id}>
                  <td>{s.registrationNo}</td>
                  <td><strong>{s.fullName}</strong></td>
                  <td><span className="badge primary">{s.department}</span></td>
                  <td>{s.year || "—"}</td>
                  <td>{s.isHostelStudent ? "✅" : "❌"}</td>
                  <td>{s.hasArrears ? <span className="badge danger">YES</span> : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {matched.length > 30 && (
            <div className="te-more">Showing 30 of {matched.length} — refine filters to narrow list</div>
          )}
        </div>
      )}
    </div>
  );
}
