import { describe, expect, it, vi } from 'vitest';
import { base64UrlToBytes, dropBrowserPush, isPushSupported } from '../companionPush';

describe('companion push helpers', () => {
  it('decodes unpadded base64url keys', () => {
    expect([...base64UrlToBytes('-_8')]).toEqual([0xfb, 0xff]);
    expect(
      base64UrlToBytes(
        'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'
      )
    ).toHaveLength(65);
  });

  it('reports no support where the Push API is missing', () => {
    expect(isPushSupported()).toBe(false);
  });

  it('never blocks sign-out when there is nothing to drop', async () => {
    const unsubscribe = vi.fn();
    await expect(dropBrowserPush(unsubscribe)).resolves.toBeUndefined();
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
