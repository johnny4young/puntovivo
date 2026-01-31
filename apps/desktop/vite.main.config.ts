import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['better-sqlite3', 'electron', 'electron-squirrel-startup'],
      output: {
        entryFileNames: '[name].cjs',
      },
    },
  },
  resolve: {
    // Some libs that can run in both Web and Node.js, such as `axios`, we need to tell Vite to build them in Node.js.
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
});
