const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

export const formatMoney = (amount) => inr.format(Number(amount) || 0);

// Human-readable duration while still preserving the exact second count in the
// text, because fares and receipts are based on the unrounded value.
export function formatDuration(value) {
  const totalSeconds = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (seconds || parts.length === 0)
    parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  return parts.join(" ");
}

// Fixed UTC output so the display never depends on the viewer's locale/timezone.
export function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export const normalizePlate = (value) => value.trim().toUpperCase();

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
