import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => ({
  // The output is CommonJS, so preserve the standard ESM module URL with the
  // equivalent Node value instead of allowing import.meta to degrade to {}.
  define: {
    'import.meta.url': 'require("node:url").pathToFileURL(__filename).href',
  },
  build: {
    // sourcemaps only outside production (dev debugging); prod
    // builds ship without maps to shrink the packaged payload.
    sourcemap: mode !== 'production',
    minify: false, // Don't minify in dev builds for easier debugging
    // Forge's library build otherwise defaults Rolldown to the neutral
    // platform. The embedded server and Sentry contain Node-only module paths,
    // so make the main-process runtime explicit as well as defining its URL.
    rolldownOptions: {
      platform: 'node',
      // electron-updater is externalized (not bundled): it lazy-requires its
      // provider modules + reads app-update.yml at runtime, which a bundler can
      // break. It ships via electron-builder's production-dependency collection
      // into app.asar/node_modules, alongside the native addons.
      external: ['better-sqlite3', 'argon2', 'electron', 'electron-updater'],
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
