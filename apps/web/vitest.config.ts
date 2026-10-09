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
    // The suite mounts hundreds of JSDOM trees. Letting Vitest mirror a
    // high-core developer machine creates enough CPU and memory contention
    // that unrelated 1-second findBy assertions expire and coverage can hang
    // after reporting failures. Keep useful parallelism, but make the gate
    // deterministic across laptops and hosted runners.
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      // `lcov` is the machine-readable format uploaded as a CI artifact;
      // the others stay for local developer ergonomics (text in the
      // terminal, json for programmatic checks, html for drill-down).
      reporter: ['text', 'text-summary', 'json', 'html', 'lcov'],
      exclude: ['node_modules/', 'src/test/', '**/*.d.ts', '**/*.config.*', '**/types/**'],
      // Native feature, auth, export, pricing and checkout tests support these floors.
      // Removing obsolete tests must not lower them without a documented rationale.
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    server: {
      deps: {
        // inline @tanstack/react-virtual so vitest transforms it
        // through vite (honouring `resolve.dedupe`) instead of loading its
        // CJS build via require(), which would register a second React
        // module instance with a null hooks dispatcher.
        inline: ['@tanstack/react-virtual'],
      },
    },
  },
  resolve: {
    // force a single React instance. `@tanstack/react-virtual`
    // resolves its own `react` import (it loads as raw source under vitest),
    // which otherwise yields a second copy with a null hooks dispatcher
    // ("Cannot read properties of null (reading 'useReducer')"). Deduping
    // keeps every package on the workspace React.
    // CodeMirror extensions also rely on shared state/view class identities.
    // Compatible nested copies otherwise duplicate the editor runtime.
    dedupe: ['react', 'react-dom', '@codemirror/state', '@codemirror/view'],
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
