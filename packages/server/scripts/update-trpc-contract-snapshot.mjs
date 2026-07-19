import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appRouter } from '../dist/trpc/router.js';
import { buildTrpcContractManifest } from '../dist/trpc/contract-manifest.js';

const snapshotUrl = new URL(
  '../src/__tests__/fixtures/trpc-contract.snapshot.json',
  import.meta.url
);
const snapshotPath = fileURLToPath(snapshotUrl);
const manifest = buildTrpcContractManifest(appRouter);

mkdirSync(fileURLToPath(new URL('../src/__tests__/fixtures/', import.meta.url)), {
  recursive: true,
});
writeFileSync(snapshotPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${manifest.length} tRPC procedures to ${snapshotPath}`);
