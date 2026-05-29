import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => ({
  build: {
    // ENG-170 — sourcemaps only outside production (dev debugging); prod
    // builds ship without maps to shrink the packaged payload.
    sourcemap: mode !== 'production',
    minify: false, // Don't minify in dev builds for easier debugging
    rollupOptions: {
      external: ['better-sqlite3', 'argon2', 'electron', 'electron-squirrel-startup'],
      output: {
        entryFileNames: '[name].cjs',
      },
    },
  },
  resolve: {
    // Some libs that can run in both Web and Node.js, such as `axios`, we need to tell Vite to build them in Node.js.
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
}));
