import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";
import { clearSession } from "./api/session.js";

describe("parking console routes", () => {
  beforeEach(() => clearSession());

  test("opens the sign-in page directly instead of a console chooser", () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /sign in to your gate/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.queryByText(/choose a console/i)).not.toBeInTheDocument();
  });

  test("demo account buttons pre-fill credentials without bypassing login", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/");
    render(<App />);

    await user.click(screen.getByRole("button", { name: /entry 1/i }));

    expect(screen.getByLabelText(/username/i)).toHaveValue("entry1");
    expect(screen.getByLabelText(/password/i)).toHaveValue("password123");
    // Nothing is signed in until the form is submitted.
    expect(window.location.pathname).toBe("/");
  });

  test("a pre-filled demo account signs in and lands on its gate", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/login");
    render(<App />);

    await user.click(screen.getByRole("button", { name: /exit 1/i }));
    await user.click(screen.getByRole("button", { name: /^sign in/i }));

    expect(
      await screen.findByRole("heading", { name: /exit gate 1/i }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/exit-1");
  });

  test.each([
    ["/entry-1", "Entry Gate 1"],
    ["/entry-2", "Entry Gate 2"],
    ["/exit-1", "Exit Gate 1"],
    ["/exit-2", "Exit Gate 2"],
    ["/admin", "Admin Dashboard"],
  ])("renders the %s route", (path, label) => {
    window.history.pushState({}, "", path);
    render(<App />);
    expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
  });
});
