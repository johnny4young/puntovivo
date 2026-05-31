import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { isAllowedExternalUrl } from '../external-url-policy.ts';

describe('external URL policy', () => {
  it('allows only https plus local HTTP URLs for shell.openExternal', () => {
    assert.equal(isAllowedExternalUrl('https://example.com/report'), true);
    assert.equal(isAllowedExternalUrl('http://localhost:3000/report'), true);
    assert.equal(isAllowedExternalUrl('http://127.0.0.1:3000/report'), true);
    assert.equal(isAllowedExternalUrl('http://[::1]:3000/report'), true);
    assert.equal(isAllowedExternalUrl('http://example.com/report'), false);
    assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false);
    assert.equal(isAllowedExternalUrl('file:///etc/passwd'), false);
    assert.equal(isAllowedExternalUrl('puntovivo://settings'), false);
    assert.equal(isAllowedExternalUrl('not a url'), false);
  });
});
