import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => ({
  build: {
    // ENG-170 — sourcemaps only outside production (dev debugging); prod
    // builds ship without maps to shrink the packaged payload.
    sourcemap: mode !== 'production',
    minify: false, // Don't minify in dev builds for easier debugging
    outDir: '.vite/preload',
    rollupOptions: {
      external: ['electron'],
      output: {
        entryFileNames: '[name].cjs',
      },
    },
  },
}));
