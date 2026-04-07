import { useState, useRef } from "react";

const CORRECT_PIN = "1111";

export default function LoginPage({ onLogin }) {
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [error, setError] = useState("");
  const refs = [useRef(), useRef(), useRef(), useRef()];

  function handleChange(idx, val) {
    if (val.length > 1) val = val.slice(-1);
    if (val && !/^\d$/.test(val)) return;

    const next = [...digits];
    next[idx] = val;
    setDigits(next);
    setError("");

    if (val && idx < 3) refs[idx + 1].current?.focus();

    if (next.every(d => d !== "")) {
      const pin = next.join("");
      if (pin === CORRECT_PIN) {
        sessionStorage.setItem("notify_auth", "1");
        onLogin();
      } else {
        setError("Incorrect PIN. Try again.");
        setDigits(["", "", "", ""]);
        setTimeout(() => refs[0].current?.focus(), 200);
      }
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
          onClick={() => {
            const pin = digits.join("");
            if (pin.length < 4) { setError("Enter all 4 digits"); return; }
            if (pin === CORRECT_PIN) { sessionStorage.setItem("notify_auth", "1"); onLogin(); }
            else { setError("Incorrect PIN"); setDigits(["","","",""]); refs[0].current?.focus(); }
          }}
        >
          Unlock Dashboard
        </button>
      </div>
    </div>
  );
}
