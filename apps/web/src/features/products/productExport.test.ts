import { describe, expect, it } from 'vitest';

import { productExportColumns } from './productExport';

describe('productExportColumns', () => {
  it('exports the inventory identity required to preserve services on re-import', () => {
    const column = productExportColumns.find(candidate => candidate.key === 'tracksStock');

    expect(column?.header).toBe('Tracks stock');
    expect(column?.formatter?.(false, {} as never)).toBe('No');
    expect(column?.formatter?.(true, {} as never)).toBe('Yes');
    expect(column?.formatter?.(undefined, {} as never)).toBe('Yes');
  });
});
