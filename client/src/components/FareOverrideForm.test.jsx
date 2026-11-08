import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FareOverrideForm from "./FareOverrideForm.jsx";

const makeApi = (overrides = {}) => ({
  setSimulationFareTiers: jest.fn().mockResolvedValue({ updated: true, vehicleType: "4W" }),
  ...overrides,
});
const apply = () => screen.getByRole("button", { name: /apply fare override/i });

describe("Fare override form (VPS-DEV-002)", () => {
  test("sends the 4W defaults, with optional fields left out", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<FareOverrideForm api={api} />);
    await user.click(apply());

    expect(api.setSimulationFareTiers).toHaveBeenCalledWith({
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
    render(<FareOverrideForm api={api} />);
    await user.selectOptions(screen.getByLabelText(/vehicle type/i), "2W");
    expect(screen.getByLabelText(/tier 1 rate per hour/i)).toHaveValue(10);

    await user.clear(screen.getByLabelText(/tier 1 rate per hour/i));
    await user.type(screen.getByLabelText(/tier 1 rate per hour/i), "12.5");
    await user.type(screen.getByLabelText(/overstay penalty/i), "75");
    await user.click(screen.getByLabelText(/first hour free/i));
    await user.click(apply());

    expect(api.setSimulationFareTiers).toHaveBeenCalledWith(
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
    render(<FareOverrideForm api={api} />);
    await user.clear(screen.getByLabelText(/tier 3 starts after/i));
    await user.clear(screen.getByLabelText(/tier 3 rate per hour/i));
    await user.click(apply());

    expect(api.setSimulationFareTiers.mock.calls[0][0].tiers).toHaveLength(2);
  });

  test("rejects tiers whose start hours do not increase", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<FareOverrideForm api={api} />);
    await user.clear(screen.getByLabelText(/tier 2 starts after/i));
    await user.type(screen.getByLabelText(/tier 2 starts after/i), "1");
    await user.click(apply());

    expect(await screen.findByRole("alert")).toHaveTextContent(/start hours must increase/i);
    expect(api.setSimulationFareTiers).not.toHaveBeenCalled();
  });

  test("rejects a negative penalty", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<FareOverrideForm api={api} />);
    await user.clear(screen.getByLabelText(/lost-ticket penalty/i));
    await user.type(screen.getByLabelText(/lost-ticket penalty/i), "-1");
    await user.click(apply());

    expect(await screen.findByRole("alert")).toHaveTextContent(/penalties must be zero or more/i);
    expect(api.setSimulationFareTiers).not.toHaveBeenCalled();
  });

  test("shows the server's validation message", async () => {
    const user = userEvent.setup();
    const api = makeApi({
      setSimulationFareTiers: jest
        .fn()
        .mockRejectedValue({ status: 400, message: "Fare tiers need increasing afterHours" }),
    });
    render(<FareOverrideForm api={api} />);
    await user.click(apply());

    expect(await screen.findByRole("alert")).toHaveTextContent(/need increasing afterhours/i);
  });
});
