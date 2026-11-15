const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

export const formatMoney = (amount) => inr.format(Number(amount) || 0);

// The demo clock bills one simulated hour for every few real seconds. Every
// operator-facing duration is therefore shown directly in hours (e.g. "5.2 hrs").
export function formatHours(hours) {
  return `${Math.max(0, Number(hours) || 0).toFixed(1)} hrs`;
}

export function formatHoursFromSeconds(seconds) {
  return formatHours((Number(seconds) || 0) / 3600);
}

export function formatDuration(value) {
  return formatHoursFromSeconds(value);
}

// Fixed UTC output so the display never depends on the viewer's locale/timezone.
export function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// Same canonical form as the server: no spaces or hyphens, upper case.
export const normalizePlate = (value) => value.replace(/[\s-]+/g, "").toUpperCase();

export const errorMessage = (err, fallback) => (err && err.message) || fallback;

// "baseFare" -> "base fare"
export const humanize = (key) => key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

// One text string, e.g. "base fare ₹30.00, lost ticket penalty ₹100.00".
export function describeBreakdown(breakdown) {
  if (!breakdown) return "";
  return Object.entries(breakdown)
    .filter(([, value]) => typeof value === "number")
    .map(([key, value]) => `${humanize(key)} ${formatMoney(value)}`)
    .join(", ");
}
