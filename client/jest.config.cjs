module.exports = {
  testEnvironment: "jsdom",
  transform: {
    "^.+\\.[jt]sx?$": "babel-jest",
  },
  setupFilesAfterEnv: ["<rootDir>/tests/setupTests.cjs"],
  moduleNameMapper: {
    "\\.(css|less|scss|sass)$": "<rootDir>/tests/styleMock.cjs",
    "\\.(svg|png|jpg|jpeg|gif|webp)$": "<rootDir>/tests/fileMock.cjs",
  },
};
