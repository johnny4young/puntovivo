#!/usr/bin/env node
/**
 * Builds the Electron main + preload Vite artefacts without launching
 * Electron or packaging the app.
 *
 * Electron Forge owns the exact Vite config shape through
 * @electron-forge/plugin-vite. Calling `vite build --config ...`
 * directly misses the Forge-injected entry points and can build the
 * wrong target. This script reuses Forge's config generator so the E2E
 * smoke gets the same `.vite/build` and `.vite/preload` output that
 * `electron-forge start/package` would produce.
 *
 * @module scripts/build-electron-main
 */

import ViteConfigGeneratorModule from '@electron-forge/plugin-vite/dist/ViteConfig.js';
import { build } from 'vite';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ViteConfigGenerator =
  ViteConfigGeneratorModule.default ?? ViteConfigGeneratorModule;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const desktopRoot = resolve(repoRoot, 'apps/desktop');
const migrationsSource = resolve(repoRoot, 'packages/server/src/db/migrations');
const migrationsOutput = resolve(desktopRoot, '.vite/build/migrations');

const pluginConfig = {
  build: [
    {
      entry: 'src/main/index.ts',
      config: resolve(desktopRoot, 'vite.main.config.ts'),
      target: 'main',
    },
    {
      entry: 'src/preload/index.ts',
      config: resolve(desktopRoot, 'vite.preload.config.ts'),
      target: 'preload',
    },
  ],
  renderer: [],
};

function describeTarget(config) {
  const buildConfig = config.build ?? {};
  const input = buildConfig.rollupOptions?.input;
  const lib = typeof buildConfig.lib === 'object' ? buildConfig.lib : undefined;
  return String(input ?? lib?.entry ?? buildConfig.outDir ?? 'unknown');
}

const generator = new ViteConfigGenerator(pluginConfig, desktopRoot, true);
const buildConfigs = await generator.getBuildConfigs();

for (const config of buildConfigs) {
  const target = describeTarget(config);
  process.stdout.write(
    `[electron-main-build] Building ${relative(desktopRoot, target)}\n`
  );
  await build({
    configFile: false,
    logLevel: process.env.CI ? 'info' : 'warn',
    ...config,
    clearScreen: false,
  });
}

await rm(migrationsOutput, { recursive: true, force: true });
await mkdir(dirname(migrationsOutput), { recursive: true });
await cp(migrationsSource, migrationsOutput, { recursive: true });
process.stdout.write(
  `[electron-main-build] Copied ${relative(repoRoot, migrationsSource)} -> ${relative(repoRoot, migrationsOutput)}\n`
);
