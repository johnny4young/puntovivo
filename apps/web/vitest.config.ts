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
      // floored the gate at 65/65/68/60 to match the actual
      // suite at the time and tracked the lift back to 70 as .
      // shipped 13 new + 6 extended test files (roleAccess,
      // useElectron, siteSelection, siteStorage, authStorage,
      // AuthProvider, TenantProvider, sale/purchase/quotation/audit-logs
      // exports, useTableExport, exportService CSV+printTable, pricing,
      // checkoutPayment, providerState, saleCart, defaultLayouts, utils)
      // closing the gap on every axis. Do not lower these without an
      // accompanying documented rationale.
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
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
