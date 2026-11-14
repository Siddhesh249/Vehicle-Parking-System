import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BotEntryPanel from "./BotEntryPanel.jsx";
import BotExitPanel from "./BotExitPanel.jsx";

describe("demo bot queue panels", () => {
  test("the entry operator sees the arriving car and can generate a ticket", async () => {
    const user = userEvent.setup();
    const api = {
      getEntryQueue: jest.fn().mockResolvedValue({
        gateId: "Entry-1",
        queueLength: 2,
        bot: {
          botId: "bot-1",
          plateNumber: "BOT1234ABC",
          vehicleType: "4W",
          waitSeconds: 4,
        },
      }),
      admitEntryBot: jest.fn().mockResolvedValue({
        ticketId: "TKT-1",
        spotNumber: "4W-001",
        zone: "4W",
        intendedStayHours: 2.5,
      }),
    };
    const onAdmitted = jest.fn();
    render(<BotEntryPanel api={api} gateId="Entry-1" onAdmitted={onAdmitted} />);

    expect(await screen.findByText("BOT1234ABC")).toBeInTheDocument();
    expect(screen.getByText("2 waiting")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /generate ticket/i }));

    expect(api.admitEntryBot).toHaveBeenCalledWith({ botId: "bot-1", gateId: "Entry-1" });
    expect(onAdmitted).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: "TKT-1" }),
    );
    expect(await screen.findByText(/ticket tkt-1 issued/i)).toBeInTheDocument();
  });

  test("the exit operator scans, sees the fare and collects payment", async () => {
    const user = userEvent.setup();
    const api = {
      getExitQueue: jest.fn().mockResolvedValue({
        gateId: "Exit-1",
        queueLength: 1,
        bot: { botId: "bot-2", hasTicket: true, waitSeconds: 2 },
      }),
      scanExitBot: jest.fn().mockResolvedValue({
        botId: "bot-2",
        hasTicket: true,
        lostTicket: false,
        ticketId: "TKT-2",
        plateNumber: "BOT9999XYZ",
        vehicleType: "2W",
        entryGateId: "Entry-2",
        quote: {
          fare: 45,
          durationHours: 3.2,
          breakdown: { baseFare: 45 },
        },
      }),
      settleExitBot: jest.fn().mockResolvedValue({
        receiptId: "RCP-1",
        plateNumber: "BOT9999XYZ",
        fare: 45,
        durationHours: 3.2,
        breakdown: { baseFare: 45 },
      }),
    };
    const onSettled = jest.fn();
    render(<BotExitPanel api={api} gateId="Exit-1" onSettled={onSettled} />);

    expect(await screen.findByText(/scan to identify/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /scan ticket/i }));

    expect(api.scanExitBot).toHaveBeenCalledWith({ botId: "bot-2", gateId: "Exit-1" });
    expect(await screen.findByText("BOT9999XYZ")).toBeInTheDocument();
    expect(screen.getAllByText(/45\.00/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /payment collected/i }));

    expect(api.settleExitBot).toHaveBeenCalledWith({ botId: "bot-2", gateId: "Exit-1" });
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ fare: 45 }));
    expect(
      await screen.findByRole("heading", { name: /payment collected/i }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/collect next vehicle/i)).toBeInTheDocument(),
    );
  });
});
