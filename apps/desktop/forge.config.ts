import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: 'com.openyojob.pos',
    name: 'Open Yojob',
    executableName: 'open-yojob',
    icon: './resources/icon',
    extraResource: [
      './resources/pocketbase',
      // Include the built web app for production
      '../web/dist',
    ],
  },
  rebuildConfig: {
    force: true,
    onlyModules: ['better-sqlite3', 'argon2'],
  },
  makers: [
    new MakerSquirrel({
      name: 'OpenYojob',
      setupIcon: './resources/icon.ico',
      iconUrl:
        'https://raw.githubusercontent.com/johnny4young/open_yojob/main/apps/desktop/resources/icon.ico',
    }),
    new MakerZIP({}, ['darwin']),
    new MakerDeb({
      options: {
        maintainer: 'Open Yojob',
        homepage: 'https://github.com/johnny4young/open_yojob',
        icon: './resources/icon.png',
        categories: ['Office'],
      },
    }),
    new MakerRpm({
      options: {
        homepage: 'https://github.com/johnny4young/open_yojob',
        icon: './resources/icon.png',
        categories: ['Office'],
      },
    }),
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'johnny4young',
          name: 'open_yojob',
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
    }),
  ],
};

export default config;
