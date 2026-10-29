import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toOccupancyPoints, toRevenuePoints } from "../utils/chartData.js";
import { formatMoney } from "../utils/format.js";
import "./Console.css";

// Recharts' ResponsiveContainer needs ResizeObserver (all browsers; not jsdom).
const canResize = () => typeof ResizeObserver !== "undefined";

export function OccupancyChart({ history }) {
  const points = toOccupancyPoints(history);
  if (!points.length) return <p className="field-hint">No occupancy history yet.</p>;

  return (
    <figure
      className="chart"
      role="img"
      aria-label={`Occupancy over time, latest ${points[points.length - 1].value}%`}
    >
      {canResize() && (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#e8e9eb" vertical={false} />
            <XAxis dataKey="label" fontSize={12} />
            <YAxis domain={[0, 100]} unit="%" width={44} fontSize={12} />
            <Tooltip formatter={(value) => `${value}%`} />
            <Line type="monotone" dataKey="value" name="Occupancy" stroke="#c93b3b" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </figure>
  );
}

export function RevenueChart({ byDay }) {
  const points = toRevenuePoints(byDay);
  if (!points.length) return <p className="field-hint">No revenue history yet.</p>;

  return (
    <figure
      className="chart"
      role="img"
      aria-label={`Revenue by day, latest ${formatMoney(points[points.length - 1].value)}`}
    >
      {canResize() && (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#e8e9eb" vertical={false} />
            <XAxis dataKey="label" fontSize={12} />
            <YAxis width={52} fontSize={12} />
            <Tooltip formatter={(value) => formatMoney(value)} />
            <Bar dataKey="value" name="Revenue" fill="#c93b3b" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </figure>
  );
}
