import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      // v8 is the cheapest provider for a Node-only workspace; istanbul
      // would add an instrumentation pass we don't need.
      provider: 'v8',
      // `lcov` is the machine-readable format uploaded as a CI artifact;
      // the others stay for local developer ergonomics (text in the
      // terminal, json for programmatic checks, html for drill-down).
      reporter: ['text', 'text-summary', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        // Generated Drizzle migration SQL + metadata — not executable.
        'src/db/migrations/**',
        // Standalone entry is a thin CLI wrapper covered only by
        // integration smoke via `createServer()` tests.
        'src/standalone.ts',
        // Build scripts / config are tooling, not product code.
        'scripts/**',
        '*.config.{ts,js,mjs}',
      ],
      // ENG-003 — floor at current coverage with a small buffer so
      // micro-fluctuations do not flake CI, but any real regression
      // fails the build. Raising these is tracked as a follow-up; do
      // not lower them without a ROADMAP note.
      thresholds: {
        statements: 80,
        branches: 63,
        functions: 77,
        lines: 80,
      },
    },
    testTimeout: 10000,
  },
});
