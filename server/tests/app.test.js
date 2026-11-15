const request = require("supertest");
const { app } = require("../app");

describe("API shell", () => {
  test("GET /api/health returns the API and database status", async () => {
    const response = await request(app).get("/api/health").expect(200);

    expect(response.body.status).toBe("ok");
    expect(["connected", "disconnected"]).toContain(response.body.database);
  });

  test("unknown routes use the standard JSON error envelope", async () => {
    const response = await request(app).get("/api/does-not-exist").expect(404);

    expect(response.body).toEqual({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });

  test("malformed JSON is rejected with a recoverable client error", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send('{"username":')
      .expect(400);

    expect(response.body.error.code).toBe("INVALID_JSON");
  });
});
