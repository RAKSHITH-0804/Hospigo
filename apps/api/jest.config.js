/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // Inline options so ../scripts/*.ts (imported by seed cleanup) compile as CJS too.
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          verbatimModuleSyntax: false,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          strict: true,
          skipLibCheck: true,
          target: 'ES2022',
        },
      },
    ],
  },
  testEnvironment: 'node',
  testTimeout: 20000,
  maxWorkers: 1,
  // Rebuilds hospigo_test (schema drop + migrate deploy + reference seed) before the suite.
  globalSetup: '<rootDir>/../jest.global-setup.cjs',
};
