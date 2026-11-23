/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    // Nest 12 packages are ES modules only. Jest on Node 22 cannot require() them, so these
    // packages (and their ES-module-only helpers, see transformIgnorePatterns) are compiled to
    // CommonJS by ts-jest on the fly. Jest on Node 24.9+ would not need this.
    // Only files inside node_modules (never our own generated Prisma runtime, which must stay as is).
    'node_modules[\\\\/].+\\.js$': [
      '<rootDir>/../jest.esm-transform.cjs',
      {
        tsconfig: {
          allowJs: true,
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          target: 'ES2022',
          skipLibCheck: true,
        },
        diagnostics: false,
      },
    ],
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
  transformIgnorePatterns: [
    '/node_modules/(?!(?:@nestjs|@standard-schema|uid|iterare|load-esm|file-type|strtok3|token-types|peek-readable|@tokenizer|uint8array-extras|es-toolkit)/)',
  ],
  testEnvironment: 'node',
  testTimeout: 20000,
  maxWorkers: 1,
  // Rebuilds hospigo_test (schema drop + migrate deploy + reference seed) before the suite.
  globalSetup: '<rootDir>/../jest.global-setup.cjs',
};
