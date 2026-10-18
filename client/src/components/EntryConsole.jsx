import { useState } from "react";
import "./ConsoleComponents.css";

function EntryConsole({ gateId, api }) {
  const [plateNumber, setPlateNumber] = useState("");
  const [vehicleType, setVehicleType] = useState("4W");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setResult(null);
    setSubmitting(true);

    try {
      const entry = await api.createEntry({ plateNumber: plateNumber.trim().toUpperCase(), vehicleType, gateId });
      setResult(entry);
    } catch (requestError) {
      setError(requestError.message || "Unable to register this vehicle. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="console-workspace" aria-labelledby="entry-title">
      <div className="workspace-heading">
        <div>
          <p className="workspace-kicker">ARRIVAL</p>
          <h2 id="entry-title">Register a vehicle</h2>
          <p className="workspace-description">Record the vehicle and assign the next available spot.</p>
        </div>
        <span className="gate-badge">{gateId}</span>
      </div>

      <div className="workspace-grid entry-grid">
        <form className="panel form-panel" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="entry-plate">Plate number</label>
          <input
            autoComplete="off"
            className="text-input plate-input"
            id="entry-plate"
            maxLength={15}
            onChange={(event) => setPlateNumber(event.target.value.toUpperCase())}
            placeholder="e.g. KA01AB1234"
            required
            value={plateNumber}
          />

          <label className="field-label" htmlFor="entry-vehicle-type">Vehicle type</label>
          <select
            className="text-input"
            id="entry-vehicle-type"
            onChange={(event) => setVehicleType(event.target.value)}
            value={vehicleType}
          >
            <option value="2W">2W · Two-wheeler</option>
            <option value="4W">4W · Four-wheeler</option>
          </select>

          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? "Assigning spot…" : "Register vehicle"}
          </button>
        </form>

        <div className={`panel outcome-panel${result ? " outcome-ready" : ""}`} aria-live="polite">
          {result ? (
            <>
              <span className="outcome-icon" aria-hidden="true">✓</span>
              <p className="workspace-kicker">ENTRY CONFIRMED</p>
              <h3>Vehicle is parked</h3>
              <div className="ticket-code">{result.ticketId}</div>
              <div className="assignment-row">
                <span>Assigned spot</span><strong>{result.spotId}</strong>
              </div>
              <div className="assignment-row">
                <span>Zone</span><strong>{result.zone} zone</strong>
              </div>
              <div className="qr-ticket" role="img" aria-label={`Ticket code visual for ${result.ticketId}`}>
                {Array.from({ length: 81 }, (_, index) => {
                  const x = index % 9;
                  const y = Math.floor(index / 9);
                  const finderOrigin = x < 3 && y < 3 ? [0, 0]
                    : x > 5 && y < 3 ? [6, 0]
                      : x < 3 && y > 5 ? [0, 6] : null;
                  const finderX = finderOrigin ? x - finderOrigin[0] : -1;
                  const finderY = finderOrigin ? y - finderOrigin[1] : -1;
                  const finderDark = finderOrigin && (finderX === 0 || finderX === 2 || finderY === 0 || finderY === 2 || (finderX === 1 && finderY === 1));
                  const dataDark = (index * 7 + result.ticketId.length * 3) % 5 < 2;
                  return <span className={finderDark || (!finderOrigin && dataDark) ? "qr-cell qr-dark" : "qr-cell"} key={index} />;
                ))}
              </div>
              <p className="supporting-copy">Keep this ticket ID for a quick exit lookup.</p>
            </>
          ) : (
            <>
              <span className="empty-icon" aria-hidden="true">＋</span>
              <h3>Ticket details appear here</h3>
              <p className="supporting-copy">Enter the vehicle details to reserve a matching-zone spot.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default EntryConsole;
