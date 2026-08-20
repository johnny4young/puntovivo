/**
 * electron-builder afterPack entry for the desktop workspace.
 *
 * The real implementation lives at the repo root (scripts/
 * prune-native-prebuilds.mjs) beside its tests and the other packaging
 * scripts. This wrapper exists because electron-builder validates that a
 * relative hook path resolves inside its detected workspace root, and that
 * detection is platform-dependent: on macOS and Linux it finds the monorepo
 * root (so ../../scripts/ passes), but on Windows it falls back to the
 * project directory (apps/desktop) and rejects any path above it. A module
 * INSIDE the project dir passes the check everywhere, and its own import of
 * the root script is ordinary ESM resolution the check never sees.
 */
export { default } from '../../../scripts/prune-native-prebuilds.mjs';
