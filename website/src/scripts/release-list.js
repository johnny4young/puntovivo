// Progressive enhancement for /releases: fetch the public release list
// and replace the static GitHub fallback with an in-page list. Any
// failure (offline, rate limit, empty) leaves the fallback untouched —
// the same durability contract as scripts/release.js for the CTA.

import { RELEASES_LIST_API } from '../lib/release.js';

/** First meaningful lines of the release body, markdown stripped light. */
function summarize(body) {
  if (typeof body !== 'string') return '';
  const lines = [];
  let inComment = false;
  for (const raw of body.split('\n')) {
    let line = raw.trim();
    // Multi-line HTML comments (release tooling emits them) are skipped
    // entirely, including their interior and closing lines.
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (line.startsWith('<!--')) {
      if (!line.includes('-->')) inComment = true;
      continue;
    }
    line = line
      .replace(/^#+\s*/, '')
      .replace(/^[-*]\s+/, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .trim();
    if (line.length > 0) lines.push(line);
    if (lines.length === 4) break;
  }
  return lines.join('\n');
}

function formatDate(iso, lang) {
  const date = new Date(iso ?? '');
  // An invalid Date does not throw - it FORMATS as 'Invalid Date'.
  if (Number.isNaN(date.getTime())) {
    return typeof iso === 'string' ? iso.slice(0, 10) : '';
  }
  return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function render(container, releases) {
  const template = container.dataset.publishedTemplate || '__D__';
  const viewLabel = container.dataset.viewLabel || 'GitHub';
  const lang = container.dataset.lang || 'es';

  const fragment = document.createDocumentFragment();
  for (const release of releases) {
    const item = document.createElement('article');
    item.className = 'pv-card rl-item';

    const title = document.createElement('h3');
    title.textContent = release.name && release.name.trim() ? release.name : release.tag_name;
    item.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = template.replace('__D__', formatDate(release.published_at, lang));
    item.appendChild(meta);

    const summary = summarize(release.body);
    if (summary) {
      const notes = document.createElement('p');
      notes.className = 'notes';
      notes.textContent = summary;
      item.appendChild(notes);
    }

    const link = document.createElement('a');
    link.href = release.html_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = viewLabel;
    item.appendChild(link);

    fragment.appendChild(item);
  }
  const fallback = container.querySelector('[data-release-fallback]');
  fallback?.remove();
  container.appendChild(fragment);
}

const container = document.getElementById('release-list');
if (container) {
  fetch(RELEASES_LIST_API, { headers: { Accept: 'application/vnd.github+json' } })
    .then(response => (response.ok ? response.json() : Promise.reject(new Error('http'))))
    .then(releases => {
      const published = Array.isArray(releases)
        ? releases.filter(release => !release.draft && release.tag_name)
        : [];
      if (published.length === 0) throw new Error('empty');
      render(container, published);
    })
    .catch(() => {
      // The neutral GitHub fallback simply stands.
    });
}
