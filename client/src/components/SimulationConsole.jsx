import { useState } from "react";
import "./SimulationConsole.css";

export default function SimulationConsole({ api }) {
  const [rateInput, setRateInput] = useState("");
  const [status, setStatus] = useState("stopped");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    const ratePerMinute = Number(rateInput || 60);
    if (!Number.isInteger(ratePerMinute) || ratePerMinute < 1 || ratePerMinute > 600) {
      setError("Enter a whole-number rate between 1 and 600 arrivals per minute.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.startSimulation({ ratePerMinute });
      setRateInput(String(ratePerMinute));
      setStatus("running");
    } catch (err) {
      setError(err?.message || "Could not start the simulation.");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setError("");
    try {
      await api.stopSimulation();
      setStatus("stopped");
    } catch (err) {
      setError(err?.message || "Could not stop the simulation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="simulation-console console-panel" aria-labelledby="simulation-console-title">
      <div className="simulation-console__heading">
        <div>
          <p className="simulation-console__eyebrow">DEVELOPER TOOL</p>
          <h2 id="simulation-console-title">Simulation Console</h2>
          <p>Generate synthetic vehicle arrivals against the parking allocation service.</p>
        </div>
        <span className={`simulation-console__state simulation-console__state--${status}`} role="status">
          {status === "running" ? "Running" : "Stopped"}
        </span>
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void start(); }}>
        <label className="simulation-console__field" htmlFor="simulation-rate">
          Arrivals per minute
          <input
            id="simulation-rate"
            name="ratePerMinute"
            type="number"
            min="1"
            max="600"
            step="1"
            value={rateInput}
            onChange={(event) => setRateInput(event.target.value)}
            placeholder="60"
          />
        </label>
        <div className="simulation-console__actions">
          <button type="submit" className="primary-button" disabled={busy || status === "running"}>
            {busy && status === "stopped" ? "Starting…" : "Start"}
          </button>
          <button type="button" className="secondary-button" onClick={stop} disabled={busy || status !== "running"}>
            {busy && status === "running" ? "Stopping…" : "Stop"}
          </button>
        </div>
      </form>

      {error && <p className="console-error" role="alert">{error}</p>}
      <p className="field-hint">Developer-only control. Supported rate: 1–600 arrivals per minute.</p>
    </section>
  );
}
