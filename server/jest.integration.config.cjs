module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest'],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(otplib|@otplib|@scure|@noble)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/tests/setupTests.ts'],
  testMatch: ['**/src/tests/integration/**/*.test.ts'],
  // Integration fixtures apply real MySQL transactions, bcrypt and full
  // counterflows. Five seconds is too short on shared CI/developer hosts, but a
  // bounded 30-second ceiling still exposes deadlocks and genuine hangs.
  testTimeout: 30_000,
  verbose: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
