import { useEffect, useState } from "react";
import "./Console.css";

const POLL_MS = 2000;

// Live counters from GET /api/dev/simulate/status (VPS-DEV-001). Polls while the page is open,
// so it works no matter which control started the generator.
export default function SimulationStats({ api }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!api.getSimulationStatus) return undefined;
    let cancelled = false;
    const poll = () =>
      new Promise((resolve) => resolve(api.getSimulationStatus()))
        .then((state) => {
          if (!cancelled) setStats(state);
        })
        .catch(() => {
          // Keep the last known numbers; the next poll will try again.
        });
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api]);

  return (
    <section className="console-panel">
      <h3>Live counters</h3>
      {!stats ? (
        <p className="field-hint">Waiting for the first reading…</p>
      ) : (
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
  );
}
