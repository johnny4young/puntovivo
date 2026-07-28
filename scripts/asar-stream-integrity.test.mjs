import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { createPackageFromStreams, extractFile, getRawHeader } from '@electron/asar';

test('@electron/asar hashes the stream bytes written for transformed entries', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'puntovivo-asar-integrity-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));

  const archive = join(scratch, 'app.asar');
  const payload = Buffer.from('{"transformed":true}\n');

  // package.json deliberately exists in the test process cwd with different
  // bytes. createPackageFromStreams must hash the supplied stream, not that
  // same-named filesystem entry.
  await createPackageFromStreams(archive, [
    {
      path: 'package.json',
      type: 'file',
      unpacked: false,
      stat: { mode: 0o644, size: payload.length },
      streamGenerator: () => Readable.from(payload),
    },
  ]);

  const entry = getRawHeader(archive).header.files['package.json'];
  const extracted = extractFile(archive, 'package.json');
  const actualHash = createHash('sha256').update(extracted).digest('hex');

  assert.deepEqual(extracted, payload);
  assert.equal(entry.integrity.hash, actualHash);
  assert.deepEqual(entry.integrity.blocks, [actualHash]);
});
