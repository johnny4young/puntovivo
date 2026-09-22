import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNoGlobalDiagnostics,
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
