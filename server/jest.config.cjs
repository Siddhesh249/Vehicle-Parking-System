module.exports = {
  testEnvironment: "node",
  setupFiles: ["<rootDir>/tests/setupEnv.cjs"],
  // Enforced whenever tests run with --coverage (CI does). Floors sit just
  // below the current numbers so coverage can only ratchet upwards.
  coverageThreshold: {
    global: { statements: 85, branches: 70, functions: 88, lines: 85 },
  },
};
