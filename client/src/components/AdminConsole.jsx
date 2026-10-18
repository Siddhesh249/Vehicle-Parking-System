import { useEffect, useState } from "react";
import "./ConsoleComponents.css";

const initialData = { occupancy: null, revenue: null, transactions: [], auditEntries: [] };

function AdminConsole({ api }) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    Promise.all([
      api.getOccupancy(),
      api.getRevenue(),
      api.getTransactions(),
      api.getAuditLog(),
    ]).then(([occupancy, revenue, transactionResult, auditResult]) => {
      if (!active) return;
      setData({
        occupancy,
        revenue,
        transactions: transactionResult.records || [],
        auditEntries: auditResult.entries || [],
      });
    }).catch((requestError) => {
      if (active) setError(requestError.message || "Dashboard data is unavailable. Please retry.");
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [api, reloadCount]);

  return (
    <section className="console-workspace admin-workspace" aria-labelledby="admin-title">
      <div className="workspace-heading">
        <div>
          <p className="workspace-kicker">PARKING OVERVIEW</p>
          <h2 id="admin-title">Operations dashboard</h2>
          <p className="workspace-description">Occupancy, revenue, transactions, and activity in one view.</p>
        </div>
        <span className="gate-badge">Admin</span>
      </div>

      {loading && <p className="loading-note" role="status">Loading dashboard…</p>}
      {error && (
        <div className="error-recovery">
          <p className="notice notice-error" role="alert">{error}</p>
          <button className="secondary-button" onClick={() => setReloadCount((count) => count + 1)} type="button">Retry dashboard data</button>
        </div>
      )}
      {!loading && !error && data.occupancy && data.revenue && (
        <>
          <div className="metric-grid">
            <article className="panel metric-card">
              <p className="metric-label">Total occupancy</p>
              <p className="metric-value">{data.occupancy.totalPct}%</p>
              <div className="metric-track" role="img" aria-label={`${data.occupancy.totalPct}% of parking spots occupied`}>
                <span style={{ width: `${Math.max(0, Math.min(100, Number(data.occupancy.totalPct) || 0))}%` }} />
              </div>
            </article>
            <article className="panel metric-card">
              <p className="metric-label">Total revenue</p>
              <p className="metric-value">₹{Number(data.revenue.total || 0).toLocaleString("en-IN")}</p>
              <p className="metric-footnote">Across completed parking sessions</p>
            </article>
            <article className="panel metric-card">
              <p className="metric-label">Active transactions</p>
              <p className="metric-value">{data.transactions.filter((record) => record.status === "active").length}</p>
              <p className="metric-footnote">Vehicles currently in the lot</p>
            </article>
          </div>

          <div className="admin-columns">
            <section className="panel dashboard-panel" aria-labelledby="zones-heading">
              <div className="panel-heading">
                <div><p className="workspace-kicker">LIVE CAPACITY</p><h3 id="zones-heading">Occupancy by zone</h3></div>
              </div>
              {Object.entries(data.occupancy.byZone || {}).map(([zone, values]) => {
                const occupied = Number(values.occupied) || 0;
                const total = Number(values.total) || 0;
                const percent = total ? Math.round((occupied / total) * 100) : 0;
                return (
                  <div className="zone-row" key={zone}>
                    <div className="zone-label"><strong>{zone} zone</strong><span>{occupied} of {total} occupied</span></div>
                    <div className="metric-track" role="img" aria-label={`${zone} zone ${percent}% occupied`}>
                      <span style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              })}
              {Object.keys(data.occupancy.byZone || {}).length === 0 && <p className="empty-state">No zone data available yet.</p>}
            </section>

            <section className="panel dashboard-panel" aria-labelledby="revenue-heading">
              <div className="panel-heading">
                <div><p className="workspace-kicker">REVENUE MIX</p><h3 id="revenue-heading">By vehicle zone</h3></div>
              </div>
              {Object.entries(data.revenue.byZone || {}).map(([zone, amount]) => (
                <div className="revenue-row" key={zone}><span>{zone} zone</span><strong>₹{Number(amount || 0).toLocaleString("en-IN")}</strong></div>
              ))}
              {Object.keys(data.revenue.byZone || {}).length === 0 && <p className="empty-state">No revenue breakdown available yet.</p>}
            </section>
          </div>

          <section className="panel table-panel" aria-labelledby="transactions-heading">
            <div className="panel-heading">
              <div><p className="workspace-kicker">PARKING ACTIVITY</p><h3 id="transactions-heading">Transactions</h3></div>
              <span className="record-count">{data.transactions.length} records</span>
            </div>
            {data.transactions.length ? (
              <div className="table-scroll"><table>
                <thead><tr><th scope="col">Ticket</th><th scope="col">Plate number</th><th scope="col">Status</th></tr></thead>
                <tbody>{data.transactions.map((record) => (
                  <tr key={record.ticketId || record._id}>
                    <td>{record.ticketId || "—"}</td><td>{record.plateNumber || "—"}</td>
                    <td><span className={`state-badge ${record.status === "active" ? "state-active" : "state-complete"}`}><span aria-hidden="true">●</span> {record.status || "Unknown"}</span></td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <p className="empty-state">No transactions to show.</p>}
          </section>

          <section className="panel table-panel" aria-labelledby="audit-heading">
            <div className="panel-heading">
              <div><p className="workspace-kicker">SYSTEM HISTORY</p><h3 id="audit-heading">Recent audit activity</h3></div>
              <span className="record-count">{data.auditEntries.length} entries</span>
            </div>
            {data.auditEntries.length ? (
              <div className="audit-list">{data.auditEntries.map((entry, index) => (
                <article className="audit-row" key={`${entry.action}-${entry.createdAt || index}`}>
                  <span className="audit-mark" aria-hidden="true">•</span>
                  <div><strong>{entry.action}</strong><span>{entry.actorRole || "System"}</span></div>
                  <time>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "Recent"}</time>
                </article>
              ))}</div>
            ) : <p className="empty-state">No audit activity to show.</p>}
          </section>
          <p className="demo-note">Sprint 2 preview · sample API data</p>
        </>
      )}
    </section>
  );
}

export default AdminConsole;
