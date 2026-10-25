import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from '@/components/tables/DataTable';
import { createMockProduct } from '@/test/utils';
import { productsColumns, type DisplayProduct } from './productsColumns';

const product = createMockProduct({ id: 'p-1', name: 'Café Premium' }) as DisplayProduct;

function table(margin: Map<string, number> | null) {
  return (
    <DataTable
      columns={productsColumns(vi.fn(), vi.fn(), vi.fn(), true, true, false, margin)}
      data={[product]}
      getRowId={row => row.id}
    />
  );
}

describe('product row actions', () => {
  it('keep their DOM identity when the column array is rebuilt', () => {
    const { rerender } = render(table(null));
    const opener = screen.getByRole('button', { name: 'Delete' });

    rerender(table(new Map([['p-1', 31]])));

    expect(screen.getByRole('button', { name: 'Delete' })).toBe(opener);
    expect(opener.isConnected).toBe(true);
  });
});
