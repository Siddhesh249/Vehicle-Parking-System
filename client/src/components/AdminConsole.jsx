import { useCallback, useEffect, useState } from "react";
import usePanel from "../hooks/usePanel.js";
import {
  errorMessage,
  formatDuration,
  formatMoney,
  formatTimestamp,
} from "../utils/format.js";
import { OccupancyChart, RevenueChart } from "./Charts.jsx";
import "./Console.css";

// Wraps one panel: loading text, a recoverable error, or the loaded content.
function Panel({ title, state, children }) {
  return (
    <section className="console-panel">
      <h3>{title}</h3>
      {state.status === "loading" && <p role="status">Loading {title.toLowerCase()}…</p>}
      {state.status === "error" && (
        <div role="alert" className="console-error">
          <span>
            {errorMessage(state.error, `Could not load ${title.toLowerCase()}.`)}
          </span>{" "}
          <button type="button" className="link-button" onClick={state.retry}>
            Retry
          </button>
        </div>
      )}
      {state.status === "ready" && children(state.data)}
    </section>
  );
}

const cell = (value) =>
  value === undefined || value === null || value === "" ? "—" : value;

// Admin dashboard panels against the SAD 4.3.5 / 4.3.6 responses (VPS-F-041..054, VPS-F-060).
export default function AdminConsole({ api, realtime }) {
  const [plateInput, setPlateInput] = useState("");
  const [plateFilter, setPlateFilter] = useState("");
  const [alerts, setAlerts] = useState([]);
  const [releasing, setReleasing] = useState(null);
  const [alertError, setAlertError] = useState("");

  const fetchOccupancy = useCallback(() => api.getOccupancy(), [api]);
  const fetchRevenue = useCallback(() => api.getRevenue(), [api]);
  const fetchTransactions = useCallback(
    () => api.getTransactions(plateFilter ? { plate: plateFilter } : {}),
    [api, plateFilter],
  );
  const fetchAudit = useCallback(() => api.getAuditLog(), [api]);

  const occupancy = usePanel(fetchOccupancy);
  const revenue = usePanel(fetchRevenue);
  const transactions = usePanel(fetchTransactions);
  const audit = usePanel(fetchAudit);

  // Live refresh: any spot change can alter occupancy, revenue, transactions and the audit log.
  // Debounced so a burst of updates causes one reload (the refresh functions are stable).
  const refreshOccupancy = occupancy.refresh;
  const refreshRevenue = revenue.refresh;
  const refreshTransactions = transactions.refresh;
  const refreshAudit = audit.refresh;
  const refreshAll = useCallback(() => {
    refreshOccupancy();
    refreshRevenue();
    refreshTransactions();
    refreshAudit();
  }, [refreshOccupancy, refreshRevenue, refreshTransactions, refreshAudit]);

  useEffect(() => {
    if (!realtime) return undefined;
    let timer;
    const refreshSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(refreshAll, 400);
    };
    const unsubscribe = realtime.subscribe({
      onUpdate: refreshSoon,
      onOverstay: (alert) => {
        if (!alert?.vehicleId) return;
        setAlerts((current) =>
          current.some(({ vehicleId }) => vehicleId === alert.vehicleId)
            ? current
            : [alert, ...current],
        );
      },
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [realtime, refreshAll]);

  async function releaseOverstay(alert) {
    if (releasing || typeof api.forceRelease !== "function") return;
    setAlertError("");
    setReleasing(alert.vehicleId);
    try {
      await api.forceRelease(alert.vehicleId);
      setAlerts((current) =>
        current.filter(({ vehicleId }) => vehicleId !== alert.vehicleId),
      );
      refreshAll();
    } catch (err) {
      setAlertError(errorMessage(err, "Could not force-release that vehicle."));
    } finally {
      setReleasing(null);
    }
  }

  return (
    <div className="admin-grid">
      <section className="console-panel" aria-labelledby="overstay-alerts-title">
        <h3 id="overstay-alerts-title">Overstay alerts</h3>
        {alertError && (
          <p role="alert" className="console-error">
            {alertError}
          </p>
        )}
        {alerts.length === 0 ? (
          <p className="field-hint">No overstay alerts.</p>
        ) : (
          <ul className="alert-list">
            {alerts.map((alert) => (
              <li key={alert.vehicleId}>
                <div>
                  <strong className="mono">
                    {alert.plateNumber ?? alert.ticketId ?? alert.vehicleId}
                  </strong>
                  <span className="field-hint">
                    {`${alert.gateId ?? "Gate"} · parked ${formatDuration(alert.duration ?? 0)}`}
                  </span>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => releaseOverstay(alert)}
                  disabled={releasing === alert.vehicleId}
                >
                  {releasing === alert.vehicleId ? "Releasing…" : "Force release"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Panel title="Occupancy" state={occupancy}>
        {(data) => (
          <>
            <p className="big-number">{`${data.totalPct}%`}</p>
            <ul className="zone-list">
              {Object.entries(data.byZone ?? {}).map(([zone, { occupied, total }]) => (
                <li key={zone}>
                  <span>{`${zone}: ${occupied} of ${total} occupied`}</span>
                  <meter
                    min={0}
                    max={total}
                    value={occupied}
                    aria-label={`${zone} zone occupancy`}
                  />
                </li>
              ))}
            </ul>
            <OccupancyChart history={data.history} />
          </>
        )}
      </Panel>

      <Panel title="Revenue" state={revenue}>
        {(data) => (
          <>
            <p className="big-number">{formatMoney(data.total)}</p>
            <ul className="zone-list">
              {Object.entries(data.byZone ?? {}).map(([zone, amount]) => (
                <li key={zone}>{`${zone}: ${formatMoney(amount)}`}</li>
              ))}
            </ul>
            <RevenueChart byDay={data.byDay} />
          </>
        )}
      </Panel>

      <Panel title="Transactions" state={transactions}>
        {(data) => (
          <>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                setPlateFilter(plateInput.trim().toUpperCase());
              }}
            >
              <label>
                Filter by plate
                <input
                  type="text"
                  value={plateInput}
                  onChange={(e) => setPlateInput(e.target.value)}
                />
              </label>
              <button type="submit" className="secondary-button">
                Filter
              </button>
            </form>
            {data.records.length === 0 ? (
              <p className="field-hint">No transactions found.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Ticket</th>
                      <th scope="col">Plate</th>
                      <th scope="col">Type</th>
                      <th scope="col">Status</th>
                      <th scope="col">Fare</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.records.map((r) => (
                      <tr key={r.ticketId}>
                        <td className="mono">{r.ticketId}</td>
                        <td className="mono">{cell(r.plateNumber)}</td>
                        <td>{cell(r.vehicleType)}</td>
                        <td>{cell(r.status)}</td>
                        <td>{typeof r.fare === "number" ? formatMoney(r.fare) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Panel>

      <Panel title="Audit log" state={audit}>
        {(data) =>
          data.entries.length === 0 ? (
            <p className="field-hint">No audit entries yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Action</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e, index) => (
                    <tr key={`${e.createdAt}-${index}`}>
                      <td className="mono">{e.action}</td>
                      <td>{cell(e.actorRole)}</td>
                      <td>{formatTimestamp(e.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Panel>
    </div>
  );
}
