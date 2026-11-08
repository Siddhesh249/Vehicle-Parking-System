import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SimulationConsole from "./SimulationConsole.jsx";

const makeApi = (overrides = {}) => ({
  startSimulation: jest.fn().mockResolvedValue({ status: "running" }),
  stopSimulation: jest.fn().mockResolvedValue({ status: "stopped" }),
  setFareOverride: jest.fn().mockResolvedValue({ updated: true, vehicleType: "4W" }),
  ...overrides,
});

const startButton = () => screen.getByRole("button", { name: /start simulation/i });
const stopButton = () => screen.getByRole("button", { name: /stop simulation/i });

describe("Simulation Console — traffic generator", () => {
  test("uses the default rate when the field is left empty", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<SimulationConsole api={api} />);
    await user.click(startButton());

    expect(api.startSimulation).toHaveBeenCalledWith({ ratePerMinute: 30 });
  });

  test.each(["0", "-5", "601"])(
    "rejects the rate %s without calling the API",
    async (rate) => {
      const user = userEvent.setup();
      const api = makeApi();
      render(<SimulationConsole api={api} />);
      await user.type(screen.getByLabelText(/arrivals per minute/i), rate);
      await user.click(startButton());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /above 0 and up to 600/i,
      );
      expect(api.startSimulation).not.toHaveBeenCalled();
      expect(screen.getByText("Stopped")).toBeInTheDocument();
    },
  );

  test("shows the server's error when the generator cannot start", async () => {
    const user = userEvent.setup();
    const api = makeApi({
      startSimulation: jest
        .fn()
        .mockRejectedValue({ status: 404, message: "Route not found" }),
    });
    render(<SimulationConsole api={api} />);
    await user.click(startButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/route not found/i);
    expect(screen.getByText("Stopped")).toBeInTheDocument();
  });

  test("stop is only available while the generator is on", async () => {
    const user = userEvent.setup();
    render(<SimulationConsole api={makeApi()} />);
    expect(stopButton()).toBeDisabled();

    await user.click(startButton());
    await screen.findByText("Running");
    expect(stopButton()).toBeEnabled();
  });

  test("picks up a generator that is already on and shows its counters", async () => {
    const api = makeApi({
      getSimulationStatus: jest.fn().mockResolvedValue({
        running: true,
        ratePerMinute: 120,
        generatedArrivals: 7,
        successfulAllocations: 5,
        fullLotArrivals: 2,
        lastError: null,
      }),
    });
    render(<SimulationConsole api={api} />);

    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.getByText("120 per minute")).toBeInTheDocument();
    expect(screen.getByText("Turned away (lot full)").nextSibling).toHaveTextContent("2");
  });

  describe("polling", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test("refreshes the counters and notices when the server stops the generator", async () => {
      const getSimulationStatus = jest
        .fn()
        .mockResolvedValueOnce({
          running: true,
          ratePerMinute: 60,
          generatedArrivals: 1,
          successfulAllocations: 1,
          fullLotArrivals: 0,
          lastError: null,
        })
        .mockResolvedValueOnce({
          running: true,
          ratePerMinute: 60,
          generatedArrivals: 9,
          successfulAllocations: 8,
          fullLotArrivals: 1,
          lastError: null,
        })
        .mockResolvedValue({
          running: false,
          ratePerMinute: 0,
          generatedArrivals: 9,
          successfulAllocations: 8,
          fullLotArrivals: 1,
          lastError: null,
        });
      render(<SimulationConsole api={makeApi({ getSimulationStatus })} />);

      // The first poll finds it on, which re-arms the timer and polls again straight away.
      expect(await screen.findByText("Running")).toBeInTheDocument();
      await act(() => jest.advanceTimersByTimeAsync(0));
      expect(screen.getByText("Generated arrivals").nextSibling).toHaveTextContent("9");

      await act(() => jest.advanceTimersByTimeAsync(2000));
      expect(screen.getByText("Stopped")).toBeInTheDocument();
    });
  });
});

describe("Simulation Console — fare override", () => {
  test("sends the 4W defaults, with optional fields left out", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<SimulationConsole api={api} />);
    await user.click(screen.getByRole("button", { name: /apply fare override/i }));

    expect(api.setFareOverride).toHaveBeenCalledWith({
      vehicleType: "4W",
      firstHourFree: true,
      tiers: [
        { afterHours: 1, ratePerHour: 20 },
        { afterHours: 3, ratePerHour: 30 },
        { afterHours: 6, ratePerHour: 50 },
      ],
      lostTicketPenalty: 100,
    });
    expect(await screen.findByText(/fare override applied for 4w/i)).toBeInTheDocument();
  });

  test("switching vehicle type loads that type's defaults, and edits are sent", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<SimulationConsole api={api} />);
    await user.selectOptions(screen.getAllByLabelText(/vehicle type/i)[0], "2W");
    expect(screen.getByLabelText(/tier 1 rate per hour/i)).toHaveValue(10);

    await user.clear(screen.getByLabelText(/tier 1 rate per hour/i));
    await user.type(screen.getByLabelText(/tier 1 rate per hour/i), "12.5");
    await user.type(screen.getByLabelText(/overstay penalty/i), "75");
    await user.click(screen.getByLabelText(/first hour free/i));
    await user.click(screen.getByRole("button", { name: /apply fare override/i }));

    expect(api.setFareOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicleType: "2W",
        firstHourFree: false,
        overstayPenalty: 75,
        tiers: [
          { afterHours: 1, ratePerHour: 12.5 },
          { afterHours: 3, ratePerHour: 15 },
          { afterHours: 6, ratePerHour: 25 },
        ],
      }),
    );
  });

  test("blank tier rows are ignored", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<SimulationConsole api={api} />);
    for (const label of [/tier 3 starts after/i, /tier 3 rate per hour/i]) {
      await user.clear(screen.getByLabelText(label));
    }
    await user.click(screen.getByRole("button", { name: /apply fare override/i }));

    expect(api.setFareOverride.mock.calls[0][0].tiers).toHaveLength(2);
  });

  test("rejects tiers whose start hours do not increase", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<SimulationConsole api={api} />);
    await user.clear(screen.getByLabelText(/tier 2 starts after/i));
    await user.type(screen.getByLabelText(/tier 2 starts after/i), "1");
    await user.click(screen.getByRole("button", { name: /apply fare override/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /start hours must increase/i,
    );
    expect(api.setFareOverride).not.toHaveBeenCalled();
  });

  test("rejects a negative penalty", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<SimulationConsole api={api} />);
    await user.clear(screen.getByLabelText(/lost-ticket penalty/i));
    await user.type(screen.getByLabelText(/lost-ticket penalty/i), "-1");
    await user.click(screen.getByRole("button", { name: /apply fare override/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /penalties must be zero or more/i,
    );
    expect(api.setFareOverride).not.toHaveBeenCalled();
  });

  test("shows the server's validation message", async () => {
    const user = userEvent.setup();
    const api = makeApi({
      setFareOverride: jest.fn().mockRejectedValue({
        status: 400,
        message: "Fare tiers need increasing afterHours",
      }),
    });
    render(<SimulationConsole api={api} />);
    await user.click(screen.getByRole("button", { name: /apply fare override/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /need increasing afterhours/i,
    );
  });
});
