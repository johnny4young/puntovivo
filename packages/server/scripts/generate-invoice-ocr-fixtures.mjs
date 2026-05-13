/**
 * ENG-040d — Render the OCR benchmark HTML fixtures to PNG.
 *
 * Idempotent helper for re-generating the rendered PNGs that live next
 * to each `NN-<slug>.html` template in
 * `packages/server/__fixtures__/invoice-ocr/`. Run after any template
 * change:
 *
 *   node packages/server/scripts/generate-invoice-ocr-fixtures.mjs
 *
 * Uses the workspace-root `playwright` package (already in devDeps for
 * E2E). Each PNG renders the full body element at the natural viewport
 * size the template defines.
 */
import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, basename, extname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '__fixtures__', 'invoice-ocr');

async function main() {
  const htmlFiles = readdirSync(fixturesDir)
    .filter((entry) => extname(entry) === '.html')
    .sort();

  if (htmlFiles.length === 0) {
    console.error(`No HTML fixtures under ${fixturesDir}`);
    process.exit(1);
  }

  console.log(`Rendering ${htmlFiles.length} fixtures from ${fixturesDir}`);

  const browser = await chromium.launch();
  try {
    for (const htmlFile of htmlFiles) {
      const absHtml = join(fixturesDir, htmlFile);
      const pngName = `${basename(htmlFile, '.html')}.png`;
      const absPng = join(fixturesDir, pngName);

      const context = await browser.newContext({
        viewport: { width: 720, height: 1280 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      await page.goto(pathToFileURL(absHtml).href, { waitUntil: 'load' });
      const body = await page.$('body');
      if (!body) {
        await context.close();
        console.error(`No body element in ${htmlFile}; skipping`);
        continue;
      }
      await body.screenshot({ path: absPng, type: 'png' });
      await context.close();
      console.log(`  rendered ${pngName}`);
    }
  } finally {
    await browser.close();
  }
}

await main();
