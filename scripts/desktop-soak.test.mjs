import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  evaluateSoak,
  memorySlopes,
  parseSoakArgs,
  planCrashes,
  renderSoakReport,
  slopePerHour,
} from './desktop-soak.mjs';

const HOUR = 3_600_000;
const budget = { maxStallMs: 100 };
const cleanBooks = {
  inDb: 3,
  missing: 0,
  extra: 0,
  duplicateNumbers: 0,
  fiscalEnabled: true,
  salesWithoutFiscal: 0,
  duplicateConsecutives: 0,
};
const sample = (at, mb, extra = {}) => ({
  at,
  mainMaxStallMs: 10,
  backupRunning: false,
  processes: [{ type: 'Browser', workingSetMb: mb }],
  ...extra,
});

test('profiles: the short run crashes twice in 20 minutes, the long one once an hour', () => {
  assert.deepEqual(
    (({ minutes, crashes, saleEveryMs, backupEveryMin }) => ({
      minutes,
      crashes,
      saleEveryMs,
      backupEveryMin,
    }))(parseSoakArgs([])),
    { minutes: 20, crashes: 2, saleEveryMs: 5_000, backupEveryMin: 5 }
  );
  const long = parseSoakArgs(['--profile=long']);
  assert.equal(long.minutes, 480);
  assert.equal(long.crashes, 8);
  assert.equal(parseSoakArgs(['--minutes=60']).crashes, 6);
  assert.equal(parseSoakArgs(['--out=C:\\runs\\a']).out, 'C:\\runs\\a');
  assert.throws(() => parseSoakArgs(['--profile=forever']), /unknown soak profile/);
});

test('crashes are spread inside the run', () => {
  assert.deepEqual(planCrashes(1_200_000, 2), [400_000, 800_000]);
});

test('slope is the least-squares growth per hour', () => {
  assert.equal(slopePerHour([{ hours: 0, value: 100 }]), 0);
  assert.equal(
    slopePerHour([
      { hours: 0, value: 100 },
      { hours: 1, value: 104 },
      { hours: 2, value: 108 },
    ]),
    4
  );
  assert.deepEqual(memorySlopes([sample(0, 300), sample(HOUR, 310)]), { Browser: 10 });
});

test('a clean run passes every criterion', () => {
  const verdict = evaluateSoak({
    run: {
      confirmed: [{}, {}, {}],
      crashes: [{ recoveryMs: 2_000 }, { recoveryMs: 3_000 }],
      backups: [{ ok: true, mainMaxStallMs: 40 }],
      auditValid: true,
    },
    books: cleanBooks,
    samples: [sample(0, 300), sample(60_000, 300, { backupRunning: true, mainMaxStallMs: 40 })],
    budget,
    crashLog: [{ outcome: 'restarted' }, { outcome: 'restarted' }],
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.rows));
  assert.match(
    renderSoakReport({
      ...verdict,
      profile: 'short',
      minutes: 20,
      platform: 'win32',
      sales: 3,
      saleP50Ms: 1,
      saleP95Ms: 2,
      retriedSales: 1,
    }),
    /Desktop soak PASS/
  );
});

test('duplicates, slow recovery, stalls and leaks each fail the run', () => {
  const verdict = evaluateSoak({
    run: {
      confirmed: [{}],
      crashes: [{ recoveryMs: 12_000 }],
      backups: [{ ok: false, mainMaxStallMs: 400 }],
      auditValid: false,
    },
    books: { ...cleanBooks, extra: 1, duplicateNumbers: 1, duplicateConsecutives: 1 },
    samples: [sample(0, 300), sample(3 * HOUR, 360, { backupRunning: true, mainMaxStallMs: 400 })],
    budget,
    crashLog: [],
  });
  const failed = verdict.rows.filter(row => !row.ok).map(row => row.name);
  assert.deepEqual(failed, [
    'confirmed sales are in the database once',
    'no repeated sale numbers',
    'no repeated fiscal consecutives',
    'audit chain verifies',
    'restarts equal injected crashes',
    'each recovery under 10 s',
    'main stays responsive during backups',
    'backups succeed',
    'memory slope under 5 MB/h per process type',
  ]);
});
