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
      // `lcov` is the machine-readable format CI uploads as an artifact;
      // `text-summary` is the four-line floor counters the operator
      // reads at the end of the run. The verbose `text` / `json` /
      // `html` reporters are dev-only ergonomics — they write 1000+ HTML
      // files on every server run and pinned ci:server at 42 s wall on
      // a warm MacBook. Run them on demand via:
      //   npx vitest run --coverage --coverage.reporter=html
      //   npx vitest run --coverage --coverage.reporter=json
      // Restoring them to the default list re-adds the disk-I/O cost.
      reporter: ['text-summary', 'lcov'],
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
