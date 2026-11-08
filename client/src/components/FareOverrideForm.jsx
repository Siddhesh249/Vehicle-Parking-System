import { useState } from "react";
import { errorMessage } from "../utils/format.js";
import "./Console.css";

// Starting values for the fare override form (match the project's default fare tiers).
const FARE_DEFAULTS = {
  "2W": {
    tiers: [
      ["1", "10"],
      ["3", "15"],
      ["6", "25"],
    ],
    lostTicketPenalty: "50",
  },
  "4W": {
    tiers: [
      ["1", "20"],
      ["3", "30"],
      ["6", "50"],
    ],
    lostTicketPenalty: "100",
  },
};

const toNumber = (text) => (text.trim() === "" ? null : Number(text));

// Runtime fare-tier override for the developer console (VPS-DEV-002):
// PUT /api/dev/simulate/fare-tiers.
export default function FareOverrideForm({ api }) {
  const [vehicleType, setVehicleType] = useState("4W");
  const [firstHourFree, setFirstHourFree] = useState(true);
  const [tiers, setTiers] = useState(FARE_DEFAULTS["4W"].tiers);
  const [lostTicketPenalty, setLostTicketPenalty] = useState(
    FARE_DEFAULTS["4W"].lostTicketPenalty,
  );
  const [overstayPenalty, setOverstayPenalty] = useState("");
  const [fareError, setFareError] = useState("");
  const [fareMessage, setFareMessage] = useState("");

  function chooseVehicleType(type) {
    setVehicleType(type);
    setTiers(FARE_DEFAULTS[type].tiers);
    setLostTicketPenalty(FARE_DEFAULTS[type].lostTicketPenalty);
    setFareMessage("");
  }

  function updateTier(index, position, value) {
    setTiers((rows) =>
      rows.map((row, i) =>
        i === index ? row.map((cell, p) => (p === position ? value : cell)) : row,
      ),
    );
  }

  async function handleFareSubmit(event) {
    event.preventDefault();
    setFareMessage("");

    // Blank rows are ignored; the others need increasing start hours and non-negative rates.
    const parsed = tiers
      .filter(([hours, rate]) => hours.trim() !== "" || rate.trim() !== "")
      .map(([hours, rate]) => ({
        afterHours: toNumber(hours),
        ratePerHour: toNumber(rate),
      }));
    const tiersValid =
      parsed.length > 0 &&
      parsed.every(
        (t, i) =>
          Number.isFinite(t.afterHours) &&
          t.afterHours >= 0 &&
          Number.isFinite(t.ratePerHour) &&
          t.ratePerHour >= 0 &&
          (i === 0 || t.afterHours > parsed[i - 1].afterHours),
      );
    if (!tiersValid) {
      setFareError(
        "Fill in each tier with a start hour and a rate. Start hours must increase.",
      );
      return;
    }

    const payload = { vehicleType, firstHourFree, tiers: parsed };
    for (const [key, text] of [
      ["lostTicketPenalty", lostTicketPenalty],
      ["overstayPenalty", overstayPenalty],
    ]) {
      const value = toNumber(text);
      if (value === null) continue;
      if (!Number.isFinite(value) || value < 0) {
        setFareError("Penalties must be zero or more.");
        return;
      }
      payload[key] = value;
    }

    setFareError("");
    try {
      await api.setSimulationFareTiers(payload);
      setFareMessage(`Fare override applied for ${vehicleType}.`);
    } catch (err) {
      setFareError(errorMessage(err, "Could not apply the fare override."));
    }
  }

  return (
    <section className="console-panel">
        <h3>Fare override</h3>
        <p className="field-hint">
          Changes the fare tiers for new exits until the server restarts.
        </p>

        <form className="fare-form" onSubmit={handleFareSubmit} noValidate>
          <label>
            Vehicle type
            <select
              value={vehicleType}
              onChange={(e) => chooseVehicleType(e.target.value)}
            >
              <option value="2W">2W (two-wheeler)</option>
              <option value="4W">4W (four-wheeler)</option>
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={firstHourFree}
              onChange={(e) => setFirstHourFree(e.target.checked)}
            />
            First hour free
          </label>

          {tiers.map(([hours, rate], index) => (
            <div className="tier-row" key={index}>
              <label>
                {`Tier ${index + 1} starts after (hours)`}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={hours}
                  onChange={(e) => updateTier(index, 0, e.target.value)}
                />
              </label>
              <label>
                {`Tier ${index + 1} rate per hour`}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={rate}
                  onChange={(e) => updateTier(index, 1, e.target.value)}
                />
              </label>
            </div>
          ))}

          <label>
            Lost-ticket penalty
            <input
              type="number"
              min="0"
              step="any"
              value={lostTicketPenalty}
              onChange={(e) => setLostTicketPenalty(e.target.value)}
            />
          </label>
          <label>
            Overstay penalty
            <input
              type="number"
              min="0"
              step="any"
              value={overstayPenalty}
              onChange={(e) => setOverstayPenalty(e.target.value)}
            />
          </label>
          <button type="submit" className="secondary-button">
            Apply fare override
          </button>
        </form>

        {fareError && (
          <p role="alert" className="console-error">
            {fareError}
          </p>
        )}
        {fareMessage && <p role="status">{fareMessage}</p>}
      </section>
  );
}
