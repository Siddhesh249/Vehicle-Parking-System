import { render, screen } from "@testing-library/react";
import { toOccupancyPoints, toRevenuePoints } from "../utils/chartData.js";
import { OccupancyChart, RevenueChart } from "./Charts.jsx";

describe("admin charts", () => {
  test("accepts the likely field names for occupancy history and revenue by day", () => {
    expect(
      toOccupancyPoints([
        { timestamp: "2026-10-21T08:00:00.000Z", totalPct: 40 },
        { time: "2026-10-21T09:00:00.000Z", pct: "55" },
        { createdAt: "bad", totalPct: "n/a" },
      ]),
    ).toEqual([
      { label: "08:00", value: 40 },
      { label: "09:00", value: 55 },
    ]);
    expect(
      toRevenuePoints([
        { date: "2026-10-20", total: 500 },
        { day: "2026-10-21", revenue: 750.5 },
      ]),
    ).toEqual([
      { label: "10-20", value: 500 },
      { label: "10-21", value: 750.5 },
    ]);
  });

  test("describes each chart in text for assistive technology", () => {
    render(
      <>
        <OccupancyChart history={[{ timestamp: "2026-10-21T08:00:00.000Z", totalPct: 62 }]} />
        <RevenueChart byDay={[{ date: "2026-10-21", total: 1250 }]} />
      </>,
    );

    expect(screen.getByRole("img", { name: /occupancy over time, latest 62%/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /revenue by day, latest ₹1,250\.00/i })).toBeInTheDocument();
  });

  test("shows a short message instead of an empty chart", () => {
    render(
      <>
        <OccupancyChart history={[]} />
        <RevenueChart byDay={undefined} />
      </>,
    );

    expect(screen.getByText(/no occupancy history yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no revenue history yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  test("mounts the chart when the browser can resize it", () => {
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(<OccupancyChart history={[{ timestamp: "2026-10-21T08:00:00.000Z", totalPct: 62 }]} />);
      expect(screen.getByRole("img", { name: /occupancy over time/i })).toBeInTheDocument();
    } finally {
      warn.mockRestore();
      globalThis.ResizeObserver = original;
    }
  });
});
