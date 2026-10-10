const request = require("supertest");
const { app } = require("../app");

describe("GET /api/health", () => {
  test("returns the API and database status", async () => {
    const response = await request(app)
      .get("/api/health")
      .expect(200);

    expect(response.body.status).toBe("ok");
    expect(["connected", "disconnected"]).toContain(
      response.body.database
    );
  });
});
