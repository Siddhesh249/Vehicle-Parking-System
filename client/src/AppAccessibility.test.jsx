import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";
import { mockApi } from "./api/mockApi.js";

const renderAt = (path) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

describe("final accessibility pass", () => {
  test("every page has banner, main and footer landmarks and a skip link to the content", () => {
    renderAt("/");

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /skip to main content/i })).toHaveAttribute(
      "href",
      "#main-content",
    );
    // The header must sit outside <main> so it is exposed as the page banner.
    expect(screen.getByRole("main")).not.toContainElement(screen.getByRole("banner"));
  });

  test.each([
    ["/", "Choose a console"],
    ["/entry-1", "Entry Gate 1"],
    ["/admin", "Admin Dashboard"],
    ["/dev/simulate", "Developer tools"],
  ])("%s has a descriptive page title and one top-level heading", (path, title) => {
    renderAt(path);

    expect(document.title).toBe(`${title} · Vehicle Parking System`);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
  });

  test("the developer page is a direct address only: no skip, nav or footer link points to it", () => {
    renderAt("/dev/simulate");

    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toMatch(/simulate/);
    }
  });

  test("admin tables have accessible names", async () => {
    // The audit log only shows a table once something has been logged.
    await mockApi.createEntry({
      plateNumber: "KA99ZZ0001",
      vehicleType: "2W",
      gateId: "Entry-1",
    });
    renderAt("/admin");

    expect(
      await screen.findByRole("table", { name: "Transactions" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("table", { name: "Audit log" })).toBeInTheDocument();
  });

  test("lot map spots carry a text label, not colour alone", async () => {
    renderAt("/entry-1");

    const spots = await screen.findAllByText(/^(Free|Reserved)$/);
    expect(spots.length).toBeGreaterThan(0);
  });

  test("the simulation page shows the lot filling up while the generator runs", async () => {
    const user = userEvent.setup();
    renderAt("/dev/simulate");
    await screen.findAllByText(/^(Free|Reserved)$/);
    const reservedBefore = screen.getAllByText("Reserved").length;

    await user.type(screen.getByLabelText(/arrivals per minute/i), "600");
    await user.click(screen.getByRole("button", { name: /start simulation/i }));
    await waitFor(
      () =>
        expect(screen.getAllByText("Reserved").length).toBeGreaterThan(reservedBefore),
      { timeout: 4000 },
    );

    await user.click(screen.getByRole("button", { name: /stop simulation/i }));
    await screen.findByText("Stopped");
  });
});
