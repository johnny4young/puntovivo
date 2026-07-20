import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

/**
 * when the build carries a telemetry DSN, the meta CSP in
 * index.html must allow the renderer to POST envelopes to that
 * origin, or the browser silently drops every event (connect-src
 * violation — caught by the  live smoke). The origin is
 * derived from the same VITE_PUNTOVIVO_SENTRY_DSN that gates the
 * lazy SDK chunk, so the CSP widens ONLY in builds that actually
 * ship the adapter; a DSN-less build keeps the strict baseline.
 * Invalid DSNs leave the HTML untouched (the adapter would not
 * initialise against them anyway).
 */
function sentryConnectSrcPlugin(dsn: string | undefined): Plugin {
  return {
    name: 'puntovivo-sentry-connect-src',
    transformIndexHtml(html) {
      const trimmed = dsn?.trim();
      if (!trimmed) return html;
      let origin: string;
      try {
        origin = new URL(trimmed).origin;
      } catch {
        return html;
      }
      return html.replace(/(connect-src[^;]*)(;)/, (match, sources: string, end: string) =>
        sources.includes(origin) ? match : `${sources} ${origin}${end}`
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    tailwindcss(),
    react(),
    sentryConnectSrcPlugin(loadEnv(mode, __dirname, 'VITE_').VITE_PUNTOVIVO_SENTRY_DSN),
  ],
  resolve: {
    // keep a single React instance across the app and every
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
    // ship sourcemaps only outside production. Prod sourcemaps
    // inflate the desktop/web payload and leak source; re-enable behind a
    // hidden-sourcemap upload once an error-tracking endpoint exists.
    sourcemap: mode !== 'production',
    rollupOptions: {
      output: {
        // split heavy, route-specific vendor libraries out of the
        // main entry chunk so they load only on the screens that use them.
        // Group names are stable: perf-budget.json keys match these chunk
        // basenames (the bundle-size gate strips the content hash). Matching
        // by node_modules path substring keeps scoped sub-packages
        // (@codemirror/*, @dnd-kit/*) in their group without enumerating each.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](jspdf|jspdf-autotable)[\\/]/.test(id)) return 'pdf';
          if (/[\\/]node_modules[\\/](exceljs|jszip)[\\/]/.test(id)) return 'xlsx';
          if (/[\\/]node_modules[\\/](codemirror|@codemirror|@lezer)[\\/]/.test(id))
            return 'codemirror';
          if (/[\\/]node_modules[\\/]@dnd-kit[\\/]/.test(id)) return 'dnd';
          return undefined;
        },
      },
    },
  },
}));
