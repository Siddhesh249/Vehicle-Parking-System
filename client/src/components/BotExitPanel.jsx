import { useCallback, useEffect, useState } from "react";
import QrPattern from "./QrPattern.jsx";
import {
  describeBreakdown,
  errorMessage,
  formatHours,
  formatMoney,
} from "../utils/format.js";
import "./Console.css";

const POLL_MS = 1500;

// Exit-side demo flow: a parked bot car presents itself here. The operator scans
// the ticket (or handles a lost ticket), sees the fare, then takes payment.
export default function BotExitPanel({ api, gateId, onSettled }) {
  const [queue, setQueue] = useState(null);
  const [scanned, setScanned] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await api.getExitQueue({ gateId });
      setQueue(next);
      setScanned((current) => {
        if (!current) return current;
        // A settled / replaced vehicle clears the scan card.
        if (!next?.bot || next.bot.botId !== current.botId) return null;
        return current;
      });
    } catch {
      // Polling is best-effort; manual lookup still works.
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

  async function scan() {
    if (!queue?.bot || busy) return;
    setBusy(true);
    setError("");
    setReceipt(null);
    try {
      const details = await api.scanExitBot({ botId: queue.bot.botId, gateId });
      setScanned(details);
    } catch (err) {
      setError(errorMessage(err, "Could not scan this vehicle's ticket."));
    } finally {
      setBusy(false);
    }
  }

  async function settle() {
    if (!scanned || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.settleExitBot({ botId: scanned.botId, gateId });
      setReceipt(result);
      setScanned(null);
      onSettled?.(result);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not settle this exit."));
    } finally {
      setBusy(false);
    }
  }

  const bot = queue?.bot;
  const breakdown = scanned?.quote ? describeBreakdown(scanned.quote.breakdown) : "";
  const fare = scanned?.quote ? formatMoney(scanned.quote.fare) : "";

  return (
    <section className="console-panel bot-panel" aria-labelledby="bot-exit-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">EXIT QUEUE</p>
          <h3 id="bot-exit-title">Vehicle at this gate</h3>
        </div>
        <span
          className={`queue-badge ${queue?.queueLength ? "queue-badge--active" : ""}`}
        >
          {queue?.queueLength ?? 0} waiting
        </span>
      </div>

      {!bot && !receipt ? (
        <div className="gate-empty">
          <span className="gate-empty__icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <strong>No car at the exit</strong>
            <p className="field-hint">
              Parked demo cars drive here when their stay ends. Use the{" "}
              <a href="/dev/simulate" target="_blank" rel="noreferrer">
                simulation console
              </a>{" "}
              to start traffic.
            </p>
          </div>
        </div>
      ) : null}

      {receipt ? (
        <div className="ticket-card receipt-card" role="status">
          <div className="receipt-card__top">
            <h4>Payment collected</h4>
            <span className="paid-chip">PAID</span>
          </div>
          <p className="receipt-total">{formatMoney(receipt.fare)}</p>
          <dl className="detail-list">
            <dt>Vehicle</dt>
            <dd className="mono">{receipt.plateNumber}</dd>
            <dt>Duration</dt>
            <dd>{formatHours(receipt.durationHours ?? 0)}</dd>
            <dt>Fare</dt>
            <dd>
              {formatMoney(receipt.fare)}
              {describeBreakdown(receipt.breakdown)
                ? ` (${describeBreakdown(receipt.breakdown)})`
                : ""}
            </dd>
            {receipt.penaltyApplied && (
              <>
                <dt>Penalty</dt>
                <dd>Lost-ticket penalty applied</dd>
              </>
            )}
            <dt>Receipt</dt>
            <dd className="mono">{receipt.receiptId}</dd>
          </dl>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setReceipt(null)}
          >
            Collect next vehicle
          </button>
        </div>
      ) : null}

      {bot && !receipt ? (
        <div className="arrival-card">
          {!scanned ? (
            <>
              <div className="arrival-card__top">
                <div>
                  <span className="arrival-card__label">Car waiting at {gateId}</span>
                  <p className="arrival-card__plate">Scan to identify</p>
                </div>
                <span className={`type-chip ${bot.hasTicket ? "" : "type-chip--warn"}`}>
                  {bot.hasTicket ? "Ticket ready" : "No ticket"}
                </span>
              </div>
              <div className="scan-row">
                {bot.hasTicket ? (
                  <QrPattern value={bot.botId} />
                ) : (
                  <div className="lost-ticket-mark" aria-hidden="true">
                    ?
                  </div>
                )}
                <p className="field-hint scan-caption">
                  {bot.hasTicket
                    ? "The driver presents this QR ticket at the barrier. Scan it to calculate the fare."
                    : "The driver cannot find the ticket. Scan the plate and apply the lost-ticket penalty."}
                </p>
              </div>
              <ol className="step-list">
                <li className="step-list__done">
                  Vehicle drove up · waiting {bot.waitSeconds}s
                </li>
                <li>Scan the QR ticket at the barrier</li>
                <li>Collect payment and release the car</li>
              </ol>
              <button
                type="button"
                className="primary-button"
                onClick={() => void scan()}
                disabled={busy}
              >
                {busy
                  ? "Scanning…"
                  : bot.hasTicket
                    ? "Scan ticket"
                    : "Review lost ticket"}
              </button>
            </>
          ) : (
            <>
              <div className="arrival-card__top">
                <div>
                  <span className="arrival-card__label">
                    {scanned.lostTicket ? "Lost-ticket customer" : "Ticket scanned"}
                  </span>
                  <p className="arrival-card__plate mono">{scanned.plateNumber}</p>
                </div>
                <span className="type-chip">{scanned.vehicleType}</span>
              </div>

              <div className="scan-row">
                {scanned.hasTicket ? (
                  <QrPattern value={scanned.ticketId} />
                ) : (
                  <div className="lost-ticket-mark" aria-hidden="true">
                    ?
                  </div>
                )}
                <dl className="detail-list scan-details">
                  <dt>Ticket</dt>
                  <dd className="mono">{scanned.ticketId ?? "Lost — plate lookup"}</dd>
                  <dt>Parked</dt>
                  <dd>{formatHours(scanned.quote?.durationHours ?? 0)}</dd>
                  <dt>Amount due</dt>
                  <dd className="fare-due">{fare}</dd>
                  {breakdown && (
                    <>
                      <dt>Breakdown</dt>
                      <dd>{breakdown}</dd>
                    </>
                  )}
                </dl>
              </div>

              {scanned.lostTicket && (
                <p className="lost-ticket-note">
                  No ticket presented. The plate lookup adds the lost-ticket penalty.
                </p>
              )}

              <div className="button-row">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void settle()}
                  disabled={busy}
                >
                  {busy ? "Settling…" : `Payment collected · ${fare}`}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setScanned(null)}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {error && (
        <p role="alert" className="console-error">
          {error}
        </p>
      )}
    </section>
  );
}
