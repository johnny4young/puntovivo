/**
 * slice 2 — `blobToBase64` tests.
 */
import { describe, expect, it } from 'vitest';

import { blobToBase64 } from './blobToBase64';

describe('blobToBase64', () => {
  it('returns the bare base64 payload and strips codec parameters from the MIME type', async () => {
    const blob = new Blob(['hello'], { type: 'audio/webm;codecs=opus' });

    const result = await blobToBase64(blob);

    expect(result.base64).toBe('aGVsbG8=');
    expect(result.mimeType).toBe('audio/webm');
  });
});
