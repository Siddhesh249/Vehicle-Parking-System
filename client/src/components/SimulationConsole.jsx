import { useCallback, useEffect, useState } from "react";
import FareTierEditor from "./FareTierEditor.jsx";
import { errorMessage, formatMoney } from "../utils/format.js";
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

const GATE_LINKS = [
  { href: "/entry-1", label: "Entry 1" },
  { href: "/entry-2", label: "Entry 2" },
  { href: "/exit-1", label: "Exit 1" },
  { href: "/exit-2", label: "Exit 2" },
  { href: "/admin", label: "Admin" },
];

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

const toDraft = (config, fallback) => ({
  firstHourFree: config?.firstHourFree ?? fallback.firstHourFree,
  tiers:
    config?.tiers?.map((tier) => ({
      afterHours: tier.afterHours,
      rate: tier.rate ?? tier.ratePerHour ?? 0,
    })) ?? fallback.tiers,
  lostTicketPenalty: config?.lostTicketPenalty ?? fallback.lostTicketPenalty,
  overstayPenalty: config?.overstayPenalty ?? fallback.overstayPenalty,
});

export default function SimulationConsole({ api }) {
  const [rateInput, setRateInput] = useState("");
  const [status, setStatus] = useState("stopped");
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fareVehicleType, setFareVehicleType] = useState("4W");
  const [fareDraft, setFareDraft] = useState(DEFAULT_DRAFTS["4W"]);
  const [fareConfigs, setFareConfigs] = useState(null);

  const applyState = useCallback((next) => {
    setState(next);
    setStatus(next.running ? "running" : "stopped");
    if (next.ratePerMinute) setRateInput(String(next.ratePerMinute));
  }, []);

  const loadStatus = useCallback(async () => {
    if (typeof api.getSimulationStatus !== "function") return;
    try {
      applyState(await api.getSimulationStatus());
    } catch {
      // Status is informational; start/stop errors are shown where they happen.
    }
  }, [api, applyState]);

  useEffect(() => {
    if (typeof api.getSimulationStatus !== "function") return undefined;
    let cancelled = false;
    api
      .getSimulationStatus()
      .then((next) => {
        if (!cancelled) applyState(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, applyState]);

  // Load the effective fare tables so an override starts from what the lot is
  // actually charging instead of a hard-coded copy.
  useEffect(() => {
    const loader = api.getSimulationFareConfig ?? api.getFareConfig;
    if (typeof loader !== "function") return undefined;
    let cancelled = false;
    loader
      .call(api)
      .then((configs) => {
        if (cancelled || !configs) return;
        setFareConfigs(configs);
        setFareDraft((current) => toDraft(configs[fareVehicleType], current));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, fareVehicleType]);

  useEffect(() => {
    if (typeof api.getSimulationStatus !== "function") return undefined;
    const timer = setInterval(() => void loadStatus(), 1500);
    return () => clearInterval(timer);
  }, [api, loadStatus]);

  function chooseFareVehicleType(nextType) {
    setFareVehicleType(nextType);
    setFareDraft((current) =>
      fareConfigs?.[nextType]
        ? toDraft(fareConfigs[nextType], DEFAULT_DRAFTS[nextType])
        : (DEFAULT_DRAFTS[nextType] ?? current),
    );
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
      setNotice("Bot fleet started. Cars now queue at the entry gates.");
    } catch (err) {
      setError(errorMessage(err, "Could not start the simulation."));
    } finally {
      setBusy(false);
    }
  }

  async function updateRate() {
    const ratePerMinute = Number(rateInput || 60);
    if (!Number.isInteger(ratePerMinute) || ratePerMinute < 1 || ratePerMinute > 600) {
      setError("Enter a whole-number rate between 1 and 600 arrivals per minute.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (typeof api.setSimulationRate === "function") {
        await api.setSimulationRate({ ratePerMinute });
      } else {
        await api.startSimulation({ ratePerMinute });
      }
      setRateInput(String(ratePerMinute));
      setNotice(`Traffic rate updated to ${ratePerMinute} cars per minute.`);
      await loadStatus();
    } catch (err) {
      setError(errorMessage(err, "Could not update the traffic rate."));
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
      setNotice("New arrivals paused. Cars already in the lot can still exit.");
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

  async function clearFareOverride() {
    if (busy || typeof api.clearSimulationFareTiers !== "function") return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.clearSimulationFareTiers();
      setNotice("Runtime fare overrides cleared. The persisted admin rates apply again.");
      const loader = api.getSimulationFareConfig ?? api.getFareConfig;
      if (typeof loader === "function") {
        const configs = await loader.call(api);
        if (configs) {
          setFareConfigs(configs);
          setFareDraft(
            toDraft(configs[fareVehicleType], DEFAULT_DRAFTS[fareVehicleType]),
          );
        }
      }
    } catch (err) {
      setError(errorMessage(err, "Could not clear the fare overrides."));
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

  const stats = state
    ? [
        { label: "Waiting at entry", value: state.waitingEntry ?? 0 },
        { label: "Parked", value: state.parked ?? 0 },
        { label: "Waiting at exit", value: state.waitingExit ?? 0 },
        { label: "Exits settled", value: state.completedExits ?? 0 },
        { label: "Revenue collected", value: formatMoney(state.revenueCollected ?? 0) },
        { label: "Queue overflow", value: state.queueOverflow ?? 0 },
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
            Spawns demo customers. They queue at entry gates, park for a set simulated
            stay, then queue at exit gates for a scan and payment.
          </p>
        </div>
        <span
          className={`simulation-console__state simulation-console__state--${status}`}
          role="status"
        >
          {status === "running" ? "Running" : "Stopped"}
        </span>
      </div>

      <div className="sim-actions">
        <form
          className="sim-rate-form"
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
              {busy && status === "stopped" ? "Starting…" : "Start fleet"}
            </button>
            {status === "running" && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void updateRate()}
                disabled={busy}
              >
                Update rate
              </button>
            )}
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

        <div className="console-shortcuts">
          <p className="eyebrow">OPEN A CONSOLE</p>
          <div className="console-shortcuts__grid">
            {GATE_LINKS.map(({ href, label }) => (
              <a
                key={href}
                className="shortcut-link"
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                {label}
                <span aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
          <p className="field-hint">
            Sign in to each tab. The bot queue is per gate, so both entry and both exit
            operators have their own cars.
          </p>
        </div>
      </div>

      {counters.length > 0 && (
        <p className="simulation-console__counters" role="status">
          {counters.join(" · ")}
        </p>
      )}
      {state?.lastError && <p className="console-error">{state.lastError}</p>}

      {stats.length > 0 && (
        <div className="fleet-grid" aria-label="Bot fleet status">
          {stats.map(({ label, value }) => (
            <div key={label} className="fleet-stat">
              <span className="fleet-stat__value">{value}</span>
              <span className="fleet-stat__label">{label}</span>
            </div>
          ))}
        </div>
      )}

      {state?.gates && (
        <div className="gate-queues" aria-label="Vehicles waiting per gate">
          {Object.entries(state.gates).map(([gateId, gate]) => (
            <div key={gateId} className="gate-queue">
              <span className="gate-queue__name">{gateId}</span>
              <span className={`gate-queue__count ${gate.waiting ? "is-busy" : ""}`}>
                {gate.waiting} waiting
              </span>
            </div>
          ))}
        </div>
      )}

      {typeof api.setSimulationFareTiers === "function" && (
        <form className="simulation-console__override" onSubmit={applyFareOverride}>
          <div>
            <p className="simulation-console__eyebrow">RUNTIME FARE OVERRIDE</p>
            <h3>Fare tiers</h3>
            <p className="field-hint">
              Changes apply to the next exit without restarting the server or resetting
              the fleet. Clear restores the admin&apos;s persisted rates.
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
          <div className="button-row">
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "Applying…" : "Apply fare override"}
            </button>
            {typeof api.clearSimulationFareTiers === "function" && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void clearFareOverride()}
                disabled={busy}
              >
                Clear overrides
              </button>
            )}
          </div>
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
        Start around 30–60 cars per minute for a comfortable demo. Each gate holds up to 8
        waiting cars; extra arrivals count as overflow. This tool is dev-only and is
        compiled out of production builds.
      </p>
    </section>
  );
}
