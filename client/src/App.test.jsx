import { render, screen } from "@testing-library/react";
import App from "./App.jsx";

describe("parking console routes", () => {
  test("shows navigation for all four gate consoles and the admin dashboard", () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /choose a console/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /entry gate 1/i })).toHaveAttribute(
      "href",
      "/entry-1",
    );
    expect(screen.getByRole("link", { name: /entry gate 2/i })).toHaveAttribute(
      "href",
      "/entry-2",
    );
    expect(screen.getByRole("link", { name: /exit gate 1/i })).toHaveAttribute(
      "href",
      "/exit-1",
    );
    expect(screen.getByRole("link", { name: /exit gate 2/i })).toHaveAttribute(
      "href",
      "/exit-2",
    );
    expect(screen.getByRole("link", { name: /admin dashboard/i })).toHaveAttribute(
      "href",
      "/admin",
    );
  });

  test.each([
    ["/entry-1", "Entry Gate 1"],
    ["/entry-2", "Entry Gate 2"],
    ["/exit-1", "Exit Gate 1"],
    ["/exit-2", "Exit Gate 2"],
    ["/admin", "Admin Dashboard"],
  ])("renders the %s route stub", (path, label) => {
    window.history.pushState({}, "", path);
    render(<App />);
    expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /all consoles/i })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
