import { useEffect, useState } from "react";
import useLiveLot from "../hooks/useLiveLot.js";
import { errorMessage, formatHours } from "../utils/format.js";
import "./Console.css";

const CONNECTION_TEXT = {
  connecting: "Connecting…",
  connected: "Live updates on",
  disconnected: "Reconnecting…",
  "signed-out": "Sign in for live updates",
};

function hoursParked(vehicle, now, realSecondsPerHour) {
  if (!vehicle?.entryTimestamp) return null;
  const entry = new Date(vehicle.entryTimestamp).getTime();
  if (!Number.isFinite(entry)) return null;
  return Math.max(0, (now - entry) / 1000 / realSecondsPerHour);
}

// Shared lot map: spots grouped into 2W / 4W zones, colour plus a text label
// (SAD 4.5, VPS-F-020). Occupied spots show a live simulated-hours timer;
// overstayed spots blink and, on an exit operator's console, can be clicked to
// notify the admin (VPS-F-040, VPS-F-041).
export default function LotMap({ api, realtime, gateId }) {
  const lot = useLiveLot({ api, realtime });
  const [now, setNow] = useState(() => Date.now());
  const [sendingId, setSendingId] = useState(null);
  const [notifiedIds, setNotifiedIds] = useState([]);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const canNotify =
    typeof gateId === "string" &&
    gateId.startsWith("Exit-") &&
    typeof api.notifyOverstay === "function";
  const realSecondsPerHour = lot.timeScale?.realSecondsPerHour ?? 5;
  const overstayThresholdHours = lot.overstayThresholdHours ?? 6;

  async function notifyAdmin(spot) {
    const vehicle = spot.vehicle;
    if (!vehicle?.transactionId || sendingId) return;
    setActionError("");
    setNotice("");
    setSendingId(vehicle.transactionId);
    try {
      await api.notifyOverstay({
        vehicleId: vehicle.transactionId,
        gateId,
      });
      setNotifiedIds((current) =>
        current.includes(vehicle.transactionId)
          ? current
          : [...current, vehicle.transactionId],
      );
      setNotice("Notification sent to admin.");
    } catch (error) {
      setActionError(errorMessage(error, "Could not notify the admin."));
    } finally {
      setSendingId(null);
    }
  }

  return (
    <section className="console-panel lot-map" aria-label="Parking lot map">
      <h3>Lot map</h3>
      {lot.connection && (
        <p role="status" className="field-hint">
          {CONNECTION_TEXT[lot.connection] ?? lot.connection}
        </p>
      )}
      {lot.status === "loading" && <p role="status">Loading lot map…</p>}
      {lot.status === "error" && (
        <div role="alert" className="console-error">
          <span>{errorMessage(lot.error, "Could not load the lot map.")}</span>{" "}
          <button type="button" className="link-button" onClick={lot.retry}>
            Retry
          </button>
        </div>
      )}

      {actionError && (
        <p role="alert" className="console-error">
          {actionError}
        </p>
      )}
      {notice && (
        <p role="status" className="field-hint">
          {notice}
        </p>
      )}

      {lot.status === "ready" &&
        ["2W", "4W"].map((zone) => (
          <div key={zone} className="zone">
            <h4>{`${zone} zone`}</h4>
            <ul className="spot-grid">
              {lot.spots
                .filter((spot) => spot.zone === zone)
                .map((spot) => {
                  const reserved = spot.status === "reserved";
                  const vehicle = reserved ? spot.vehicle : null;
                  const durationHours = hoursParked(vehicle, now, realSecondsPerHour);
                  const overstay =
                    Boolean(vehicle) &&
                    (Boolean(vehicle.isOverstay) ||
                      (durationHours !== null &&
                        durationHours >= overstayThresholdHours));
                  const state = !reserved ? "free" : overstay ? "overstay" : "occupied";
                  const label = !reserved ? "Free" : overstay ? "Overstay" : "Occupied";
                  const notified = Boolean(
                    vehicle && notifiedIds.includes(vehicle.transactionId),
                  );
                  const clickable =
                    canNotify && overstay && !notified && Boolean(vehicle?.transactionId);

                  const content = (
                    <>
                      <span className="spot-id">{spot.spotNumber ?? spot.id}</span>
                      {vehicle && (
                        <span className="spot-plate">{vehicle.plateNumber}</span>
                      )}
                      <span className="spot-status">{label}</span>
                      {durationHours !== null && (
                        <span className="spot-timer">{formatHours(durationHours)}</span>
                      )}
                      {notified && <span className="spot-hint">Admin notified</span>}
                      {clickable && (
                        <span className="spot-hint">
                          {sendingId === vehicle.transactionId
                            ? "Sending…"
                            : "Click to notify admin"}
                        </span>
                      )}
                    </>
                  );

                  return (
                    <li key={spot.id} className={`spot spot-${state}`}>
                      {clickable ? (
                        <button
                          type="button"
                          className="spot-content spot-clickable"
                          onClick={() => void notifyAdmin(spot)}
                          disabled={sendingId === vehicle.transactionId}
                          aria-label={`Notify admin about overstay for ${vehicle.plateNumber}`}
                        >
                          {content}
                        </button>
                      ) : (
                        <div className="spot-content">{content}</div>
                      )}
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
    </section>
  );
}
