/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  // Decorators and their metadata are the whole point of a NestJS module; ts-jest
  // reads the project's tsconfig so the tests see the same emit as the build.
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/bin.ts'],
  coverageDirectory: 'coverage',
};
