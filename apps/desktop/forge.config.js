// Minimal electron-forge config. Forge is retained ONLY for the desktop dev loop
// (`electron-forge start`), which uses plugin-vite to build the main + preload
// bundles and launch Electron. Production packaging, signing, fuses, and the
// native-module closure all moved to electron-builder
// (apps/desktop/electron-builder.yml) — the makers, packager hooks, FusesPlugin,
// and the prebuild SHASUMS workaround that forge needed for packaging are gone.
//
// Kept as .js (not .ts) because electron-forge resolves forge.config.js with a
// native dynamic import, whereas a .ts config loads through jiti and yields an
// empty config on the CI runners.
import { VitePlugin } from '@electron-forge/plugin-vite';

const config = {
  plugins: [
    new VitePlugin({
      build: [
        {
          // `entry` is an alias for `build.lib.entry` in the corresponding config.
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      // No renderer config — the app loads the web app (apps/web) instead.
      renderer: [],
    }),
  ],
};

export default config;
