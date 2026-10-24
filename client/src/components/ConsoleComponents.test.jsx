/** Sprint 2 — T5: role console components against SAD 4.3 mock API contracts. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EntryConsole from "./EntryConsole.jsx";
import ExitConsole from "./ExitConsole.jsx";
import AdminConsole from "./AdminConsole.jsx";

describe("EntryConsole", () => {
  test("submits plate and vehicle type with its assigned gate, then shows ticket and spot from the API response", async () => {
    const user = userEvent.setup();
    const api = { createEntry: jest.fn().mockResolvedValue({
      ticketId: "TKT-20261018-001", spotId: "spot-1", zone: "4W", qrPayload: "TKT-20261018-001",
    }) };
    render(<EntryConsole gateId="Entry-1" api={api} />);

    await user.type(screen.getByLabelText(/plate number/i), "KA01AB1234");
    await user.selectOptions(screen.getByLabelText(/vehicle type/i), "4W");
    await user.click(screen.getByRole("button", { name: /register vehicle/i }));

    expect(api.createEntry).toHaveBeenCalledWith({ plateNumber: "KA01AB1234", vehicleType: "4W", gateId: "Entry-1" });
    expect(await screen.findByText("TKT-20261018-001")).toBeInTheDocument();
    expect(screen.getByText(/spot-1/)).toBeInTheDocument();
    expect(screen.getByText(/4w zone/i)).toBeInTheDocument();
  });

  test("shows the lot-full response and allows the operator to correct the form", async () => {
    const user = userEvent.setup();
    const api = { createEntry: jest.fn().mockRejectedValue({ status: 409, code: "LOT_FULL", message: "No 2W spots available" }) };
    render(<EntryConsole gateId="Entry-2" api={api} />);

    await user.type(screen.getByLabelText(/plate number/i), "KA02CD5678");
    await user.selectOptions(screen.getByLabelText(/vehicle type/i), "2W");
    await user.click(screen.getByRole("button", { name: /register vehicle/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no 2w spots available/i);
    expect(screen.getByLabelText(/plate number/i)).toHaveValue("KA02CD5678");
  });
});

describe("ExitConsole", () => {
  test("looks up by ticket, then displays the entry and computed fare response", async () => {
    const user = userEvent.setup();
    const api = {
      lookupTicket: jest.fn().mockResolvedValue({ ticketId: "TKT-1", plateNumber: "KA01AB1234", vehicleType: "4W", entryTimestamp: "2026-10-18T10:00:00.000Z" }),
      processExit: jest.fn().mockResolvedValue({ fare: 30, durationSeconds: 5400, penaltyApplied: false, breakdown: { baseFare: 30 }, receiptId: "RCP-1" }),
    };
    render(<ExitConsole gateId="Exit-1" api={api} />);

    await user.type(screen.getByLabelText(/ticket id/i), "TKT-1");
    await user.click(screen.getByRole("button", { name: /look up ticket/i }));
    expect(await screen.findByText("KA01AB1234")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /confirm exit/i }));

    expect(api.lookupTicket).toHaveBeenCalledWith("TKT-1");
    expect(api.processExit).toHaveBeenCalledWith({ ticketId: "TKT-1", gateId: "Exit-1" });
    expect(await screen.findByText(/₹?30(?:\.00)?/)).toBeInTheDocument();
    expect(screen.getByText(/5400 seconds|1 hour 30 minutes/i)).toBeInTheDocument();
    expect(screen.getByText("RCP-1")).toBeInTheDocument();
  });

  test("supports lost-ticket search by plate and identifies the penalty in the receipt", async () => {
    const user = userEvent.setup();
    const api = {
      searchPlate: jest.fn().mockResolvedValue([{ ticketId: "TKT-2", plateNumber: "KA02CD5678", vehicleType: "2W" }]),
      processExit: jest.fn().mockResolvedValue({ fare: 75, durationSeconds: 7200, penaltyApplied: true, receiptId: "RCP-2" }),
    };
    render(<ExitConsole gateId="Exit-2" api={api} />);

    await user.type(screen.getByLabelText(/plate number/i), "KA02CD5678");
    await user.click(screen.getByRole("button", { name: /search by plate/i }));
    expect(await screen.findByText("TKT-2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /confirm exit/i }));

    expect(api.searchPlate).toHaveBeenCalledWith("KA02CD5678");
    expect(api.processExit).toHaveBeenCalledWith({ plateNumber: "KA02CD5678", gateId: "Exit-2" });
    expect(await screen.findByText(/lost ticket|penalty applied/i)).toBeInTheDocument();
  });

  test("shows lookup misses and prevents exit confirmation until a vehicle is found", async () => {
    const user = userEvent.setup();
    const api = { lookupTicket: jest.fn().mockRejectedValue({ status: 404, message: "Vehicle not found" }) };
    render(<ExitConsole gateId="Exit-1" api={api} />);

    await user.type(screen.getByLabelText(/ticket id/i), "missing");
    await user.click(screen.getByRole("button", { name: /look up ticket/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/vehicle not found/i);
    expect(screen.queryByRole("button", { name: /confirm exit/i })).not.toBeInTheDocument();
  });
});

describe("AdminConsole", () => {
  test("renders mocked occupancy, revenue, transactions, and audit entries", async () => {
    const api = {
      getOccupancy: jest.fn().mockResolvedValue({ totalPct: 50, byZone: { "2W": { occupied: 1, total: 2 }, "4W": { occupied: 2, total: 4 } }, history: [] }),
      getRevenue: jest.fn().mockResolvedValue({ total: 1250, byDay: [], byZone: { "2W": 250, "4W": 1000 } }),
      getTransactions: jest.fn().mockResolvedValue({ records: [{ ticketId: "TKT-1", plateNumber: "KA01AB1234", status: "active" }] }),
      getAuditLog: jest.fn().mockResolvedValue({ entries: [{ action: "VEHICLE_ENTRY", actorRole: "operator", createdAt: "2026-10-18T10:00:00.000Z" }] }),
    };
    render(<AdminConsole api={api} />);

    expect(await screen.findByText(/50%/)).toBeInTheDocument();
    expect(screen.getByText(/₹?1,?250(?:\.00)?/)).toBeInTheDocument();
    expect(screen.getByText("TKT-1")).toBeInTheDocument();
    expect(screen.getByText("VEHICLE_ENTRY")).toBeInTheDocument();
    expect(api.getOccupancy).toHaveBeenCalledTimes(1);
    expect(api.getRevenue).toHaveBeenCalledTimes(1);
    expect(api.getTransactions).toHaveBeenCalledTimes(1);
    expect(api.getAuditLog).toHaveBeenCalledTimes(1);
  });

  test("shows an accessible loading and recoverable error state for mocked API failures", async () => {
    const api = {
      getOccupancy: jest.fn().mockRejectedValue(new Error("Analytics unavailable")),
      getRevenue: jest.fn().mockResolvedValue({ total: 0, byDay: [], byZone: {} }),
      getTransactions: jest.fn().mockResolvedValue({ records: [] }),
      getAuditLog: jest.fn().mockResolvedValue({ entries: [] }),
    };
    render(<AdminConsole api={api} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/analytics unavailable/i);
  });
});
