import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import LotMap from "./LotMap.jsx";

test("lot map groups spots by zone and labels status in text, not colour alone", async () => {
  const api = {
    getLotStatus: jest.fn().mockResolvedValue({
      spots: [
        { id: "2W-01", zone: "2W", status: "free" },
        { id: "4W-01", zone: "4W", status: "reserved" },
      ],
      occupancy: { totalPct: 50, byZone: {} },
    }),
  };
  render(<LotMap api={api} />);

  expect(await screen.findByText("2W-01")).toBeInTheDocument();
  expect(screen.getByText("Free")).toBeInTheDocument();
  expect(screen.getByText("Occupied")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "4W zone" })).toBeInTheDocument();
});

test("shows live hours, blinks overstay spots and lets an exit operator notify the admin", async () => {
  const entryTimestamp = new Date(Date.now() - 7.5 * 5 * 1000).toISOString();
  const api = {
    getLotStatus: jest.fn().mockResolvedValue({
      spots: [
        { id: "2W-01", zone: "2W", status: "free", vehicle: null },
        {
          id: "4W-01",
          zone: "4W",
          status: "reserved",
          vehicle: {
            transactionId: "tx-over",
            ticketId: "TKT-OVER",
            plateNumber: "KA03EF9012",
            vehicleType: "4W",
            entryTimestamp,
            durationHours: 7.5,
            isOverstay: false,
          },
        },
      ],
      timeScale: { realSecondsPerHour: 5, hoursPerRealSecond: 0.2 },
      overstayThresholdHours: 6,
    }),
    notifyOverstay: jest.fn().mockResolvedValue({ notificationId: "notice-1" }),
  };

  render(<LotMap api={api} gateId="Exit-1" />);

  expect(await screen.findByText("KA03EF9012")).toBeInTheDocument();
  expect(screen.getByText("Overstay")).toBeInTheDocument();
  expect(screen.getByText(/7\.5 hrs/i)).toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", {
      name: /notify admin about overstay for KA03EF9012/i,
    }),
  );

  await waitFor(() =>
    expect(api.notifyOverstay).toHaveBeenCalledWith({
      vehicleId: "tx-over",
      gateId: "Exit-1",
    }),
  );
  expect(await screen.findByText(/notification sent to admin/i)).toBeInTheDocument();
  expect(screen.getByText(/admin notified/i)).toBeInTheDocument();
});

test("lot map shows a recoverable error", async () => {
  const api = { getLotStatus: jest.fn().mockRejectedValue(new Error("Lot unavailable")) };
  render(<LotMap api={api} />);

  expect(await screen.findByRole("alert")).toHaveTextContent(/lot unavailable/i);
  expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
});
