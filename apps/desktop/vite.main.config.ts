import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => ({
  build: {
    // sourcemaps only outside production (dev debugging); prod
    // builds ship without maps to shrink the packaged payload.
    sourcemap: mode !== 'production',
    minify: false, // Don't minify in dev builds for easier debugging
    rollupOptions: {
      // electron-updater is externalized (not bundled): it lazy-requires its
      // provider modules + reads app-update.yml at runtime, which a bundler can
      // break. It ships via electron-builder's production-dependency collection
      // into app.asar/node_modules, alongside the native addons.
      external: [
        'better-sqlite3',
        'argon2',
        'electron',
        'electron-squirrel-startup',
        'electron-updater',
      ],
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
