import { useEffect, useState } from "react";
import { errorMessage } from "../utils/format.js";
import "./Console.css";

const DEFAULT_RATE = 30; // used when the rate field is left empty
const MAX_RATE = 600; // the server's limit
const POLL_MS = 2000;

// Starting values for the fare override form (match the project's default fare tiers).
const FARE_DEFAULTS = {
  "2W": {
    tiers: [
      ["1", "10"],
      ["3", "15"],
      ["6", "25"],
    ],
    lostTicketPenalty: "50",
  },
  "4W": {
    tiers: [
      ["1", "20"],
      ["3", "30"],
      ["6", "50"],
    ],
    lostTicketPenalty: "100",
  },
};

const toNumber = (text) => (text.trim() === "" ? null : Number(text));

// Developer-only utility (VPS-DEV-001..003): generates synthetic arrivals and overrides fare tiers.
// It is reachable only by typing its address; no gate or admin screen links to it.
export default function SimulationConsole({ api }) {
  const [rateInput, setRateInput] = useState("");
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [vehicleType, setVehicleType] = useState("4W");
  const [firstHourFree, setFirstHourFree] = useState(true);
  const [tiers, setTiers] = useState(FARE_DEFAULTS["4W"].tiers);
  const [lostTicketPenalty, setLostTicketPenalty] = useState(
    FARE_DEFAULTS["4W"].lostTicketPenalty,
  );
  const [overstayPenalty, setOverstayPenalty] = useState("");
  const [fareError, setFareError] = useState("");
  const [fareMessage, setFareMessage] = useState("");

  // Syncs with the server once, and again every few seconds while the generator is on.
  // getSimulationStatus is optional on the API object, so start/stop still work without it.
  useEffect(() => {
    if (!api.getSimulationStatus) return undefined;
    let cancelled = false;
    const poll = () =>
      new Promise((resolve) => resolve(api.getSimulationStatus()))
        .then((state) => {
          if (cancelled) return;
          setRunning(Boolean(state.running));
          setStats(state);
        })
        .catch(() => {
          // Keep the last known state; the next poll will try again.
        });
    poll();
    if (!running) {
      return () => {
        cancelled = true;
      };
    }
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, running]);

  async function handleStart(event) {
    event.preventDefault();
    if (busy) return;
    const rate = rateInput.trim() === "" ? DEFAULT_RATE : Number(rateInput);
    if (!Number.isFinite(rate) || rate <= 0 || rate > MAX_RATE) {
      setError(`Enter a rate above 0 and up to ${MAX_RATE} arrivals per minute.`);
      return;
    }
    setError("");
    setBusy(true);
    try {
      await api.startSimulation({ ratePerMinute: rate });
      setRunning(true);
    } catch (err) {
      setError(errorMessage(err, "Could not start the generator."));
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await api.stopSimulation();
      setRunning(false);
    } catch (err) {
      setError(errorMessage(err, "Could not stop the generator."));
    } finally {
      setBusy(false);
    }
  }

  function chooseVehicleType(type) {
    setVehicleType(type);
    setTiers(FARE_DEFAULTS[type].tiers);
    setLostTicketPenalty(FARE_DEFAULTS[type].lostTicketPenalty);
    setFareMessage("");
  }

  function updateTier(index, position, value) {
    setTiers((rows) =>
      rows.map((row, i) =>
        i === index ? row.map((cell, p) => (p === position ? value : cell)) : row,
      ),
    );
  }

  async function handleFareSubmit(event) {
    event.preventDefault();
    setFareMessage("");

    // Blank rows are ignored; the others need increasing start hours and non-negative rates.
    const parsed = tiers
      .filter(([hours, rate]) => hours.trim() !== "" || rate.trim() !== "")
      .map(([hours, rate]) => ({
        afterHours: toNumber(hours),
        ratePerHour: toNumber(rate),
      }));
    const tiersValid =
      parsed.length > 0 &&
      parsed.every(
        (t, i) =>
          Number.isFinite(t.afterHours) &&
          t.afterHours >= 0 &&
          Number.isFinite(t.ratePerHour) &&
          t.ratePerHour >= 0 &&
          (i === 0 || t.afterHours > parsed[i - 1].afterHours),
      );
    if (!tiersValid) {
      setFareError(
        "Fill in each tier with a start hour and a rate. Start hours must increase.",
      );
      return;
    }

    const payload = { vehicleType, firstHourFree, tiers: parsed };
    for (const [key, text] of [
      ["lostTicketPenalty", lostTicketPenalty],
      ["overstayPenalty", overstayPenalty],
    ]) {
      const value = toNumber(text);
      if (value === null) continue;
      if (!Number.isFinite(value) || value < 0) {
        setFareError("Penalties must be zero or more.");
        return;
      }
      payload[key] = value;
    }

    setFareError("");
    try {
      await api.setFareOverride(payload);
      setFareMessage(`Fare override applied for ${vehicleType}.`);
    } catch (err) {
      setFareError(errorMessage(err, "Could not apply the fare override."));
    }
  }

  return (
    <div className="sim-grid">
      <section className="console-panel">
        <h2>Simulation console</h2>
        <p className="field-hint">
          Developer tool that creates fake arrivals for demos and load testing. It is not
          part of the deployed system.
        </p>

        <form className="console-form" onSubmit={handleStart} noValidate>
          <label>
            Arrivals per minute
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max={MAX_RATE}
              placeholder={String(DEFAULT_RATE)}
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
              aria-describedby="rate-help"
            />
          </label>
          <button type="submit" className="primary-button" disabled={busy}>
            Start simulation
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={handleStop}
            disabled={busy || !running}
          >
            Stop simulation
          </button>
          <p id="rate-help" className="field-hint">
            Leave empty for {DEFAULT_RATE}. The maximum is {MAX_RATE}.
          </p>
        </form>

        {error && (
          <p role="alert" className="console-error">
            {error}
          </p>
        )}

        <p role="status" className="sim-status">
          Generator:{" "}
          <strong className={running ? "sim-on" : "sim-off"}>
            {running ? "Running" : "Stopped"}
          </strong>
        </p>

        {stats && (
          <dl className="detail-list">
            <dt>Rate</dt>
            <dd>{`${stats.ratePerMinute} per minute`}</dd>
            <dt>Generated arrivals</dt>
            <dd>{stats.generatedArrivals}</dd>
            <dt>Parked</dt>
            <dd>{stats.successfulAllocations}</dd>
            <dt>Turned away (lot full)</dt>
            <dd>{stats.fullLotArrivals}</dd>
            {stats.lastError && (
              <>
                <dt>Last error</dt>
                <dd>{stats.lastError}</dd>
              </>
            )}
          </dl>
        )}
      </section>

      <section className="console-panel">
        <h3>Fare override</h3>
        <p className="field-hint">
          Changes the fare tiers for new exits until the server restarts.
        </p>

        <form className="fare-form" onSubmit={handleFareSubmit} noValidate>
          <label>
            Vehicle type
            <select
              value={vehicleType}
              onChange={(e) => chooseVehicleType(e.target.value)}
            >
              <option value="2W">2W (two-wheeler)</option>
              <option value="4W">4W (four-wheeler)</option>
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={firstHourFree}
              onChange={(e) => setFirstHourFree(e.target.checked)}
            />
            First hour free
          </label>

          {tiers.map(([hours, rate], index) => (
            <div className="tier-row" key={index}>
              <label>
                {`Tier ${index + 1} starts after (hours)`}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={hours}
                  onChange={(e) => updateTier(index, 0, e.target.value)}
                />
              </label>
              <label>
                {`Tier ${index + 1} rate per hour`}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={rate}
                  onChange={(e) => updateTier(index, 1, e.target.value)}
                />
              </label>
            </div>
          ))}

          <label>
            Lost-ticket penalty
            <input
              type="number"
              min="0"
              step="any"
              value={lostTicketPenalty}
              onChange={(e) => setLostTicketPenalty(e.target.value)}
            />
          </label>
          <label>
            Overstay penalty
            <input
              type="number"
              min="0"
              step="any"
              value={overstayPenalty}
              onChange={(e) => setOverstayPenalty(e.target.value)}
            />
          </label>
          <button type="submit" className="secondary-button">
            Apply fare override
          </button>
        </form>

        {fareError && (
          <p role="alert" className="console-error">
            {fareError}
          </p>
        )}
        {fareMessage && <p role="status">{fareMessage}</p>}
      </section>
    </div>
  );
}
