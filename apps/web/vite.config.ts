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
  // Production ships as a portable Electron resource bundle. Keep its assets
  // relative to the protocol-backed index document rather than coupling the
  // output to an HTTP deployment root. The dev server retains its conventional
  // root base.
  base: mode === 'production' ? './' : '/',
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
    // The only chunk above Vite's generic 500 kB heuristic is the lazy XLSX
    // exporter. Puntovivo enforces a stricter gzip ceiling for every named
    // chunk in perf-budget.json/check-bundle-size.mjs, so keep Vite focused on
    // unexpected megabyte-scale output while the app-specific gate owns the
    // real route-split budget.
    chunkSizeWarningLimit: 1000,
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
          // Keep the startup module graph in bounded execution units. A single
          // vendor entry made ReactDOM + routing + forms + data clients execute
          // as one long task under Lighthouse's CPU throttle, inflating TBT on
          // every authenticated route even though route chunks were lazy.
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
            return 'react-runtime';
          if (/[\\/]node_modules[\\/]react-router[\\/]/.test(id)) return 'routing';
          if (/[\\/]node_modules[\\/]react-hook-form[\\/]/.test(id)) return 'forms';
          if (/[\\/]node_modules[\\/](@tanstack|@trpc)[\\/]/.test(id)) return 'data-runtime';
          if (
            /[\\/]node_modules[\\/](i18next|react-i18next|i18next-resources-to-backend)[\\/]/
              .test(id)
          )
            return 'i18n-runtime';
          if (/[\\/]node_modules[\\/](clsx|tailwind-merge)[\\/]/.test(id))
            return 'style-runtime';
          if (/[\\/]node_modules[\\/]zustand[\\/]/.test(id)) return 'state-runtime';
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
