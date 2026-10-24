import { useCallback, useState } from "react";
import usePanel from "../hooks/usePanel.js";
import { errorMessage, formatMoney, formatTimestamp } from "../utils/format.js";
import "./Console.css";

// Wraps one panel: loading text, a recoverable error, or the loaded content.
function Panel({ title, state, children }) {
  return (
    <section className="console-panel">
      <h3>{title}</h3>
      {state.status === "loading" && <p role="status">Loading {title.toLowerCase()}…</p>}
      {state.status === "error" && (
        <div role="alert" className="console-error">
          <span>{errorMessage(state.error, `Could not load ${title.toLowerCase()}.`)}</span>{" "}
          <button type="button" className="link-button" onClick={state.retry}>
            Retry
          </button>
        </div>
      )}
      {state.status === "ready" && children(state.data)}
    </section>
  );
}

const cell = (value) => (value === undefined || value === null || value === "" ? "—" : value);

// Admin dashboard panels against the mocked SAD 4.3.5 / 4.3.6 responses (VPS-F-050..054, VPS-F-060).
export default function AdminConsole({ api }) {
  const [plateInput, setPlateInput] = useState("");
  const [plateFilter, setPlateFilter] = useState("");

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

  return (
    <div className="admin-grid">
      <Panel title="Occupancy" state={occupancy}>
        {(data) => (
          <>
            <p className="big-number">{`${data.totalPct}%`}</p>
            <ul className="zone-list">
              {Object.entries(data.byZone ?? {}).map(([zone, { occupied, total }]) => (
                <li key={zone}>
                  <span>{`${zone}: ${occupied} of ${total} occupied`}</span>
                  <meter min={0} max={total} value={occupied} aria-label={`${zone} zone occupancy`} />
                </li>
              ))}
            </ul>
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
                <input type="text" value={plateInput} onChange={(e) => setPlateInput(e.target.value)} />
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
