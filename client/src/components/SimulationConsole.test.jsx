/**
 * Sprint 4 — S4-T3: Simulation Console UI smoke test (VPS-DEV-001..003).
 *
 * The developer-only console is reachable directly, never from a gate or admin
 * console. It controls the synthetic arrival rate and reflects start/stop state.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SimulationConsole from "./SimulationConsole.jsx";

function makeApi() {
  return {
    startSimulation: jest.fn().mockResolvedValue({ status: "running" }),
    stopSimulation: jest.fn().mockResolvedValue({ status: "stopped" }),
  };
}

describe("S4-T3 — Simulation Console", () => {
  test("starts the generator at the configured arrivals-per-minute rate", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<SimulationConsole api={api} />);

    await user.type(screen.getByLabelText(/arrivals per minute/i), "60");
    await user.click(screen.getByRole("button", { name: /start/i }));

    expect(api.startSimulation).toHaveBeenCalledWith({ ratePerMinute: 60 });
    expect(await screen.findByText(/running/i)).toBeInTheDocument();
  });

  test("stops a running generator and reports the stopped state", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<SimulationConsole api={api} />);

    await user.click(screen.getByRole("button", { name: /start/i }));
    await screen.findByText(/running/i);
    await user.click(screen.getByRole("button", { name: /stop/i }));

    expect(api.stopSimulation).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/stopped/i)).toBeInTheDocument();
  });

  test("labels every control so the dev utility remains keyboard accessible", () => {
    render(<SimulationConsole api={makeApi()} />);

    expect(
      screen.getByRole("heading", { name: /simulation console/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/arrivals per minute/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });
});
