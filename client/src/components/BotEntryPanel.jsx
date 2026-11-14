import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../utils/format.js";
import "./Console.css";

const POLL_MS = 1500;

// The demo traffic fleet queues "bot" cars at each entry gate. The operator
// still has to press Generate ticket, which creates a real spot + transaction.
export default function BotEntryPanel({ api, gateId, onAdmitted }) {
  const [queue, setQueue] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await api.getEntryQueue({ gateId });
      setQueue(next);
    } catch {
      // Polling is best-effort; the manual entry flow keeps working.
    }
  }, [api, gateId]);

  useEffect(() => {
    const kickoff = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(timer);
    };
  }, [load]);

  async function admit() {
    if (!queue?.bot || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const ticket = await api.admitEntryBot({ botId: queue.bot.botId, gateId });
      setNotice(`Ticket ${ticket.ticketId} issued. The car is now parked.`);
      onAdmitted?.(ticket);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not issue a ticket for this vehicle."));
    } finally {
      setBusy(false);
    }
  }

  const bot = queue?.bot;

  return (
    <section className="console-panel bot-panel" aria-labelledby="bot-entry-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">SIMULATED CUSTOMER</p>
          <h3 id="bot-entry-title">Vehicle at this gate</h3>
        </div>
        <span
          className={`queue-badge ${queue?.queueLength ? "queue-badge--active" : ""}`}
        >
          {queue?.queueLength ?? 0} waiting
        </span>
      </div>

      {!bot ? (
        <div className="gate-empty">
          <span className="gate-empty__icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <strong>Gate is clear</strong>
            <p className="field-hint">
              Start the traffic generator in the{" "}
              <a href="/dev/simulate" target="_blank" rel="noreferrer">
                simulation console
              </a>{" "}
              to send cars here.
            </p>
          </div>
        </div>
      ) : (
        <div className="arrival-card">
          <div className="arrival-card__top">
            <div>
              <span className="arrival-card__label">Just arrived</span>
              <p className="arrival-card__plate mono">{bot.plateNumber}</p>
            </div>
            <span className="type-chip">{bot.vehicleType}</span>
          </div>
          <ol className="step-list">
            <li className="step-list__done">
              Vehicle arrived · waiting {bot.waitSeconds}s
            </li>
            <li>Generate the ticket and assign a spot</li>
          </ol>
          <button
            type="button"
            className="primary-button"
            onClick={() => void admit()}
            disabled={busy}
          >
            {busy ? "Issuing ticket…" : "Generate ticket"}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="console-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="field-hint">
          {notice}
        </p>
      )}
    </section>
  );
}
