import { useCallback, useEffect, useState } from "react";
import FareTierEditor from "./FareTierEditor.jsx";
import { errorMessage } from "../utils/format.js";
import "./Console.css";
import "./SimulationConsole.css";

const DEFAULT_DRAFTS = {
  "2W": {
    firstHourFree: true,
    tiers: [
      { afterHours: 1, rate: 10 },
      { afterHours: 3, rate: 15 },
      { afterHours: 6, rate: 25 },
    ],
    lostTicketPenalty: 50,
    overstayPenalty: 100,
  },
  "4W": {
    firstHourFree: true,
    tiers: [
      { afterHours: 1, rate: 20 },
      { afterHours: 3, rate: 30 },
      { afterHours: 6, rate: 50 },
    ],
    lostTicketPenalty: 100,
    overstayPenalty: 200,
  },
};

function normalizeFare(draft) {
  const tiers = draft.tiers.map((tier, index) => {
    const afterHours = tier.afterHours === "" ? Number.NaN : Number(tier.afterHours);
    const rate = tier.rate === "" ? Number.NaN : Number(tier.rate);
    if (
      !Number.isFinite(afterHours) ||
      afterHours < 0 ||
      !Number.isFinite(rate) ||
      rate < 0
    ) {
      throw new Error(`Tier ${index + 1} needs non-negative numbers.`);
    }
    return { afterHours, ratePerHour: rate };
  });
  tiers.forEach((tier, index) => {
    if (index > 0 && tier.afterHours <= tiers[index - 1].afterHours) {
      throw new Error("Each tier must start later than the tier above it.");
    }
  });

  const lostTicketPenalty = Number(draft.lostTicketPenalty);
  const overstayPenalty = Number(draft.overstayPenalty);
  if (
    !Number.isFinite(lostTicketPenalty) ||
    lostTicketPenalty < 0 ||
    !Number.isFinite(overstayPenalty) ||
    overstayPenalty < 0
  ) {
    throw new Error("Penalties must be non-negative numbers.");
  }

  return {
    firstHourFree: draft.firstHourFree !== false,
    tiers,
    lostTicketPenalty,
    overstayPenalty,
  };
}

export default function SimulationConsole({ api }) {
  const [rateInput, setRateInput] = useState("");
  const [status, setStatus] = useState("stopped");
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fareVehicleType, setFareVehicleType] = useState("4W");
  const [fareDraft, setFareDraft] = useState(DEFAULT_DRAFTS["4W"]);

  const loadStatus = useCallback(async () => {
    if (typeof api.getSimulationStatus !== "function") return;
    try {
      const next = await api.getSimulationStatus();
      setState(next);
      setStatus(next.running ? "running" : "stopped");
      if (next.ratePerMinute) setRateInput(String(next.ratePerMinute));
    } catch {
      // Status is informational; start/stop errors are shown where they happen.
    }
  }, [api]);

  useEffect(() => {
    if (typeof api.getSimulationStatus !== "function") return undefined;
    let cancelled = false;
    api
      .getSimulationStatus()
      .then((next) => {
        if (cancelled) return;
        setState(next);
        setStatus(next.running ? "running" : "stopped");
        if (next.ratePerMinute) setRateInput(String(next.ratePerMinute));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (status !== "running" || typeof api.getSimulationStatus !== "function") {
      return undefined;
    }
    const timer = setInterval(() => void loadStatus(), 2000);
    return () => clearInterval(timer);
  }, [status, api, loadStatus]);

  function chooseFareVehicleType(nextType) {
    setFareVehicleType(nextType);
    setFareDraft(DEFAULT_DRAFTS[nextType]);
    setError("");
    setNotice("");
  }

  async function start() {
    const ratePerMinute = Number(rateInput || 60);
    if (!Number.isInteger(ratePerMinute) || ratePerMinute < 1 || ratePerMinute > 600) {
      setError("Enter a whole-number rate between 1 and 600 arrivals per minute.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.startSimulation({ ratePerMinute });
      setRateInput(String(ratePerMinute));
      setStatus("running");
      await loadStatus();
    } catch (err) {
      setError(errorMessage(err, "Could not start the simulation."));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.stopSimulation();
      setStatus("stopped");
      await loadStatus();
    } catch (err) {
      setError(errorMessage(err, "Could not stop the simulation."));
    } finally {
      setBusy(false);
    }
  }

  async function applyFareOverride(event) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    let payload;
    try {
      payload = normalizeFare(fareDraft);
    } catch (validationError) {
      setError(validationError.message);
      return;
    }

    setBusy(true);
    try {
      await api.setSimulationFareTiers({ vehicleType: fareVehicleType, ...payload });
      setNotice(
        `${fareVehicleType} fare override applied. The next exit uses the new rates.`,
      );
    } catch (err) {
      setError(errorMessage(err, "Could not apply the fare override."));
    } finally {
      setBusy(false);
    }
  }

  const counters = state
    ? [
        `${state.generatedArrivals ?? 0} arrivals generated`,
        `${state.successfulAllocations ?? 0} parked`,
        `${state.fullLotArrivals ?? 0} turned away (lot full)`,
      ]
    : [];

  return (
    <section
      className="simulation-console console-panel"
      aria-labelledby="simulation-console-title"
    >
      <div className="simulation-console__heading">
        <div>
          <p className="simulation-console__eyebrow">DEVELOPER TOOL</p>
          <h2 id="simulation-console-title">Simulation Console</h2>
          <p>
            Generate synthetic vehicle arrivals against the parking allocation service.
          </p>
        </div>
        <span
          className={`simulation-console__state simulation-console__state--${status}`}
          role="status"
        >
          {status === "running" ? "Running" : "Stopped"}
        </span>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
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
            disabled={busy}
          />
        </label>
        <div className="simulation-console__actions">
          <button
            type="submit"
            className="primary-button"
            disabled={busy || status === "running"}
          >
            {busy && status === "stopped" ? "Starting…" : "Start"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void stop()}
            disabled={busy || status !== "running"}
          >
            {busy && status === "running" ? "Stopping…" : "Stop"}
          </button>
        </div>
      </form>

      {counters.length > 0 && (
        <p className="simulation-console__counters" role="status">
          {counters.join(" · ")}
        </p>
      )}
      {state?.lastError && <p className="console-error">{state.lastError}</p>}

      {typeof api.setSimulationFareTiers === "function" && (
        <form className="simulation-console__override" onSubmit={applyFareOverride}>
          <div>
            <p className="simulation-console__eyebrow">RUNTIME FARE OVERRIDE</p>
            <h3>Fare tiers</h3>
            <p className="field-hint">
              Changes apply to the next exit without restarting the server.
            </p>
          </div>
          <label className="simulation-console__field" htmlFor="simulation-fare-type">
            Vehicle type
            <select
              id="simulation-fare-type"
              value={fareVehicleType}
              onChange={(event) => chooseFareVehicleType(event.target.value)}
              disabled={busy}
            >
              <option value="2W">2W</option>
              <option value="4W">4W</option>
            </select>
          </label>
          <FareTierEditor
            value={fareDraft}
            onChange={setFareDraft}
            idPrefix="simulation-fare"
            disabled={busy}
          />
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? "Applying…" : "Apply fare override"}
          </button>
        </form>
      )}

      {error && (
        <p className="console-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="field-hint" role="status">
          {notice}
        </p>
      )}
      <p className="field-hint">
        Developer-only control. Supported rate: 1–600 arrivals per minute.
      </p>
    </section>
  );
}
