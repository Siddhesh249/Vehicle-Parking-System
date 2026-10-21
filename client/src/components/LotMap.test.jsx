import { render, screen } from "@testing-library/react";
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
  expect(screen.getByText("Reserved")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "4W zone" })).toBeInTheDocument();
});

test("lot map shows a recoverable error", async () => {
  const api = { getLotStatus: jest.fn().mockRejectedValue(new Error("Lot unavailable")) };
  render(<LotMap api={api} />);

  expect(await screen.findByRole("alert")).toHaveTextContent(/lot unavailable/i);
  expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
});
