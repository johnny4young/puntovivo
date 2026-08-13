import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

export function detectLinuxLibc(report = process.report) {
  return report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl';
}

export function getPackagedPrebuildName({
  platform = process.platform,
  arch = process.arch,
  libc = platform === 'linux' ? detectLinuxLibc() : null,
} = {}) {
  if (!['darwin', 'linux', 'win32'].includes(platform)) {
    throw new Error(`Unsupported packaged SQLite platform: ${platform}`);
  }
  if (!['arm64', 'x64'].includes(arch)) {
    throw new Error(`Unsupported packaged SQLite architecture: ${arch}`);
  }
  const platformKey = platform === 'linux' && libc === 'musl' ? 'linuxmusl' : platform;
  return `${platformKey}-${arch}.node`;
}

export function getElectronBuilderArch(arch) {
  // builder-util's public Arch enum: x64=1, arm64=3. Use the packaging target
  // rather than process.arch so an arm64 host can produce a valid x64 app (and
  // vice versa) without retaining the host's unusable addon.
  if (arch === 1) return 'x64';
  if (arch === 3) return 'arm64';
  throw new Error(`Unsupported electron-builder SQLite architecture: ${String(arch)}`);
}

export async function pruneNativePrebuilds(prebuildDir, targetName) {
  const entries = await readdir(prebuildDir, { withFileTypes: true });
  const binaries = entries.filter(entry => entry.isFile() && entry.name.endsWith('.node'));
  if (!binaries.some(entry => entry.name === targetName)) {
    throw new Error(`Packaged SQLite prebuild ${targetName} is missing from ${prebuildDir}`);
  }

  await Promise.all(
    binaries
      .filter(entry => entry.name !== targetName)
      .map(entry => rm(path.join(prebuildDir, entry.name)))
  );
  return { kept: targetName, removed: binaries.length - 1 };
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== process.platform) {
    throw new Error(
      `Cross-platform packaging is unsupported for native pruning: host=${process.platform}, target=${context.electronPlatformName}`
    );
  }

  const resourcesDir =
    process.platform === 'darwin'
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources'
        )
      : path.join(context.appOutDir, 'resources');
  const prebuildDir = path.join(
    resourcesDir,
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'prebuilds'
  );
  const result = await pruneNativePrebuilds(
    prebuildDir,
    getPackagedPrebuildName({
      platform: context.electronPlatformName,
      arch: getElectronBuilderArch(context.arch),
    })
  );
  console.log(
    `[native-package] kept ${result.kept}; removed ${result.removed} non-target SQLite prebuilds`
  );
}
