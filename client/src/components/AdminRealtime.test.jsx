import { act, render, screen, waitFor } from "@testing-library/react";
import AdminConsole from "./AdminConsole.jsx";

const occupancy = (totalPct) => ({
  totalPct,
  byZone: { "2W": { occupied: 1, total: 2 }, "4W": { occupied: 1, total: 2 } },
  history: [],
});

function setup() {
  const api = {
    getOccupancy: jest
      .fn()
      .mockResolvedValueOnce(occupancy(25))
      .mockResolvedValue(occupancy(75)),
    getRevenue: jest.fn().mockResolvedValue({ total: 0, byDay: [], byZone: {} }),
    getTransactions: jest.fn().mockResolvedValue({ records: [] }),
    getAuditLog: jest.fn().mockResolvedValue({ entries: [] }),
  };
  const source = { handlers: null, unsubscribe: jest.fn() };
  const realtime = {
    subscribe: (handlers) => {
      source.handlers = handlers;
      return source.unsubscribe;
    },
  };
  return { api, realtime, source };
}

describe("S3-T4 — admin panels refresh from real API responses", () => {
  test("a spot update triggers one debounced reload of occupancy, revenue, transactions and audit", async () => {
    const { api, realtime, source } = setup();
    render(<AdminConsole api={api} realtime={realtime} />);
    expect(await screen.findByText("25%")).toBeInTheDocument();

    act(() => {
      source.handlers.onUpdate({ spotId: "2W-01", status: "reserved" });
      source.handlers.onUpdate({ spotId: "2W-02", status: "reserved" });
      source.handlers.onUpdate({ spotId: "4W-01", status: "free" });
    });

    expect(await screen.findByText("75%")).toBeInTheDocument();
    await waitFor(() => expect(api.getAuditLog).toHaveBeenCalledTimes(2));
    expect(api.getOccupancy).toHaveBeenCalledTimes(2);
    expect(api.getRevenue).toHaveBeenCalledTimes(2);
    expect(api.getTransactions).toHaveBeenCalledTimes(2);
  });

  test("a refresh keeps the old figures on screen instead of flashing a loading state", async () => {
    const { api, realtime, source } = setup();
    render(<AdminConsole api={api} realtime={realtime} />);
    await screen.findByText("25%");

    act(() => source.handlers.onUpdate({ spotId: "2W-01", status: "reserved" }));
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.queryByText(/loading occupancy/i)).not.toBeInTheDocument();
    await screen.findByText("75%");
  });

  test("unsubscribes from realtime when the dashboard closes", async () => {
    const { api, realtime, source } = setup();
    const { unmount } = render(<AdminConsole api={api} realtime={realtime} />);
    await screen.findByText("25%");

    unmount();
    expect(source.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
