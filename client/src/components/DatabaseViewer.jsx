import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../utils/format.js";
import "./Console.css";

const COLLECTION_LABELS = {
  spots: "Spots",
  vehicles: "Vehicles",
  transactions: "Transactions",
  auditlogs: "Audit log",
  users: "Users",
  faretierconfigs: "Fare config",
  systemconfigs: "System config",
};

const cellText = (value) => {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

function columnsFor(rows) {
  const columns = [];
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  return columns;
}

// Raw Mongo collection browser for the Admin's root-level access (VPS-F-054).
// Tables are full-width and scroll vertically, so every column stays readable
// without the panel growing without limit.
export default function DatabaseViewer({ api }) {
  const [snapshot, setSnapshot] = useState(null);
  const [active, setActive] = useState("transactions");
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const data = await api.getDatabase();
      setSnapshot(data);
      const names = Object.keys(data.collections ?? {});
      setActive((current) => (names.includes(current) ? current : (names[0] ?? "")));
      setStatus("ready");
    } catch (err) {
      setError(errorMessage(err, "Could not read the database."));
      setStatus("error");
    }
  }, [api]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const names = Object.keys(snapshot?.collections ?? {});
  const rows = snapshot?.collections?.[active] ?? [];
  const columns = columnsFor(rows);

  return (
    <section className="console-panel database-panel" aria-labelledby="database-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">ROOT ACCESS · READ ONLY</p>
          <h3 id="database-title">Database</h3>
        </div>
        <div className="button-row">
          {snapshot && (
            <span className="field-hint">
              {`${snapshot.counts?.[active] ?? rows.length} rows · showing ${rows.length}`}
            </span>
          )}
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() => void load()}
            disabled={status === "loading"}
          >
            {status === "loading" ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {status === "error" && (
        <div role="alert" className="console-error">
          <span>{error}</span>{" "}
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={load}
          >
            Retry
          </button>
        </div>
      )}

      {names.length > 0 && (
        <div className="db-tabs" role="tablist" aria-label="Database collections">
          {names.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={active === name}
              className={`db-tab ${active === name ? "db-tab--active" : ""}`}
              onClick={() => setActive(name)}
            >
              {COLLECTION_LABELS[name] ?? name}
              <span className="db-tab__count">{snapshot.counts?.[name] ?? 0}</span>
            </button>
          ))}
        </div>
      )}

      {status === "loading" && !snapshot && <p role="status">Reading collections…</p>}

      {snapshot && rows.length === 0 && (
        <p className="field-hint">This collection is empty.</p>
      )}

      {rows.length > 0 && (
        <div className="table-wrap db-table-wrap">
          <table aria-label={`${COLLECTION_LABELS[active] ?? active} collection`}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th scope="col" key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row._id ?? index}>
                  {columns.map((column) => (
                    <td key={column} className={column === "_id" ? "mono" : undefined}>
                      {cellText(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {snapshot?.truncated?.[active] && (
        <p className="field-hint">
          {`Showing the first ${snapshot.rowLimit} rows of ${snapshot.counts?.[active]}.`}
        </p>
      )}
    </section>
  );
}
