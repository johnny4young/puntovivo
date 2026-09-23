#!/usr/bin/env node
/** Verify the built Electron main bundle can parse a PDF without node_modules. */

import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'apps/desktop/.vite/build');

function singlePagePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf));
}

const chunks = (await readdir(buildDir)).filter(name => /^pdf-[\w-]+\.cjs$/u.test(name));
assert.equal(chunks.length, 1, `Expected one built PDF.js chunk in ${buildDir}`);

const require = createRequire(import.meta.url);
const { getDocument } = require(join(buildDir, chunks[0]));
assert.equal(typeof getDocument, 'function', 'Electron PDF.js chunk must expose getDocument');

const task = getDocument({ data: singlePagePdf(), useWorkerFetch: false, stopAtErrors: true });
try {
  const document = await task.promise;
  assert.equal(document.numPages, 1);
  assert.equal((await document.getPage(1)).pageNumber, 1);
  process.stdout.write('Electron bundled PDF worker PASS — one-page fixture parsed.\n');
} finally {
  await task.destroy();
}
