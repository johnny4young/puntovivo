import assert from 'node:assert/strict';
import test from 'node:test';
import { formatGhFailure, getGhOutputText } from './github-cli-utils.mjs';

// ── getGhOutputText ──────────────────────────────────────────────────────────

test('getGhOutputText returns an empty string when both fields are null', () => {
  assert.equal(getGhOutputText({ stdout: null, stderr: null }), '');
});

test('getGhOutputText returns an empty string when both fields are undefined', () => {
  assert.equal(getGhOutputText({}), '');
});

test('getGhOutputText returns stdout when only stdout is present', () => {
  assert.equal(getGhOutputText({ stdout: 'release created', stderr: null }), 'release created');
});

test('getGhOutputText returns stderr when only stderr is present', () => {
  assert.equal(getGhOutputText({ stdout: null, stderr: 'authentication failed' }), 'authentication failed');
});

test('getGhOutputText joins stdout and stderr with a newline when both are present', () => {
  assert.equal(
    getGhOutputText({ stdout: 'created release', stderr: 'warning: draft' }),
    'created release\nwarning: draft'
  );
});

test('getGhOutputText trims surrounding whitespace from each field', () => {
  assert.equal(
    getGhOutputText({ stdout: '  release url  ', stderr: '  warning  ' }),
    'release url\nwarning'
  );
});

test('getGhOutputText converts Buffer values to strings', () => {
  assert.equal(
    getGhOutputText({ stdout: Buffer.from('from buffer'), stderr: null }),
    'from buffer'
  );
});

test('getGhOutputText ignores fields that are empty after trimming', () => {
  assert.equal(getGhOutputText({ stdout: '   ', stderr: 'error detail' }), 'error detail');
});

test('getGhOutputText returns the error message when only the error field is set', () => {
  assert.equal(
    getGhOutputText({ stdout: null, stderr: null, error: new Error('spawn gh ENOENT') }),
    'spawn gh ENOENT'
  );
});

test('getGhOutputText combines stderr and error message when both are present', () => {
  assert.equal(
    getGhOutputText({ stdout: null, stderr: 'pipe broken', error: new Error('spawn gh EPERM') }),
    'pipe broken\nspawn gh EPERM'
  );
});

test('getGhOutputText handles a null error field gracefully', () => {
  assert.equal(getGhOutputText({ stdout: null, stderr: null, error: null }), '');
});

// ── formatGhFailure ──────────────────────────────────────────────────────────

test('formatGhFailure returns context with a trailing period when output is empty', () => {
  assert.equal(
    formatGhFailure('Failed to create release', { stdout: null, stderr: null }),
    'Failed to create release.'
  );
});

test('formatGhFailure appends gh output after a colon when output is present', () => {
  assert.equal(
    formatGhFailure('Failed to create release', { stdout: null, stderr: 'permission denied' }),
    'Failed to create release: permission denied'
  );
});

test('formatGhFailure includes multi-line output verbatim', () => {
  assert.equal(
    formatGhFailure('Upload failed', { stdout: 'line one', stderr: 'line two' }),
    'Upload failed: line one\nline two'
  );
});
