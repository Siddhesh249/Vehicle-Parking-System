import { useState } from "react";
import "./ConsoleComponents.css";

function formatCurrency(amount) {
  return `₹${Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDuration(seconds) {
  const totalMinutes = Math.floor(Number(seconds || 0) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes || !hours) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  return `${seconds} seconds (${parts.join(" ")})`;
}

function ExitConsole({ gateId, api }) {
  const [ticketId, setTicketId] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [vehicle, setVehicle] = useState(null);
  const [lookupMethod, setLookupMethod] = useState("ticket");
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function lookupTicket(event) {
    event.preventDefault();
    setError("");
    setVehicle(null);
    setReceipt(null);
    setLookupMethod("ticket");
    setBusy(true);
    try {
      setVehicle(await api.lookupTicket(ticketId.trim()));
    } catch (requestError) {
      setError(requestError.message || "Vehicle not found.");
    } finally {
      setBusy(false);
    }
  }

  async function searchPlate(event) {
    event.preventDefault();
    setError("");
    setVehicle(null);
    setReceipt(null);
    setLookupMethod("plate");
    setBusy(true);
    try {
      const records = await api.searchPlate(plateNumber.trim().toUpperCase());
      if (!records?.length) throw new Error("Vehicle not found.");
      setVehicle(records[0]);
    } catch (requestError) {
      setError(requestError.message || "Vehicle not found.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmExit() {
    setError("");
    setBusy(true);
    try {
      const request = lookupMethod === "ticket"
        ? { ticketId: vehicle.ticketId, gateId }
        : { plateNumber: vehicle.plateNumber, gateId };
      setReceipt(await api.processExit(request));
    } catch (requestError) {
      setError(requestError.message || "Unable to complete the exit. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="console-workspace" aria-labelledby="exit-title">
      <div className="workspace-heading">
        <div>
          <p className="workspace-kicker">DEPARTURE</p>
          <h2 id="exit-title">Find a parking ticket</h2>
          <p className="workspace-description">Look up the vehicle, review its fare, and confirm the exit.</p>
        </div>
        <span className="gate-badge">{gateId}</span>
      </div>

      <div className="workspace-grid exit-grid">
        <div className="panel lookup-panel">
          <form className="lookup-form" onSubmit={lookupTicket}>
            <label className="field-label" htmlFor="exit-ticket">Ticket ID</label>
            <div className="inline-form">
              <input className="text-input" id="exit-ticket" onChange={(event) => setTicketId(event.target.value)} placeholder="Enter ticket ID" value={ticketId} />
              <button className="secondary-button" disabled={busy || !ticketId.trim()} type="submit">Look up ticket</button>
            </div>
          </form>
          <div className="form-divider"><span>or use plate number</span></div>
          <form className="lookup-form" onSubmit={searchPlate}>
            <label className="field-label" htmlFor="exit-plate">Plate number</label>
            <div className="inline-form">
              <input className="text-input" id="exit-plate" onChange={(event) => setPlateNumber(event.target.value.toUpperCase())} placeholder="e.g. KA01AB1234" value={plateNumber} />
              <button className="secondary-button" disabled={busy || !plateNumber.trim()} type="submit">Search by plate</button>
            </div>
            <p className="field-hint">Plate search is used when the customer has lost their ticket.</p>
          </form>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
        </div>

        <div className="panel exit-details" aria-live="polite">
          {receipt ? (
            <>
              <span className="outcome-icon" aria-hidden="true">✓</span>
              <p className="workspace-kicker">EXIT COMPLETE</p>
              <h3>Payment due</h3>
              <div className="fare-total">{formatCurrency(receipt.fare)}</div>
              <div className="assignment-row"><span>Parking duration</span><strong>{formatDuration(receipt.durationSeconds)}</strong></div>
              <div className="assignment-row"><span>Receipt</span><strong>{receipt.receiptId}</strong></div>
              {(receipt.penaltyApplied || lookupMethod === "plate") && <p className="notice notice-warning">Lost ticket penalty applied</p>}
              <p className="supporting-copy">The parking spot is ready for the next vehicle.</p>
            </>
          ) : vehicle ? (
            <>
              <p className="workspace-kicker">ACTIVE PARKING SESSION</p>
              <h3>{vehicle.plateNumber}</h3>
              <div className="assignment-row"><span>Ticket ID</span><strong>{vehicle.ticketId}</strong></div>
              <div className="assignment-row"><span>Vehicle type</span><strong>{vehicle.vehicleType}</strong></div>
              {vehicle.entryTimestamp && <div className="assignment-row"><span>Entered</span><strong>{new Date(vehicle.entryTimestamp).toLocaleString()}</strong></div>}
              {lookupMethod === "plate" && <p className="notice notice-warning">Lost ticket: a penalty may apply to the final fare.</p>}
              <button className="primary-button" disabled={busy} onClick={confirmExit} type="button">Confirm exit</button>
            </>
          ) : (
            <>
              <span className="empty-icon" aria-hidden="true">⌕</span>
              <h3>Session details appear here</h3>
              <p className="supporting-copy">Search by ticket ID or plate number to review an active parking session.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default ExitConsole;
