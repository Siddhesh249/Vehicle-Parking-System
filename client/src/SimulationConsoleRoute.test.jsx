/**
 * Sprint 4 — S4-T3: Simulation Console routing and role isolation (VPS-DEV-003).
 *
 * The console is a developer-only direct URL. It must never appear in the
 * operator/admin navigation, but the direct route must render it.
 */
import { render, screen } from "@testing-library/react";
import App from "./App.jsx";

describe("S4-T3 — Simulation Console routing", () => {
  test("renders the Simulation Console at the direct developer route", () => {
    window.history.pushState({}, "", "/dev/simulate");
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /simulation console/i }),
    ).toBeInTheDocument();
  });

  test("does not expose the Simulation Console in the role navigation", () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    expect(screen.queryByRole("link", { name: /simulation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /simulation/i })).not.toBeInTheDocument();
  });
});
