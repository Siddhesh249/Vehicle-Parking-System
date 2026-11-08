import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminConfig from "./AdminConfig.jsx";

const fareConfig = () => ({
  "2W": {
    firstHourFree: true,
    tiers: [
      { afterHours: 1, rate: 10 },
      { afterHours: 3, rate: 15 },
    ],
    lostTicketPenalty: 50,
    overstayPenalty: 100,
  },
  "4W": {
    firstHourFree: true,
    tiers: [
      { afterHours: 1, rate: 20 },
      { afterHours: 3, rate: 30 },
    ],
    lostTicketPenalty: 100,
    overstayPenalty: 200,
  },
});

function makeApi() {
  return {
    getFareConfig: jest.fn().mockResolvedValue(fareConfig()),
    getSpotConfig: jest.fn().mockResolvedValue({ "2W": 6, "4W": 10 }),
    updateFareTiers: jest.fn().mockResolvedValue({ updated: true }),
    updateSpotCount: jest.fn().mockResolvedValue({ updated: true, zone: "2W", count: 5 }),
  };
}

describe("S4-T4 — admin configuration panel (VPS-F-055, VPS-F-056)", () => {
  test("loads the effective fare table and saves edited tiers without a redeploy", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    const onChanged = jest.fn();
    render(<AdminConfig api={api} onChanged={onChanged} />);

    expect(await screen.findByLabelText("Tier 1 rate per hour")).toHaveValue(20);
    const selected = screen.getByLabelText(/vehicle type/i);
    await user.selectOptions(selected, "2W");

    const rate = screen.getByLabelText("Tier 1 rate per hour");
    await user.clear(rate);
    await user.type(rate, "12");
    await user.click(screen.getByRole("button", { name: /save 2w fare tiers/i }));

    await waitFor(() =>
      expect(api.updateFareTiers).toHaveBeenCalledWith({
        vehicleType: "2W",
        firstHourFree: true,
        tiers: [
          { afterHours: 1, rate: 12 },
          { afterHours: 3, rate: 15 },
        ],
        lostTicketPenalty: 50,
        overstayPenalty: 100,
      }),
    );
    expect(await screen.findByText(/2W fare tiers saved/i)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  test("updates a zone capacity and displays the server's final count", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<AdminConfig api={api} />);

    const input = await screen.findByLabelText("2W spots");
    await user.clear(input);
    await user.type(input, "5");
    await user.click(screen.getByRole("button", { name: /update 2w/i }));

    await waitFor(() =>
      expect(api.updateSpotCount).toHaveBeenCalledWith({ zone: "2W", count: 5 }),
    );
    expect(await screen.findByText(/2W capacity is now 5 spots/i)).toBeInTheDocument();
  });

  test("rejects an invalid tier order before calling the server", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<AdminConfig api={api} />);

    const second = await screen.findByLabelText("Tier 2 after hours");
    await user.clear(second);
    await user.type(second, "0");
    await user.click(screen.getByRole("button", { name: /save 4w fare tiers/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /later than the tier above/i,
    );
    expect(api.updateFareTiers).not.toHaveBeenCalled();
  });
});
