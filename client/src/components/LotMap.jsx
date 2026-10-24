import { useCallback } from "react";
import usePanel from "../hooks/usePanel.js";
import { errorMessage } from "../utils/format.js";
import "./Console.css";

const LABELS = { free: "Free", reserved: "Reserved" };

// Shared lot map: spots grouped into 2W / 4W zones, colour plus a text label (SAD 4.5, VPS-F-020).
// Live Socket.io updates are wired in Sprint 3; for now it loads once from GET /api/lot/status.
export default function LotMap({ api }) {
  const fetchLot = useCallback(() => api.getLotStatus(), [api]);
  const lot = usePanel(fetchLot);

  return (
    <section className="console-panel lot-map" aria-label="Parking lot map">
      <h3>Lot map</h3>
      {lot.status === "loading" && <p role="status">Loading lot map…</p>}
      {lot.status === "error" && (
        <div role="alert" className="console-error">
          <span>{errorMessage(lot.error, "Could not load the lot map.")}</span>{" "}
          <button type="button" className="link-button" onClick={lot.retry}>
            Retry
          </button>
        </div>
      )}
      {lot.status === "ready" &&
        ["2W", "4W"].map((zone) => (
          <div key={zone} className="zone">
            <h4>{`${zone} zone`}</h4>
            <ul className="spot-grid">
              {lot.data.spots
                .filter((spot) => spot.zone === zone)
                .map((spot) => (
                  <li key={spot.id} className={`spot spot-${spot.status}`}>
                    <span className="spot-id">{spot.id}</span>
                    <span className="spot-status">{LABELS[spot.status] ?? spot.status}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
    </section>
  );
}
