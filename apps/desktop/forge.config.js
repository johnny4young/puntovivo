// Plain JS (ESM) Forge config. electron-forge resolves forge.config.js BEFORE
// forge.config.ts and loads it with a native dynamic import, whereas it loads a
// .ts config through jiti — which yields an empty config (zero makers, no
// installers) on the CI runners while working locally. Keeping this as .js makes
// `electron-forge make` resolve the makers identically everywhere. Edit this
// file (not a .ts) for desktop packaging changes.
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config = {
  packagerConfig: {
    asar: true,
    appBundleId: 'com.puntovivo.pos',
    name: 'Puntovivo',
    executableName: 'puntovivo',
    // CI feeds @electron/packager the COMPLETE electron zip through this dir so it
    // skips @electron/get — whose download arrives truncated on the GitHub runners,
    // leaving the packaged app empty and the makers with nothing to zip. The
    // workflow sets ELECTRON_ZIP_DIR after fetching the zip with curl --retry.
    // Unset locally => undefined => packager downloads normally.
    electronZipDir: process.env.ELECTRON_ZIP_DIR,
    extraResource: [
      // Include the built web app for production
      '../web/dist',
      // ENG-002 step 2 — ship the generated Drizzle migrations alongside
      // the bundle so the embedded server can run drizzleMigrate() in
      // packaged builds. `prepare:server` copies src/db/migrations into
      // packages/server/dist/db/migrations before Forge runs. Forge
      // copies this folder verbatim into process.resourcesPath/migrations.
      '../../packages/server/dist/db/migrations',
    ],
  },
  rebuildConfig: {
    force: true,
    onlyModules: ['better-sqlite3', 'argon2'],
  },
  // CI-portable build: only MakerZIP. The squirrel/deb/rpm makers pull
  // undeclared transitive deps that pnpm does not hoist on a clean CI install,
  // so they fail to load there (they work locally). A zip of the packaged app is
  // a working portable build for all three OS; native installers can return once
  // the maker-dep hoisting is solved.
  makers: [new MakerZIP({}, ['darwin', 'linux', 'win32'])],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'johnny4young',
          name: 'puntovivo',
        },
        prerelease: false,
        draft: true,
      },
    },
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
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
      // No renderer config - we use the web app (apps/web) instead
      renderer: [],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      // ENG-072 — renderer runs sandboxed (window-config.ts) and we never
      // load file:// content into the BrowserWindow, so the extra privileges
      // historically granted to the file: protocol are dead weight. Drop them.
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
      // ENG-072 — new in @electron/fuses 2.1.0 + Electron 42. Enables V8 WASM
      // trap handlers (faster bounds-check elimination via signal-based traps
      // instead of explicit branches). Speeds up any WASM dependency the
      // renderer pulls in (notably jspdf + exceljs).
      [FuseV1Options.WasmTrapHandlers]: true,
    }),
  ],
};

export default config;
