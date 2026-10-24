import { useState } from "react";
import QrPattern from "./QrPattern.jsx";
import { errorMessage, normalizePlate } from "../utils/format.js";
import "./Console.css";

// Entry-1 / Entry-2: record plate + vehicle type, allot a spot, show the ticket (VPS-F-010..016).
export default function EntryConsole({ gateId, api }) {
  const [plate, setPlate] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ticket, setTicket] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setTicket(null);
    if (!plate.trim() || !vehicleType) {
      setError("Enter a plate number and choose a vehicle type.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const result = await api.createEntry({
        plateNumber: normalizePlate(plate),
        vehicleType,
        gateId,
      });
      setTicket(result);
      setPlate("");
      setVehicleType("");
    } catch (err) {
      setError(errorMessage(err, "Could not register the vehicle."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="console-panel">
      <h3>Register vehicle</h3>
      <form className="console-form" onSubmit={handleSubmit} noValidate>
        <label>
          Plate number
          <input
            type="text"
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            autoComplete="off"
            maxLength={15}
          />
        </label>
        <label>
          Vehicle type
          <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
            <option value="">Select type</option>
            <option value="2W">2W (two-wheeler)</option>
            <option value="4W">4W (four-wheeler)</option>
          </select>
        </label>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? "Registering…" : "Register vehicle"}
        </button>
      </form>

      {error && (
        <p role="alert" className="console-error">
          {error}
        </p>
      )}

      {ticket && (
        <div className="ticket-card" role="status">
          <h4>Ticket issued</h4>
          <p className="ticket-id">{ticket.ticketId}</p>
          <dl className="detail-list">
            <dt>Spot</dt>
            <dd>{ticket.spotId}</dd>
            <dt>Zone</dt>
            <dd>{`${ticket.zone} zone`}</dd>
          </dl>
          <QrPattern value={ticket.qrPayload ?? ticket.ticketId} />
        </div>
      )}
    </section>
  );
}
