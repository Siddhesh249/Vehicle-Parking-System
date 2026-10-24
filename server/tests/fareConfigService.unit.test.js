"use strict";

jest.mock("../models/FareTierConfig", () => ({ findOne: jest.fn() }));

const FareTierConfig = require("../models/FareTierConfig");
const { getFareConfig } = require("../services/fareConfigService");

describe("fare configuration service", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns undefined when the administrator has not configured a rate table", async () => {
    FareTierConfig.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    await expect(getFareConfig("4W")).resolves.toBeUndefined();
  });

  test("maps a persisted rate table into the fare-service configuration contract", async () => {
    const configured = {
      vehicleType: "2W",
      firstHourFree: true,
      tiers: [{ afterHours: 1, ratePerHour: 12 }],
      lostTicketPenalty: 55,
      overstayPenalty: 125,
    };
    FareTierConfig.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(configured),
    });

    await expect(getFareConfig("2W")).resolves.toEqual({
      "2W": {
        firstHourFree: true,
        tiers: [{ afterHours: 1, ratePerHour: 12 }],
        lostTicketPenalty: 55,
        overstayPenalty: 125,
      },
    });
    expect(FareTierConfig.findOne).toHaveBeenCalledWith({ vehicleType: "2W" });
  });
});
