import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";
import { mockApi } from "./api/mockApi.js";
import { clearSession } from "./api/session.js";

const renderAt = (path) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

describe("final accessibility pass", () => {
  beforeEach(() => clearSession());

  test("every page has banner, main and footer landmarks and a skip link to the content", () => {
    renderAt("/login");

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
    ["/login", "Sign in", /^sign in$/i],
    ["/entry-1", "Entry Gate 1", /entry gate 1/i],
    ["/admin", "Admin Dashboard", /admin dashboard/i],
    ["/dev/simulate", "Developer tools", /developer tools/i],
  ])(
    "%s has a descriptive page title and one top-level heading",
    (path, title, heading) => {
      renderAt(path);

      expect(document.title).toBe(`${title} · Vehicle Parking System`);
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(heading);
    },
  );

  test("the developer page is a direct address only: no skip, nav or footer link points to it", () => {
    renderAt("/dev/simulate");

    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toMatch(/simulate/);
    }
  });

  test("admin tables have accessible names and a scrollable database view", async () => {
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
    expect(await screen.findByRole("region", { name: /database/i })).toBeInTheDocument();
  });

  test("lot map spots carry a text label, not colour alone", async () => {
    renderAt("/entry-1");

    const spots = await screen.findAllByText(/^(Free|Occupied|Overstay)$/);
    expect(spots.length).toBeGreaterThan(0);
  });

  test("starting the bot fleet fills the entry queue and waiting counters", async () => {
    const user = userEvent.setup();
    renderAt("/dev/simulate");
    await screen.findByText("Waiting at entry");

    await user.type(screen.getByLabelText(/arrivals per minute/i), "600");
    await user.click(screen.getByRole("button", { name: /start fleet/i }));

    await waitFor(
      () => {
        const value = screen
          .getByText("Waiting at entry")
          .parentElement.querySelector(".fleet-stat__value").textContent;
        expect(Number(value)).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );

    await user.click(screen.getByRole("button", { name: /^stop$/i }));
    await screen.findByText("Stopped");
  });
});
