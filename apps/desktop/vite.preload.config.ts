import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    sourcemap: true, // Enable source maps for debugging
    minify: false, // Don't minify in dev builds for easier debugging
    outDir: '.vite/preload',
    rollupOptions: {
      external: ['electron'],
      output: {
        entryFileNames: '[name].cjs',
      },
    },
  },
});
