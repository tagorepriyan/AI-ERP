import { useState, useRef } from "react";

const API = import.meta.env.VITE_API_BASE_URL || `${location.protocol}//${location.hostname}:4000`;

export default function LoginPage({ onLogin }) {
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const refs = [useRef(), useRef(), useRef(), useRef()];

  async function submitPin(pin) {
    if (pin.length < 4) {
      setError("Enter all 4 digits");
      return;
    }

    setError("");
    setLoading(true);
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", pin })
      });
      const d = await r.json();
      if (!r.ok) {
        throw new Error(d?.error?.message || "Invalid credentials");
      }

      sessionStorage.setItem("notify_auth", "1");
      sessionStorage.setItem("notify_token", d.token);
      onLogin?.(d);
    } catch (err) {
      setError(err.message || "Login failed");
      setDigits(["", "", "", ""]);
      refs[0].current?.focus();
    } finally {
      setLoading(false);
    }
  }

  function handleChange(idx, val) {
    if (val.length > 1) val = val.slice(-1);
    if (val && !/^\d$/.test(val)) return;

    const next = [...digits];
    next[idx] = val;
    setDigits(next);
    setError("");

    if (val && idx < 3) refs[idx + 1].current?.focus();

    if (next.every(d => d !== "")) {
      submitPin(next.join(""));
    }
  }

  function handleKeyDown(idx, e) {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      refs[idx - 1].current?.focus();
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">🔔</div>
        <h1>Notify</h1>
        <p>AI-Powered Communication System<br />Enter your 4-digit PIN to continue</p>

        <div className="pin-inputs">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={refs[i]}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={d}
              className={`pin-input ${d ? "filled" : ""}`}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              autoFocus={i === 0}
            />
          ))}
        </div>

        {error && <div className="login-error">{error}</div>}

        <button
          className="btn btn-primary btn-full btn-lg"
          disabled={loading}
          onClick={() => submitPin(digits.join(""))}
        >
          {loading ? "Signing in..." : "Unlock Dashboard"}
        </button>
      </div>
    </div>
  );
}
