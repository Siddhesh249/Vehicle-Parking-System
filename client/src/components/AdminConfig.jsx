import { useCallback, useEffect, useRef, useState } from "react";
import FareTierEditor from "./FareTierEditor.jsx";
import { errorMessage } from "../utils/format.js";
import "./Console.css";

const ZONES = ["2W", "4W"];

function editableFare(config) {
  return {
    firstHourFree: config.firstHourFree !== false,
    tiers: config.tiers.map(({ afterHours, rate }) => ({ afterHours, rate })),
    lostTicketPenalty: config.lostTicketPenalty,
    overstayPenalty: config.overstayPenalty,
  };
}

function numeric(value, label) {
  const parsed = value === "" || value === null ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return parsed;
}

function normalizeFare(draft) {
  const tiers = draft.tiers.map((tier, index) => ({
    afterHours: numeric(tier.afterHours, `Tier ${index + 1} after hours`),
    rate: numeric(tier.rate, `Tier ${index + 1} rate`),
  }));
  tiers.forEach((tier, index) => {
    if (index > 0 && tier.afterHours <= tiers[index - 1].afterHours) {
      throw new Error("Each tier must start later than the tier above it.");
    }
  });
  return {
    tiers,
    firstHourFree: draft.firstHourFree !== false,
    lostTicketPenalty: numeric(draft.lostTicketPenalty, "Lost-ticket penalty"),
    overstayPenalty: numeric(draft.overstayPenalty, "Overstay penalty"),
  };
}

// Admin-only fare and capacity configuration (VPS-F-055, VPS-F-056).
export default function AdminConfig({ api, onChanged }) {
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [vehicleType, setVehicleType] = useState("4W");
  const [configs, setConfigs] = useState(null);
  const [draft, setDraft] = useState(null);
  const [spotCounts, setSpotCounts] = useState({ "2W": "", "4W": "" });
  const vehicleTypeRef = useRef(vehicleType);

  useEffect(() => {
    vehicleTypeRef.current = vehicleType;
  }, [vehicleType]);

  const load = useCallback(async () => {
    try {
      const [fareConfig, counts] = await Promise.all([
        api.getFareConfig(),
        api.getSpotConfig(),
      ]);
      setConfigs(fareConfig);
      setDraft(editableFare(fareConfig[vehicleTypeRef.current] ?? fareConfig["4W"]));
      setSpotCounts({
        "2W": String(counts["2W"] ?? 0),
        "4W": String(counts["4W"] ?? 0),
      });
      setStatus("ready");
    } catch (loadError) {
      setStatus("error");
      setError(errorMessage(loadError, "Could not load the configuration."));
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getFareConfig(), api.getSpotConfig()])
      .then(([fareConfig, counts]) => {
        if (cancelled) return;
        setConfigs(fareConfig);
        setDraft(editableFare(fareConfig[vehicleTypeRef.current] ?? fareConfig["4W"]));
        setSpotCounts({
          "2W": String(counts["2W"] ?? 0),
          "4W": String(counts["4W"] ?? 0),
        });
        setStatus("ready");
      })
      .catch((loadError) => {
        if (cancelled) return;
        setStatus("error");
        setError(errorMessage(loadError, "Could not load the configuration."));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  function retry() {
    setStatus("loading");
    setError("");
    void load();
  }

  function chooseVehicleType(nextType) {
    setVehicleType(nextType);
    setError("");
    setNotice("");
    if (configs?.[nextType]) setDraft(editableFare(configs[nextType]));
  }

  async function saveFare(event) {
    event.preventDefault();
    if (saving || !draft) return;
    setError("");
    setNotice("");
    let payload;
    try {
      payload = normalizeFare(draft);
    } catch (validationError) {
      setError(validationError.message);
      return;
    }

    setSaving(true);
    try {
      await api.updateFareTiers({ vehicleType, ...payload });
      setConfigs((current) => ({
        ...current,
        [vehicleType]: {
          firstHourFree: payload.firstHourFree,
          tiers: payload.tiers,
          lostTicketPenalty: payload.lostTicketPenalty,
          overstayPenalty: payload.overstayPenalty,
        },
      }));
      setNotice(`${vehicleType} fare tiers saved. New exits use these rates.`);
      onChanged?.();
    } catch (saveError) {
      setError(errorMessage(saveError, "Could not save the fare tiers."));
    } finally {
      setSaving(false);
    }
  }

  async function saveSpotCount(zone) {
    if (saving) return;
    setError("");
    setNotice("");
    let count;
    try {
      count = numeric(spotCounts[zone], `${zone} spot count`);
      if (!Number.isInteger(count)) throw new Error("Spot count must be a whole number.");
    } catch (validationError) {
      setError(validationError.message);
      return;
    }

    setSaving(true);
    try {
      const result = await api.updateSpotCount({ zone, count });
      setSpotCounts((current) => ({ ...current, [zone]: String(result.count) }));
      setNotice(`${zone} capacity is now ${result.count} spots.`);
      onChanged?.();
    } catch (saveError) {
      setError(errorMessage(saveError, `Could not update the ${zone} spot count.`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="console-panel admin-config" aria-labelledby="admin-config-title">
      <h3 id="admin-config-title">Configuration</h3>

      {status === "loading" && <p role="status">Loading configuration…</p>}
      {status === "error" && (
        <div role="alert" className="console-error">
          <span>{error}</span>{" "}
          <button type="button" className="link-button" onClick={retry}>
            Retry
          </button>
        </div>
      )}

      {status === "ready" && draft && (
        <>
          <form className="config-form" onSubmit={saveFare}>
            <label>
              Vehicle type
              <select
                value={vehicleType}
                onChange={(event) => chooseVehicleType(event.target.value)}
                disabled={saving}
              >
                {ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>

            <FareTierEditor
              value={draft}
              onChange={setDraft}
              idPrefix="admin-fare"
              disabled={saving}
            />

            <button type="submit" className="primary-button" disabled={saving}>
              {saving ? "Saving…" : `Save ${vehicleType} fare tiers`}
            </button>
          </form>

          <div className="config-form spot-config">
            <h4>Zone capacity</h4>
            {ZONES.map((zone) => (
              <div className="spot-count-row" key={zone}>
                <label>
                  {zone} spots
                  <input
                    type="number"
                    min="0"
                    max="500"
                    step="1"
                    value={spotCounts[zone]}
                    onChange={(event) =>
                      setSpotCounts((current) => ({
                        ...current,
                        [zone]: event.target.value,
                      }))
                    }
                    disabled={saving}
                  />
                </label>
                <button
                  type="button"
                  className="secondary-button compact-button"
                  onClick={() => void saveSpotCount(zone)}
                  disabled={saving}
                >
                  Update {zone}
                </button>
              </div>
            ))}
          </div>

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
        </>
      )}
    </section>
  );
}
