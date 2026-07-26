/**
 * Locate the launchable executable inside a packaged desktop build.
 *
 * Shared by the packaged smoke (`scripts/run-desktop-smoke.mjs`) and the
 * packaged Electron E2E fixture, because the per-platform layout is fiddly and
 * two copies of it would drift the first time a packager changes its output
 * shape — and the failure mode is a smoke that silently tests nothing.
 *
 * @module scripts/lib/packaged-binary
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** Basename electron-builder gives the executable on every platform. */
export const EXECUTABLE = 'puntovivo';

/**
 * Breadth-first search under `root`, bounded in depth so a wrong argument
 * cannot walk an entire disk. Never descends into a .app bundle: on macOS the
 * bundle is the match, not a directory to search through.
 */
export function findUnder(root, match, wantFile = false) {
  const queue = [root];
  let depth = 0;
  while (queue.length && depth < 6) {
    const next = [];
    for (const dir of queue) {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const isDir = e.isDirectory();
        if (match(e.name) && (wantFile ? e.isFile() : isDir)) return full;
        if (isDir && !e.name.endsWith('.app')) next.push(full);
      }
    }
    queue.length = 0;
    queue.push(...next);
    depth += 1;
  }
  return null;
}

/**
 * Locate the macOS .app bundle inside a packaging output directory, or confirm
 * that `input` already is one. Returns null off macOS and when no bundle is
 * present, because callers treat a missing bundle as "nothing to assess"
 * rather than an error.
 *
 * @param {string} input path to a packaged build
 * @param {NodeJS.Platform} [platform] override, for tests
 * @returns {string|null} absolute path to the .app bundle
 */
export function resolvePackagedAppBundle(input, platform = process.platform) {
  if (platform !== 'darwin' || !existsSync(input)) return null;
  if (input.endsWith('.app')) return input;
  return findUnder(input, n => n.endsWith('.app') && /puntovivo/i.test(n));
}

/**
 * Resolve the executable for `input`, which may be a packaging output
 * directory, a macOS .app bundle, or the executable itself.
 *
 * Throws with the searched path rather than returning null: every caller
 * treats "not found" as fatal, and the path is the whole diagnostic.
 *
 * @param {string} input path to a packaged build
 * @param {NodeJS.Platform} [platform] override, for tests
 * @returns {string} absolute path to the launchable binary
 */
export function resolvePackagedBinary(input, platform = process.platform) {
  if (!existsSync(input)) {
    throw new Error(`packaged build path does not exist: ${input}`);
  }

  // macOS: a .app bundle (directly, or found under input). Forge names it
  // Puntovivo.app, electron-builder puntovivo.app, so match any .app carrying
  // our executable.
  if (platform === 'darwin') {
    const app = input.endsWith('.app')
      ? input
      : findUnder(input, n => n.endsWith('.app') && /puntovivo/i.test(n));
    if (app) {
      const bin = path.join(app, 'Contents', 'MacOS', EXECUTABLE);
      if (existsSync(bin)) return bin;
    }
    throw new Error(`no *.app with Contents/MacOS/${EXECUTABLE} under ${input}`);
  }

  // Linux / Windows: the executable inside the packaged directory.
  const exe = platform === 'win32' ? `${EXECUTABLE}.exe` : EXECUTABLE;
  if (statSync(input).isFile() && path.basename(input) === exe) return input;
  const found = findUnder(input, n => n === exe, /* wantFile */ true);
  if (found) return found;
  throw new Error(`no ${exe} executable under ${input}`);
}
