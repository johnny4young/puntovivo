import assert from 'node:assert/strict';
import test from 'node:test';
import { formatGhFailure, getGhOutputText, isMissingReleaseLookup } from './github-cli-utils.mjs';

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

// ── isMissingReleaseLookup ───────────────────────────────────────────────────

test('isMissingReleaseLookup returns false when status is 0 regardless of output', () => {
  assert.equal(
    isMissingReleaseLookup({ status: 0, stdout: 'release not found', stderr: null }),
    false
  );
});

test('isMissingReleaseLookup returns true for "release not found" in stderr', () => {
  assert.equal(
    isMissingReleaseLookup({ status: 1, stdout: '', stderr: 'release not found' }),
    true
  );
});

test('isMissingReleaseLookup returns true for "release not found" in stdout', () => {
  assert.equal(
    isMissingReleaseLookup({ status: 1, stdout: 'release not found', stderr: null }),
    true
  );
});

test('isMissingReleaseLookup returns true for versioned "release v1.2.3 not found"', () => {
  assert.equal(
    isMissingReleaseLookup({ status: 1, stdout: null, stderr: 'release v1.2.3 not found' }),
    true
  );
});

test('isMissingReleaseLookup is case-insensitive for the not-found pattern', () => {
  assert.equal(
    isMissingReleaseLookup({ status: 1, stdout: null, stderr: 'Release Not Found' }),
    true
  );
});

test('isMissingReleaseLookup returns true when stderr contains a 404 status code', () => {
  assert.equal(
    isMissingReleaseLookup({ status: 1, stdout: null, stderr: 'HTTP 404: not found' }),
    true
  );
});

test('isMissingReleaseLookup returns false for operational errors unrelated to a missing release', () => {
  assert.equal(
    isMissingReleaseLookup({ status: 1, stdout: null, stderr: 'authentication failed' }),
    false
  );
});

test('isMissingReleaseLookup returns false when output is empty', () => {
  assert.equal(isMissingReleaseLookup({ status: 1, stdout: null, stderr: null }), false);
});

test('isMissingReleaseLookup does not match partial 404 substrings', () => {
  assert.equal(
    isMissingReleaseLookup({ status: 1, stdout: null, stderr: 'error code 4040' }),
    false
  );
});
