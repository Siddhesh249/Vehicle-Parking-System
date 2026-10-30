const pick = (record, keys) => keys.map((key) => record?.[key]).find((v) => v !== undefined);

const timeLabel = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value ?? "") : date.toISOString().slice(11, 16);
};
const dayLabel = (value) => String(value ?? "").slice(5, 10) || String(value ?? "");

// The history/byDay element shapes aren't fixed by the SAD, so accept the likely field names.
export function toOccupancyPoints(history = []) {
  return history
    .map((entry) => ({
      label: timeLabel(pick(entry, ["timestamp", "time", "createdAt", "date"])),
      value: Number(pick(entry, ["totalPct", "pct", "occupancyPct", "percent", "value"])),
    }))
    .filter((point) => Number.isFinite(point.value));
}

export function toRevenuePoints(byDay = []) {
  return byDay
    .map((entry) => ({
      label: dayLabel(pick(entry, ["date", "day", "label"])),
      value: Number(pick(entry, ["total", "revenue", "amount", "value"])),
    }))
    .filter((point) => Number.isFinite(point.value));
}
