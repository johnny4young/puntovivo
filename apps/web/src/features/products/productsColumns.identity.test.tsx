import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type DataTableColumnDef } from '@/components/tables/DataTable';
import { createMockProduct, render } from '@/test/utils';
import type { Product } from '@/types';
import { productsColumns } from './productsColumns';

const getRowId = (product: Product) => product.id;

describe('product action identity', () => {
  it('preserves the action node while using fresh callbacks, row data and permissions', async () => {
    const product = createMockProduct({ id: 'synthetic-a', name: 'Before' });
    const oldDelete = vi.fn();
    const newDelete = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <DataTable
        data={[product]}
        getRowId={getRowId}
        columns={productsColumns(vi.fn(), vi.fn(), oldDelete, true, true, false)}
      />
    );
    const opener = screen.getByRole('button', { name: 'Delete' });
    opener.focus();
    const refreshed = { ...product, name: 'After' };
    rerender(
      <DataTable
        data={[refreshed]}
        getRowId={getRowId}
        columns={productsColumns(vi.fn(), vi.fn(), newDelete, false, true, false)}
      />
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBe(opener);
    expect(opener).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    await user.click(opener);
    expect(oldDelete).not.toHaveBeenCalled();
    expect(newDelete).toHaveBeenCalledExactlyOnceWith(refreshed, opener);
    rerender(
      <DataTable
        data={[refreshed]}
        getRowId={getRowId}
        columns={productsColumns(vi.fn(), vi.fn(), newDelete, true, false, false)}
      />
    );
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('maps selection by entity ID after reorder and excludes removed rows', async () => {
    const a = createMockProduct({ id: 'synthetic-a', name: 'A' });
    const b = createMockProduct({ id: 'synthetic-b', name: 'B' });
    const selected = vi.fn();
    const columns: DataTableColumnDef<Product>[] = [
      {
        id: 'selection',
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            aria-label={`Select ${row.original.id}`}
          />
        ),
      },
    ];
    const user = userEvent.setup();
    const { rerender } = render(
      <DataTable
        data={[a, b]}
        columns={columns}
        getRowId={getRowId}
        enableRowSelection
        onRowSelectionChange={selected}
      />
    );
    await user.click(screen.getByRole('checkbox', { name: 'Select synthetic-a' }));
    expect(selected).toHaveBeenLastCalledWith([a]);
    rerender(
      <DataTable
        data={[b, a]}
        columns={columns}
        getRowId={getRowId}
        enableRowSelection
        onRowSelectionChange={selected}
      />
    );
    expect(screen.getByRole('checkbox', { name: 'Select synthetic-a' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select synthetic-b' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Select synthetic-b' }));
    expect(selected).toHaveBeenLastCalledWith([a, b]);
    rerender(
      <DataTable
        data={[b]}
        columns={columns}
        getRowId={getRowId}
        enableRowSelection
        onRowSelectionChange={selected}
      />
    );
    await user.click(screen.getByRole('checkbox', { name: 'Select synthetic-b' }));
    expect(selected).toHaveBeenLastCalledWith([]);
  });
});
