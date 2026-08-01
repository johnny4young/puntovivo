// Progressive enhancement for the latest GitHub release.
//
// The HTML already renders an honest fallback: the footer shows the neutral
// "open source · MIT" tag and the download CTA points at the repo ("build from
// source"). If the lookup finds the latest release this upgrades both
// in place — version tag, per-OS installer link, and button label. Any failure
// (no releases, rate limit, offline) leaves the rendered fallback exactly as it
// is, which is why nothing here throws.

import { RELEASES_API, RELEASES_URL, readRelease } from '../lib/release.js';
import { detectOS, pickInstaller } from '../lib/pickInstaller.js';

function applyVersion(release) {
  for (const el of document.querySelectorAll('[data-release-version]')) {
    const template = el.getAttribute('data-template');
    if (template) el.textContent = template.replace('__V__', release.version);
  }
}

function applyDownload(release) {
  const installer = pickInstaller(release.assets, detectOS());
  const href = installer || release.releaseUrl || RELEASES_URL;
  for (const el of document.querySelectorAll('[data-download-cta]')) {
    el.setAttribute('href', href);
    const label = el.querySelector('[data-download-label]');
    const releaseLabel = el.getAttribute('data-label-release');
    if (label && releaseLabel) label.textContent = releaseLabel;
    // Swap the "build from source" mark for the download arrow.
    for (const icon of el.querySelectorAll('[data-download-icon]')) {
      icon.hidden = icon.getAttribute('data-download-icon') !== 'release';
    }
  }
}

fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
  .then(response => (response.ok ? response.json() : null))
  .then(data => {
    const release = data && readRelease(data);
    if (!release) return;
    applyVersion(release);
    applyDownload(release);
  })
  .catch(() => {
    /* keep the rendered fallback on any error */
  });
