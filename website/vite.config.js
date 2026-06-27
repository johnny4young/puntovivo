import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project site: https://johnny4young.github.io/puntovivo/
// `base` must match the repo name so asset URLs resolve under the subpath.
export default defineConfig({
  base: '/puntovivo/',
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
