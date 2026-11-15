module.exports = {
  testEnvironment: "jsdom",
  transform: {
    "^.+\\.[jt]sx?$": "babel-jest",
  },
  collectCoverageFrom: ["src/**/*.{js,jsx}", "!src/**/*.test.{js,jsx}", "!src/main.jsx"],
  // Enforced whenever tests run with --coverage (CI does). Floors sit just
  // below the current numbers so coverage can only ratchet upwards.
  coverageThreshold: {
    global: { statements: 80, branches: 68, functions: 82, lines: 82 },
  },
  setupFilesAfterEnv: ["<rootDir>/tests/setupTests.cjs"],
  moduleNameMapper: {
    "\\.(css|less|scss|sass)$": "<rootDir>/tests/styleMock.cjs",
    "\\.(svg|png|jpg|jpeg|gif|webp)$": "<rootDir>/tests/fileMock.cjs",
  },
};
