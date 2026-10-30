import { useState } from "react";
import { errorMessage } from "../utils/format.js";
import "./Console.css";

// Gate operators and the Admin sign in here (VPS-F-001..005). The password field is masked (VPS-F-004).
export default function LoginForm({ api, onSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    <section className="console-panel">
      <h3>Sign in</h3>
      <form className="console-form" onSubmit={handleSubmit} noValidate>
        <label>
          Username
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {error && (
        <p role="alert" className="console-error">
          {error}
        </p>
      )}
    </section>
  );
}
