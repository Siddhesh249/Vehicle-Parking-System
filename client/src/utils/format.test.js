import { normalizePlate } from "./format.js";

describe("normalizePlate", () => {
  test("matches the server's canonical plate form", () => {
    expect(normalizePlate(" ka 01-ab 1234 ")).toBe("KA01AB1234");
    expect(normalizePlate("KA01AB1234")).toBe("KA01AB1234");
  });
});
