/** committed tRPC procedure contract snapshot. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appRouter } from '../trpc/router.js';
import {
  buildTrpcContractManifest,
  diffTrpcContract,
  formatTrpcContractDiff,
  type TrpcContractEntry,
} from '../trpc/contract-manifest.js';

const snapshotUrl = new URL('./fixtures/trpc-contract.snapshot.json', import.meta.url);

function readSnapshot(): TrpcContractEntry[] {
  return JSON.parse(readFileSync(snapshotUrl, 'utf8')) as TrpcContractEntry[];
}

describe('tRPC contract snapshot', () => {
  it('matches every public procedure path, kind, and parser summary', () => {
    const expected = readSnapshot();
    const actual = buildTrpcContractManifest(appRouter);
    const diff = diffTrpcContract(expected, actual);

    if (diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0) {
      throw new Error(formatTrpcContractDiff(diff));
    }

    expect(actual).toEqual(expected);
  });

  it('reports removed and changed procedures by path', () => {
    const baseline: TrpcContractEntry[] = [
      { path: 'health.check', kind: 'query', input: 'void', output: 'inferred' },
      { path: 'sales.create', kind: 'mutation', input: 'object{}', output: 'inferred' },
    ];
    const next: TrpcContractEntry[] = [
      { path: 'sales.create', kind: 'mutation', input: 'object{id:string}', output: 'inferred' },
    ];

    const message = formatTrpcContractDiff(diffTrpcContract(baseline, next));
    expect(message).toContain('Removed: health.check');
    expect(message).toContain('Changed: sales.create');
  });
});
