/**
 * `db/native-binding` — pins the cache-key replication contract against
 * `scripts/ensure-native-runtime.mjs` (sanitizer + node key assembly) and the
 * resolver's fail-open behavior. If the script ever changes its key shape,
 * the worst case is a cache MISS (resolver returns undefined → better-sqlite3
 * default lookup), but these pins make the drift loud instead of silent.
 */

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  buildNodeRuntimeKey,
  resolveCachedNodeBinding,
  sanitizeRuntimeKey,
} from '../db/native-binding.js';

describe('sanitizeRuntimeKey (mirror of ensure-native-runtime.mjs)', () => {
  it('collapses runs of disallowed characters into one underscore', () => {
    expect(
      sanitizeRuntimeKey('node:v24.15.0:137:darwin:arm64:better-sqlite3-multiple-ciphers@12.11.1')
    ).toBe('node_v24.15.0_137_darwin_arm64_better-sqlite3-multiple-ciphers_12.11.1');
    // `:^` is ONE run → one underscore (electron_42.6.2, not electron__42.6.2).
    expect(sanitizeRuntimeKey('electron:^42.6.2:darwin:arm64:pkg@1.0.0')).toBe(
      'electron_42.6.2_darwin_arm64_pkg_1.0.0'
    );
  });

  it('preserves dots, dashes and underscores', () => {
    expect(sanitizeRuntimeKey('a.b-c_d')).toBe('a.b-c_d');
  });
});

describe('buildNodeRuntimeKey', () => {
  it('assembles the exact colon-joined shape getDesiredKey(node) produces', () => {
    expect(
      buildNodeRuntimeKey({
        nodeVersion: 'v24.15.0',
        modulesAbi: '137',
        platform: 'darwin',
        arch: 'arm64',
        addonNameAndVersion: 'better-sqlite3-multiple-ciphers@12.11.1',
      })
    ).toBe('node:v24.15.0:137:darwin:arm64:better-sqlite3-multiple-ciphers@12.11.1');
  });
});

describe('resolveCachedNodeBinding', () => {
  it('returns undefined or an existing .node path with the expected name', () => {
    const resolved = resolveCachedNodeBinding();
    if (resolved === undefined) {
      // Fresh clone before any ensure-native-runtime run: fail-open is the
      // contract (better-sqlite3 falls back to its default lookup).
      return;
    }
    expect(resolved.endsWith('.node')).toBe(true);
    expect(resolved).toContain('native-binaries');
    expect(resolved).toContain(`node_${process.version}_${process.versions.modules}`);
    expect(existsSync(resolved)).toBe(true);
  });

  it('the resolved artifact actually loads under the current Node ABI', () => {
    const resolved = resolveCachedNodeBinding();
    if (resolved === undefined) {
      return;
    }
    // The whole point: this must dlopen cleanly under Node regardless of
    // which ABI the swapped default copy currently carries.
    const probe = new Database(':memory:', { nativeBinding: resolved });
    try {
      expect(probe.prepare('select 1 as ok').get()).toEqual({ ok: 1 });
    } finally {
      probe.close();
    }
  });
});
