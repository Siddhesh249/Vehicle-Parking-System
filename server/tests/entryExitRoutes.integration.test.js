"use strict";

jest.mock("../services/loginService", () => ({ login: jest.fn() }));
jest.mock("../services/allocationService", () => ({ allocateSpot: jest.fn() }));
jest.mock("../services/fareExitService", () => ({
  lookupByTicket: jest.fn(),
  searchByPlate: jest.fn(),
  processExit: jest.fn(),
}));
jest.mock("../utils/jwtUtils", () => ({ verifyToken: jest.fn() }));

const request = require("supertest");
const { app } = require("../app");
const { allocateSpot } = require("../services/allocationService");
const { lookupByTicket, searchByPlate, processExit } = require("../services/fareExitService");
const { verifyToken } = require("../utils/jwtUtils");

describe("Sprint 3 entry/exit API routes", () => {
  beforeEach(() => jest.clearAllMocks());

  test("rejects requests without a Bearer token", async () => {
    await request(app).post("/api/entry/vehicles").send({
      plateNumber: "KA01AB1234",
      vehicleType: "4W",
    }).expect(401);

    expect(allocateSpot).not.toHaveBeenCalled();
  });

  test("creates an entry using the authenticated operator's gate and ID", async () => {
    verifyToken.mockReturnValue({
      userId: "operator-1",
      role: "operator",
      gateId: "Entry-1",
    });
    allocateSpot.mockResolvedValue({
      ticketId: "TKT-1",
      spotId: "spot-1",
      spotNumber: "A1",
      zone: "4W",
    });

    const response = await request(app)
      .post("/api/entry/vehicles")
      .set("Authorization", "Bearer valid-token")
      .send({ plateNumber: "KA01AB1234", vehicleType: "4W" })
      .expect(201);

    expect(allocateSpot).toHaveBeenCalledWith({
      plateNumber: "KA01AB1234",
      vehicleType: "4W",
      gateId: "Entry-1",
      operatorId: "operator-1",
    });
    expect(response.body.ticketId).toBe("TKT-1");
  });

  test("looks up an active exit ticket by ticket ID", async () => {
    verifyToken.mockReturnValue({
      userId: "operator-2",
      role: "operator",
      gateId: "Exit-1",
    });
    lookupByTicket.mockResolvedValue({ ticketId: "TKT-1", status: "active" });

    const response = await request(app)
      .get("/api/exit/lookup/TKT-1")
      .set("Authorization", "Bearer valid-token")
      .expect(200);

    expect(lookupByTicket).toHaveBeenCalledWith("TKT-1");
    expect(response.body.status).toBe("active");
  });

  test("searches for an active exit by plate number", async () => {
    verifyToken.mockReturnValue({
      userId: "operator-2",
      role: "operator",
      gateId: "Exit-2",
    });
    searchByPlate.mockResolvedValue([{ ticketId: "TKT-1" }]);

    const response = await request(app)
      .get("/api/exit/search")
      .query({ plateNumber: "KA01AB1234" })
      .set("Authorization", "Bearer valid-token")
      .expect(200);

    expect(searchByPlate).toHaveBeenCalledWith("KA01AB1234");
    expect(response.body).toHaveLength(1);
  });

  test("processes exit using authenticated gate and operator rather than client-supplied identity", async () => {
    verifyToken.mockReturnValue({
      userId: "operator-2",
      role: "operator",
      gateId: "Exit-2",
    });
    processExit.mockResolvedValue({ receiptId: "receipt-1", fare: 30 });

    const response = await request(app)
      .post("/api/exit/process")
      .set("Authorization", "Bearer valid-token")
      .send({ ticketId: "TKT-1", gateId: "Exit-1", operatorId: "spoofed" })
      .expect(200);

    expect(processExit).toHaveBeenCalledWith({
      ticketId: "TKT-1",
      plateNumber: undefined,
      gateId: "Exit-2",
      operatorId: "operator-2",
    });
    expect(response.body.receiptId).toBe("receipt-1");
  });

  test("rejects an entry operator on exit routes", async () => {
    verifyToken.mockReturnValue({
      userId: "operator-1",
      role: "operator",
      gateId: "Entry-1",
    });

    await request(app)
      .get("/api/exit/search")
      .query({ plateNumber: "KA01AB1234" })
      .set("Authorization", "Bearer valid-token")
      .expect(403);

    expect(searchByPlate).not.toHaveBeenCalled();
  });
});
