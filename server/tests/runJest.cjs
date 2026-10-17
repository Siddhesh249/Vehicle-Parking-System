"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const jestCli = path.resolve(__dirname, "../node_modules/jest/bin/jest.js");
const result = spawnSync(
  process.execPath,
  ["--experimental-vm-modules", jestCli, "--runInBand", ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
