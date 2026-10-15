import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const website = fileURLToPath(new URL('../../', import.meta.url));
const shots = ['dashboard', 'pos', 'catalogo', 'cierre-dia', 'fiscal', 'equipo'];

test('direct image documents have a conventional favicon without a browser 404', () => {
  // The ICO wraps a 32px PNG rendered from the existing public/favicon.svg.
  // Browsers opening a WebP directly cannot read the landing's SVG icon link.
  const icon = readFileSync(path.join(website, 'public/favicon.ico'));
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt16LE(4), 1);
  assert.equal(icon.readUInt32LE(14) + icon.readUInt32LE(18), icon.length);
  assert.equal(icon.subarray(22, 30).toString('hex'), '89504e470d0a1a0a');
});

// Exercise the actual Astro component and BASE_URL replacement, not a second
// implementation of the URL helper that could pass while the gallery breaks.
for (const base of ['/', '/puntovivo', '/puntovivo/']) {
  test(`built gallery preserves assets and accessible links under ${base}`, () => {
    const output = mkdtempSync(path.join(os.tmpdir(), 'puntovivo-gallery-'));
    try {
      execFileSync(
        process.execPath,
        [path.join(website, 'node_modules/astro/bin/astro.mjs'), 'build', '--outDir', output],
        {
          cwd: website,
          env: { ...process.env, SITE_BASE_PATH: base, ASTRO_TELEMETRY_DISABLED: '1' },
          timeout: 120_000,
          stdio: 'pipe',
        }
      );

      for (const lang of ['es', 'en']) {
        const manual = JSON.parse(
          readFileSync(path.join(website, `src/content/manual/${lang}.json`), 'utf8')
        );
        const manualHtml = readFileSync(
          path.join(output, lang === 'es' ? 'docs/index.html' : 'en/docs/index.html'),
          'utf8'
        );
        assert.ok(manualHtml.includes(`<html lang="${lang}"`));
        assert.equal(
          [...manualHtml.matchAll(/<article\b[^>]*data-manual-task/g)].length,
          manual.tasks.length
        );
        assert.equal([...manualHtml.matchAll(/<h1\b/g)].length, 1);
        assert.ok(manualHtml.includes('data-manual-search hidden'));
        assert.ok(manualHtml.includes(manual.ui.title));
        for (const task of manual.tasks) {
          assert.ok(manualHtml.includes(`id="${task.id}"`));
          assert.ok(manualHtml.includes(task.title));
        }
        // Validate all same-site targets, including translation and task hashes.
        for (const [, rawHref] of manualHtml.matchAll(/href="([^"?#]*)(?:\?[^"#]*)?(#[^"]*)?"/g)) {
          if (!rawHref.startsWith('/')) continue;
          const route = rawHref.slice(base.replace(/\/$/, '').length).replace(/^\//, '');
          const target = path.join(output, route);
          assert.ok(
            existsSync(target) || existsSync(path.join(target, 'index.html')),
            `${lang}: missing ${rawHref}`
          );
        }
        for (const [, hash] of manualHtml.matchAll(/href="#([^"]+)"/g)) {
          assert.ok(manualHtml.includes(`id="${hash}"`), `${lang}: missing #${hash}`);
        }

        const locale = JSON.parse(
          readFileSync(path.join(website, `src/i18n/${lang}.json`), 'utf8')
        );
        const html = readFileSync(
          path.join(output, lang === 'es' ? 'index.html' : 'en/index.html'),
          'utf8'
        );
        const gallery = html.match(/<section\b[^>]*id="capturas"[^>]*>([\s\S]*?)<\/section>/)?.[1];
        assert.ok(gallery, `${lang} must render the gallery in the landing page`);
        assert.ok(gallery.includes(locale.shots.title));
        assert.ok(gallery.includes(locale.shots.note));
        const images = [...gallery.matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
        assert.equal(images.length, shots.length);

        for (const [index, file] of shots.entries()) {
          const src = `${base.replace(/\/$/, '')}/capturas/${file}.webp`;
          assert.ok(
            images[index].includes(`src="${src}"`),
            `${lang}: expected ${src}, got ${images[index]}`
          );
          assert.match(images[index], /width="1280" height="800"/);
          assert.ok(images[index].includes(`loading="${index === 0 ? 'eager' : 'lazy'}"`));
          assert.match(images[index], /alt="[^"]+"/);
          // Native links work with keyboard, touch, JS disabled and browser zoom.
          const link = [...gallery.matchAll(/<a\b[^>]*>/g)].find(match =>
            match[0].includes(`href="${src}"`)
          );
          assert.ok(link, `${lang}: ${file} needs a full-resolution link`);
          assert.match(link[0], /aria-label="[^"]+"/);
          assert.ok(statSync(path.join(output, 'capturas', `${file}.webp`)).size > 0);
        }
      }
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
}
