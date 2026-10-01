import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNoGlobalDiagnostics,
  assertValidBaseline,
  buildBaseline,
  compareBaseline,
  parseDiagnostics,
} from './check-test-types.mjs';

test('parses primary diagnostics and ignores continuation text', () => {
  const diagnostics = parseDiagnostics(
    [
      'src/example.test.ts(10,2): error TS2322: Type mismatch.',
      "  Type 'string' is not assignable to type 'number'.",
      'src/example.test.ts(20,4): error TS2322: Another mismatch.',
      'C:\\repo\\windows.test.ts(1,1): error TS7006: Implicit any.',
    ].join('\n')
  );

  assert.deepEqual(Object.fromEntries(diagnostics), {
    'src/example.test.ts|TS2322': 2,
    'C:/repo/windows.test.ts|TS7006': 1,
  });
});

test('rejects a global diagnostic even beside known located debt', () => {
  const output = [
    'src/example.test.ts(10,2): error TS2322: Type mismatch.',
    "error TS2688: Cannot find type definition file for 'missing'.",
  ].join('\n');

  assert.throws(
    () => assertNoGlobalDiagnostics(output),
    /unbaselineable global diagnostics:[\s\S]*TS2688/
  );
});

test('builds a deterministic baseline sorted by file and code', () => {
  const baseline = buildBaseline(
    '7.0.2',
    new Map([
      ['src/z.test.ts|TS7006', 1],
      ['src/a.test.ts|TS2322', 2],
    ])
  );

  assert.deepEqual(baseline, {
    schemaVersion: 1,
    compilerVersion: '7.0.2',
    config: 'tsconfig.tests.json',
    total: 3,
    byFileAndCode: {
      'src/a.test.ts|TS2322': 2,
      'src/z.test.ts|TS7006': 1,
    },
  });
});

test('accepts an exact per-file and diagnostic-code match', () => {
  const result = compareBaseline(
    { byFileAndCode: { 'src/example.test.ts|TS2322': 2 } },
    new Map([['src/example.test.ts|TS2322', 2]])
  );

  assert.deepEqual(result, { regressions: [], improvements: [] });
});

test('rejects new and increased diagnostics', () => {
  const result = compareBaseline(
    { byFileAndCode: { 'src/example.test.ts|TS2322': 1 } },
    new Map([
      ['src/example.test.ts|TS2322', 2],
      ['src/new.test.ts|TS7006', 1],
    ])
  );

  assert.deepEqual(result.regressions, [
    'src/example.test.ts|TS2322: 1 -> 2',
    'src/new.test.ts|TS7006: 0 -> 1',
  ]);
  assert.deepEqual(result.improvements, []);
});

test('rejects a stale baseline after diagnostics are resolved', () => {
  const result = compareBaseline(
    {
      byFileAndCode: {
        'src/example.test.ts|TS2322': 2,
        'src/resolved.test.ts|TS7006': 1,
      },
    },
    new Map([['src/example.test.ts|TS2322', 1]])
  );

  assert.deepEqual(result.regressions, []);
  assert.deepEqual(result.improvements, [
    'src/example.test.ts|TS2322: 2 -> 1',
    'src/resolved.test.ts|TS7006: 1 -> 0',
  ]);
});

test('accepts a valid baseline including the debt-free empty snapshot', () => {
  assert.doesNotThrow(() => assertValidBaseline(buildBaseline('7.0.2', new Map())));
  assert.doesNotThrow(() =>
    assertValidBaseline(buildBaseline('7.0.2', new Map([['src/example.test.ts|TS2322', 1]])))
  );
});

test('rejects malformed baseline metadata', () => {
  const valid = buildBaseline('7.0.2', new Map());
  for (const invalid of [
    null,
    [],
    {},
    { ...valid, schemaVersion: 2 },
    { ...valid, config: 'tsconfig.json' },
    { ...valid, compilerVersion: '' },
    { ...valid, compilerVersion: 7 },
    { ...valid, total: '0' },
    { ...valid, total: -1 },
    { ...valid, total: 0.5 },
    { ...valid, byFileAndCode: null },
    { ...valid, byFileAndCode: [] },
  ]) {
    assert.throws(() => assertValidBaseline(invalid), /Invalid test type baseline metadata/);
  }
});

test('rejects counter values that would coerce or disappear in numeric comparisons', () => {
  for (const count of ['invalid', '1', null, true, -1, 0, 0.5, NaN, Infinity]) {
    const baseline = buildBaseline('7.0.2', new Map([['src/example.test.ts|TS2322', 1]]));
    baseline.byFileAndCode['src/example.test.ts|TS2322'] = count;
    assert.throws(() => assertValidBaseline(baseline), /Invalid test type baseline counter/);
  }
});

test('rejects malformed counter keys and inconsistent totals', () => {
  for (const key of ['', '|TS2322', 'src/example.test.ts', 'src/example.test.ts|oops']) {
    assert.throws(
      () => assertValidBaseline(buildBaseline('7.0.2', new Map([[key, 1]]))),
      /Invalid test type baseline counter/
    );
  }
  const baseline = buildBaseline('7.0.2', new Map([['src/example.test.ts|TS2322', 1]]));
  baseline.total = 2;
  assert.throws(() => assertValidBaseline(baseline), /total does not match its counters/);
});
