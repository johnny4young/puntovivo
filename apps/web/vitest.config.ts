import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      // `lcov` is the machine-readable format uploaded as a CI artifact;
      // the others stay for local developer ergonomics (text in the
      // terminal, json for programmatic checks, html for drill-down).
      reporter: ['text', 'text-summary', 'json', 'html', 'lcov'],
      exclude: ['node_modules/', 'src/test/', '**/*.d.ts', '**/*.config.*', '**/types/**'],
      // ENG-003 — floor at current coverage with a small buffer. These
      // were previously declared at 70/70/70/70 but never enforced via
      // CI, and the suite had drifted below. Raising the web floor back
      // toward 70 is tracked as ENG-003b in the ROADMAP. Do not lower
      // these without an accompanying ROADMAP note.
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 68,
        lines: 65,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
