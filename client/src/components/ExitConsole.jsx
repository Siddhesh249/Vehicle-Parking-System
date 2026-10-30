import { useState } from "react";
import {
  describeBreakdown,
  errorMessage,
  formatDuration,
  formatMoney,
  formatTimestamp,
  normalizePlate,
} from "../utils/format.js";
import "./Console.css";

// Exit-1 / Exit-2: find the vehicle by ticket or plate, confirm exit, show the receipt (VPS-F-030..037).
export default function ExitConsole({ gateId, api }) {
  const [ticketInput, setTicketInput] = useState("");
  const [plateInput, setPlateInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState(null); // "ticket" | "plate" — how the vehicle was found
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState(0);
  const [receipt, setReceipt] = useState(null);
  const [notice, setNotice] = useState("");

  function startSearch() {
    setError("");
    setNotice("");
    setReceipt(null);
    setMatches([]);
    setSelected(0);
    setBusy(true);
  }

  async function lookupByTicket(event) {
    event.preventDefault();
    if (busy) return;
    startSearch();
    const ticketId = ticketInput.trim();
    if (!ticketId) {
      setBusy(false);
      setError("Enter a ticket ID.");
      return;
    }
    try {
      const record = await api.lookupTicket(ticketId);
      setMode("ticket");
      setMatches([{ ...record, ticketId: record.ticketId ?? ticketId }]);
    } catch (err) {
      setError(errorMessage(err, "Could not look up that ticket."));
    } finally {
      setBusy(false);
    }
  }

  async function searchByPlate(event) {
    event.preventDefault();
    if (busy) return;
    startSearch();
    const plateNumber = normalizePlate(plateInput);
    if (!plateNumber) {
      setBusy(false);
      setError("Enter a plate number.");
      return;
    }
    try {
      const records = await api.searchPlate(plateNumber);
      if (!records.length) throw new Error("Vehicle not found");
      setMode("plate");
      setMatches(records);
    } catch (err) {
      setError(errorMessage(err, "Could not search for that plate."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmExit() {
    if (busy || !matches.length) return;
    const record = matches[selected];
    setError("");
    setBusy(true);
    try {
      const request =
        mode === "ticket"
          ? { ticketId: record.ticketId, gateId }
          : { plateNumber: record.plateNumber, gateId };
      const result = await api.processExit(request);
      setReceipt(result);
      setMatches([]);
      setTicketInput("");
      setPlateInput("");
    } catch (err) {
      setError(errorMessage(err, "Could not process the exit."));
    } finally {
      setBusy(false);
    }
  }

  async function notifyOverstay() {
    if (busy || !matches.length || typeof api.notifyOverstay !== "function") return;
    const record = matches[selected];
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await api.notifyOverstay({
        vehicleId: record.ticketId ?? record.plateNumber,
        gateId,
      });
      setNotice("Overstay notification sent to the admin.");
    } catch (err) {
      setError(errorMessage(err, "Could not notify the admin."));
    } finally {
      setBusy(false);
    }
  }

  const breakdown = receipt ? describeBreakdown(receipt.breakdown) : "";
  const fareText = receipt
    ? breakdown
      ? `${formatMoney(receipt.fare)} (${breakdown})`
      : formatMoney(receipt.fare)
    : "";

  return (
    <section className="console-panel">
      <h3>Process exit</h3>

      <div className="exit-lookups">
        <form className="console-form" onSubmit={lookupByTicket} noValidate>
          <label>
            Ticket ID
            <input
              type="text"
              value={ticketInput}
              onChange={(e) => setTicketInput(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button type="submit" className="primary-button" disabled={busy}>
            Look up ticket
          </button>
        </form>

        <form className="console-form" onSubmit={searchByPlate} noValidate>
          <label>
            Plate number
            <input
              type="text"
              value={plateInput}
              onChange={(e) => setPlateInput(e.target.value)}
              autoComplete="off"
              maxLength={15}
            />
          </label>
          <button type="submit" className="secondary-button" disabled={busy}>
            Search by plate
          </button>
          <p className="field-hint">
            For drivers without a ticket. A penalty fee is added to the fare.
          </p>
        </form>
      </div>

      {error && (
        <p role="alert" className="console-error">
          {error}
        </p>
      )}

      {matches.length > 0 && (
        <fieldset className="match-list">
          <legend>Vehicle found</legend>
          {matches.map((record, index) => (
            <label key={record.ticketId ?? record.plateNumber} className="match-row">
              <input
                type="radio"
                name="exit-vehicle"
                checked={selected === index}
                onChange={() => setSelected(index)}
              />
              {record.ticketId && <span className="mono">{record.ticketId}</span>}
              <span className="mono">{record.plateNumber}</span>
              <span>{record.vehicleType}</span>
              {record.entryTimestamp && (
                <span>{formatTimestamp(record.entryTimestamp)}</span>
              )}
            </label>
          ))}
          <div className="match-actions">
            <button
              type="button"
              className="primary-button"
              onClick={confirmExit}
              disabled={busy}
            >
              Confirm exit
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={notifyOverstay}
              disabled={busy || typeof api.notifyOverstay !== "function"}
            >
              Notify admin of overstay
            </button>
          </div>
        </fieldset>
      )}

      {notice && (
        <p role="status" className="field-hint">
          {notice}
        </p>
      )}

      {receipt && (
        <div className="ticket-card" role="status">
          <h4>Exit complete</h4>
          <dl className="detail-list">
            <dt>Fare</dt>
            <dd>{fareText}</dd>
            <dt>Duration</dt>
            <dd>{formatDuration(receipt.durationSeconds)}</dd>
            {receipt.penaltyApplied && (
              <>
                <dt>Penalty</dt>
                <dd>Lost-ticket penalty applied</dd>
              </>
            )}
            <dt>Receipt</dt>
            <dd className="mono">{receipt.receiptId}</dd>
          </dl>
        </div>
      )}
    </section>
  );
}
