import { describe, expect, it } from 'vitest';
import { applyGraphicsTier, prefersLiteGraphics } from './graphicsTier';

describe('graphics tier', () => {
  it('treats 4 GB or four cores as modest hardware', () => {
    expect(prefersLiteGraphics({ hardwareConcurrency: 4, deviceMemory: 8 })).toBe(true);
    expect(prefersLiteGraphics({ hardwareConcurrency: 8, deviceMemory: 4 })).toBe(true);
    expect(prefersLiteGraphics({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(false);
  });

  it('keeps blur when the engine reports no hints', () => {
    expect(prefersLiteGraphics({})).toBe(false);
  });

  it('marks the document root only on modest hardware', () => {
    const modest = document.createElement('html');
    applyGraphicsTier(modest, { hardwareConcurrency: 4 });
    expect(modest.dataset.graphics).toBe('lite');

    const capable = document.createElement('html');
    applyGraphicsTier(capable, { hardwareConcurrency: 12, deviceMemory: 8 });
    expect(capable.dataset.graphics).toBeUndefined();
  });
});
