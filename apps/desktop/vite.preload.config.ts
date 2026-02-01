import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    outDir: '.vite/preload',
    rollupOptions: {
      external: ['electron'],
      output: {
        entryFileNames: '[name].cjs',
      },
    },
  },
});
