// Pure mapping helpers for the auto-updater. They take only an electron-updater
// UpdateInfo (a type-only import, erased at runtime) and primitives, so they
// carry no electron / electron-updater runtime dependency and stay unit-testable
// under plain `node --test` — unlike auto-updater.ts, which loads electron.
import type { UpdateInfo } from 'electron-updater';

/**
 * electron-updater's releaseNotes can be a plain string, an array of
 * { version, note } entries (when multiple releases are bundled into one update),
 * or null. Flatten it to a single string (or null) for the status surface.
 */
export function coerceReleaseNotes(notes: UpdateInfo['releaseNotes']): string | null {
  if (!notes) {
    return null;
  }
  if (typeof notes === 'string') {
    return notes;
  }
  return (
    notes
      .map(entry => entry.note ?? '')
      .filter(Boolean)
      .join('\n\n') || null
  );
}

/** The GitHub release page for a version (tags are v-prefixed). */
export function releasePageUrl(repoSlug: string, version: string): string {
  return `https://github.com/${repoSlug}/releases/tag/v${version}`;
}

/** The release-describing subset of AutoUpdateStatus the renderer reads. */
export interface ReleaseStatusFields {
  releaseName: string;
  releaseNotes: string | null;
  releaseDate: string | null;
  updateUrl: string;
}

/** Map an electron-updater UpdateInfo to the status fields shown to the user. */
export function mapReleaseFields(info: UpdateInfo, repoSlug: string): ReleaseStatusFields {
  return {
    releaseName: info.releaseName || info.version,
    releaseNotes: coerceReleaseNotes(info.releaseNotes),
    releaseDate: info.releaseDate ? new Date(info.releaseDate).toISOString() : null,
    updateUrl: releasePageUrl(repoSlug, info.version),
  };
}
