/**
 * Sprint 4 — S4-T5: final Test Execution Summary/Log deliverable (STP Section 8).
 *
 * S4-T5 is a documentation deliverable rather than runtime code. This test
 * keeps the report honest: it must exist, cover all Sprint 4 tasks, include the
 * server/client Jest results and the k6 concurrency result, and record the
 * exit-criteria sign-off.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPORT_PATH = path.resolve(__dirname, "../../../DOCS/Test_Execution_Summary.md");

function readReport() {
  return fs.existsSync(REPORT_PATH) ? fs.readFileSync(REPORT_PATH, "utf8") : "";
}

describe("S4-T5 — Test Execution Summary/Log", () => {
  test("exists at DOCS/Test_Execution_Summary.md", () => {
    expect(fs.existsSync(REPORT_PATH)).toBe(true);
  });

  test("records results for S4-T1 through S4-T5", () => {
    const report = readReport();
    for (const task of ["S4-T1", "S4-T2", "S4-T3", "S4-T4", "S4-T5"]) {
      expect(report).toContain(task);
    }
  });

  test("includes the Jest suites, k6 load result, and exit-criteria sign-off", () => {
    const report = readReport();
    expect(report).toMatch(/server/i);
    expect(report).toMatch(/client/i);
    expect(report).toMatch(/k6/i);
    expect(report).toMatch(/duplicate/i);
    expect(report).toMatch(/pass|fail/i);
    expect(report).toMatch(/exit criteria/i);
    expect(report).toMatch(/sign[- ]?off/i);
  });
});
