/* global __DEMO_PASSWORD__ */
import { useRef, useState } from "react";
import { errorMessage } from "../utils/format.js";
import "./Console.css";

// Local demo accounts. The quick-fill buttons only populate the form; the
// credentials still travel through the normal login API (bcrypt + JWT).
// `npm start` injects the seeded password; the fallback matches the default seed.
const DEMO_PASSWORD =
  typeof __DEMO_PASSWORD__ === "undefined" ? "password123" : __DEMO_PASSWORD__;

const DEMO_ACCOUNTS = [
  { username: "entry1", label: "Entry 1", role: "Gate operator", gateId: "Entry-1" },
  { username: "entry2", label: "Entry 2", role: "Gate operator", gateId: "Entry-2" },
  { username: "exit1", label: "Exit 1", role: "Gate operator", gateId: "Exit-1" },
  { username: "exit2", label: "Exit 2", role: "Gate operator", gateId: "Exit-2" },
  { username: "admin", label: "Admin", role: "Manager", gateId: "All gates" },
];

// Gate operators and the Admin sign in here (VPS-F-001..005). The password field is masked (VPS-F-004).
export default function LoginForm({
  api,
  onSuccess,
  context = "",
  demoAccounts = DEMO_ACCOUNTS,
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitRef = useRef(null);

  function quickFill(account) {
    setUsername(account.username);
    setPassword(DEMO_PASSWORD);
    setError("");
    submitRef.current?.focus();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const { token, role, gateId } = await api.login({
        username: username.trim(),
        password,
      });
      onSuccess({ token, role, gateId });
    } catch (err) {
      setPassword("");
      setError(errorMessage(err, "Could not sign in."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-card__intro">
        <p className="eyebrow">SECURE ACCESS</p>
        <h2 id="login-title">{context || "Sign in to your gate"}</h2>
        <p className="login-card__lede">
          Every ticket and payment is attributed to the signed-in gate account.
        </p>
      </div>

      <form className="console-form login-form" onSubmit={handleSubmit} noValidate>
        <label className="login-field">
          Username
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="entry1"
          />
        </label>
        <label className="login-field">
          Password
          <span className="password-field">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
            />
            <button
              type="button"
              className="ghost-button password-toggle"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide characters" : "Show characters"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </span>
        </label>
        <button
          ref={submitRef}
          type="submit"
          className="primary-button login-submit"
          disabled={busy}
        >
          {busy ? "Signing in…" : "Sign in →"}
        </button>
      </form>

      {error && (
        <p role="alert" className="console-error">
          {error}
        </p>
      )}

      <div className="demo-accounts">
        <div className="demo-accounts__heading">
          <h3>Demo accounts</h3>
          <span className="demo-pill">one click to fill</span>
        </div>
        <p className="field-hint">
          Fills the form only. The backend still verifies the password and issues the JWT.
        </p>
        <div className="demo-accounts__grid">
          {demoAccounts.map((account) => (
            <button
              key={account.username}
              type="button"
              className="demo-account"
              onClick={() => quickFill(account)}
            >
              <span className="demo-account__badge" aria-hidden="true">
                {account.role === "Manager" ? "A" : "G"}
              </span>
              <span className="demo-account__copy">
                <strong>{account.label}</strong>
                <span>{`${account.username} · ${account.gateId}`}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
