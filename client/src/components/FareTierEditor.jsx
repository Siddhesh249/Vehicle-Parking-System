// Shared editor for the fare table. Used by the admin configuration panel and
// the developer Simulation Console so both exercise the same validation rules.
export default function FareTierEditor({
  value,
  onChange,
  idPrefix = "fare",
  disabled = false,
}) {
  const update = (patch) => onChange({ ...value, ...patch });
  const updateTier = (index, field, rawValue) => {
    const tiers = value.tiers.map((tier, tierIndex) =>
      tierIndex === index ? { ...tier, [field]: rawValue } : tier,
    );
    update({ tiers });
  };
  const addTier = () => {
    const last = value.tiers[value.tiers.length - 1];
    update({
      tiers: [
        ...value.tiers,
        { afterHours: (Number(last?.afterHours) || 0) + 1, rate: 0 },
      ],
    });
  };
  const removeTier = (index) => {
    if (value.tiers.length <= 1) return;
    update({ tiers: value.tiers.filter((_, tierIndex) => tierIndex !== index) });
  };

  const inputId = (suffix) => `${idPrefix}-${suffix}`;

  return (
    <div className="fare-editor">
      <label className="checkbox-field" htmlFor={inputId("first-hour-free")}>
        <input
          id={inputId("first-hour-free")}
          type="checkbox"
          checked={value.firstHourFree !== false}
          onChange={(event) => update({ firstHourFree: event.target.checked })}
          disabled={disabled}
        />
        First hour free
      </label>

      <div className="table-wrap">
        <table className="tier-table">
          <caption className="visually-hidden">
            Fare tiers, ordered by the hour each rate begins
          </caption>
          <thead>
            <tr>
              <th scope="col">After hours</th>
              <th scope="col">Rate per hour (₹)</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {value.tiers.map((tier, index) => (
              <tr key={index}>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    aria-label={`Tier ${index + 1} after hours`}
                    value={tier.afterHours}
                    onChange={(event) =>
                      updateTier(index, "afterHours", event.target.value)
                    }
                    disabled={disabled}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    aria-label={`Tier ${index + 1} rate per hour`}
                    value={tier.rate}
                    onChange={(event) => updateTier(index, "rate", event.target.value)}
                    disabled={disabled}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => removeTier(index)}
                    disabled={disabled || value.tiers.length <= 1}
                    aria-label={`Remove tier ${index + 1}`}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        className="secondary-button compact-button"
        onClick={addTier}
        disabled={disabled}
      >
        Add tier
      </button>

      <div className="config-field-row">
        <label>
          Lost-ticket penalty (₹)
          <input
            type="number"
            min="0"
            step="1"
            value={value.lostTicketPenalty}
            onChange={(event) => update({ lostTicketPenalty: event.target.value })}
            disabled={disabled}
          />
        </label>
        <label>
          Overstay penalty (₹)
          <input
            type="number"
            min="0"
            step="1"
            value={value.overstayPenalty}
            onChange={(event) => update({ overstayPenalty: event.target.value })}
            disabled={disabled}
          />
        </label>
      </div>
    </div>
  );
}
