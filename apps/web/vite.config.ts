import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), react()],
  resolve: {
    // ENG-172 — keep a single React instance across the app and every
    // hooks-based dependency (e.g. @tanstack/react-virtual). Prevents a
    // duplicate React copy from breaking the hooks dispatcher.
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8090',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // ENG-170 — ship sourcemaps only outside production. Prod sourcemaps
    // inflate the desktop/web payload and leak source; re-enable behind a
    // hidden-sourcemap upload once an error-tracking endpoint exists.
    sourcemap: mode !== 'production',
    rollupOptions: {
      output: {
        // ENG-170 — split heavy, route-specific vendor libraries out of the
        // main entry chunk so they load only on the screens that use them.
        // Group names are stable: perf-budget.json keys match these chunk
        // basenames (the bundle-size gate strips the content hash). Matching
        // by node_modules path substring keeps scoped sub-packages
        // (@codemirror/*, @dnd-kit/*) in their group without enumerating each.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](jspdf|jspdf-autotable)[\\/]/.test(id)) return 'pdf';
          if (/[\\/]node_modules[\\/](exceljs|jszip)[\\/]/.test(id)) return 'xlsx';
          if (/[\\/]node_modules[\\/](codemirror|@codemirror|@lezer)[\\/]/.test(id)) return 'codemirror';
          if (/[\\/]node_modules[\\/]@dnd-kit[\\/]/.test(id)) return 'dnd';
          return undefined;
        },
      },
    },
  },
}));
