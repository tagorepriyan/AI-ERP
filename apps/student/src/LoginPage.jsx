import { useState } from "react";

const API = import.meta.env.VITE_API_BASE_URL || `${location.protocol}//${location.hostname}:4000`;

export default function LoginPage({ onLogin }) {
  const [regNo, setRegNo] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!regNo.trim()) return setError("Registration number is required");
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${API}/students/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-id": "default-campus" },
        body: JSON.stringify({ registrationNo: regNo.trim(), pin })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message || "Login failed");
      sessionStorage.setItem("student_auth", "1");
      sessionStorage.setItem("student_token", data.token || "");
      sessionStorage.setItem("student_id", data.student?.id || "");
      sessionStorage.setItem("student_name", data.student?.name || "");
      sessionStorage.setItem("student_reg", data.student?.registrationNo || regNo.trim());
      sessionStorage.setItem("student_dept", data.student?.department || "");
      onLogin(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sp-login">
      <div className="sp-login-brand">
        <div className="sp-login-icon">🎓</div>
        <h1>Student Portal</h1>
        <p>Your academic notifications, beautifully organised</p>
      </div>

      <div className="sp-login-card">
        <form onSubmit={handleSubmit}>
          <div className="sp-field">
            <label className="sp-label">Registration Number</label>
            <input
              autoFocus
              className="sp-input"
              placeholder="e.g. 21CS101"
              value={regNo}
              onChange={e => setRegNo(e.target.value)}
            />
          </div>
          <div className="sp-field">
            <label className="sp-label">PIN</label>
            <input
              type="password"
              className="sp-input"
              placeholder="••••"
              value={pin}
              onChange={e => setPin(e.target.value)}
              maxLength={6}
            />
          </div>

          <button type="submit" className="sp-btn" disabled={loading || !regNo.trim()}>
            {loading ? "Signing in..." : "Sign In →"}
          </button>

          {error && <div className="sp-error">{error}</div>}
        </form>

        <div className="sp-hint">
          Demo: Use any seeded registration number with PIN <strong>1111</strong>
        </div>
      </div>
    </div>
  );
}
