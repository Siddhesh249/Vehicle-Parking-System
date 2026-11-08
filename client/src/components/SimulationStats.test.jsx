import { act, render, screen } from "@testing-library/react";
import SimulationStats from "./SimulationStats.jsx";

const reading = (overrides = {}) => ({
  running: true,
  ratePerMinute: 120,
  generatedArrivals: 7,
  successfulAllocations: 5,
  fullLotArrivals: 2,
  lastError: null,
  ...overrides,
});

describe("Simulation counters", () => {
  test("shows the counters from the status reading", async () => {
    const api = { getSimulationStatus: jest.fn().mockResolvedValue(reading()) };
    render(<SimulationStats api={api} />);

    expect(await screen.findByText("120 per minute")).toBeInTheDocument();
    expect(screen.getByText("Generated arrivals").nextSibling).toHaveTextContent("7");
    expect(screen.getByText("Parked").nextSibling).toHaveTextContent("5");
    expect(screen.getByText("Turned away (lot full)").nextSibling).toHaveTextContent("2");
    expect(screen.queryByText("Last error")).not.toBeInTheDocument();
  });

  test("shows the last error when the generator reports one", async () => {
    const api = {
      getSimulationStatus: jest.fn().mockResolvedValue(reading({ lastError: "Database unavailable" })),
    };
    render(<SimulationStats api={api} />);

    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
  });

  test("tells the reader it is waiting until the first reading arrives", () => {
    const api = { getSimulationStatus: jest.fn().mockReturnValue(new Promise(() => {})) };
    render(<SimulationStats api={api} />);

    expect(screen.getByText(/waiting for the first reading/i)).toBeInTheDocument();
  });

  describe("polling", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test("refreshes every few seconds and stops when the page closes", async () => {
      const getSimulationStatus = jest
        .fn()
        .mockResolvedValueOnce(reading({ generatedArrivals: 1 }))
        .mockResolvedValue(reading({ generatedArrivals: 9 }));
      const { unmount } = render(<SimulationStats api={{ getSimulationStatus }} />);

      await act(() => jest.advanceTimersByTimeAsync(0));
      expect(screen.getByText("Generated arrivals").nextSibling).toHaveTextContent("1");
      await act(() => jest.advanceTimersByTimeAsync(2000));
      expect(screen.getByText("Generated arrivals").nextSibling).toHaveTextContent("9");

      unmount();
      const calls = getSimulationStatus.mock.calls.length;
      await jest.advanceTimersByTimeAsync(6000);
      expect(getSimulationStatus).toHaveBeenCalledTimes(calls);
    });

    test("keeps the last numbers when a reading fails", async () => {
      const getSimulationStatus = jest
        .fn()
        .mockResolvedValueOnce(reading({ generatedArrivals: 4 }))
        .mockRejectedValue(new Error("offline"));
      render(<SimulationStats api={{ getSimulationStatus }} />);

      await act(() => jest.advanceTimersByTimeAsync(0));
      await act(() => jest.advanceTimersByTimeAsync(4000));
      expect(screen.getByText("Generated arrivals").nextSibling).toHaveTextContent("4");
    });
  });

  test("renders nothing risky when the API has no status method", () => {
    render(<SimulationStats api={{}} />);

    expect(screen.getByText(/waiting for the first reading/i)).toBeInTheDocument();
  });
});
