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
      // ENG-003 floored the gate at 65/65/68/60 to match the actual
      // suite at the time and tracked the lift back to 70 as ENG-003b.
      // ENG-003b shipped 13 new + 6 extended test files (roleAccess,
      // useElectron, siteSelection, siteStorage, authStorage,
      // AuthProvider, TenantProvider, sale/purchase/quotation/audit-logs
      // exports, useTableExport, exportService CSV+printTable, pricing,
      // checkoutPayment, providerState, saleCart, defaultLayouts, utils)
      // closing the gap on every axis. Do not lower these without an
      // accompanying ROADMAP note.
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
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
