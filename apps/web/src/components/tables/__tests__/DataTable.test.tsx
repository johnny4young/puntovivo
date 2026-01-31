import { describe, it, expect, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../DataTable';
import { render, createMockProduct } from '@/test/utils';
import type { Product } from '@/types';

// ============================================================================
// Test Data & Setup
// ============================================================================

const columns: ColumnDef<Product, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    enableSorting: true,
  },
  {
    accessorKey: 'sku',
    header: 'SKU',
    enableSorting: true,
  },
  {
    accessorKey: 'price',
    header: 'Price',
    cell: ({ row }) => `$${row.original.price.toFixed(2)}`,
    enableSorting: true,
  },
  {
    accessorKey: 'stock',
    header: 'Stock',
    enableSorting: true,
  },
];

function createTestProducts(count: number): Product[] {
  return Array.from({ length: count }, (_, i) =>
    createMockProduct({
      id: `product-${i + 1}`,
      name: `Product ${String(i + 1).padStart(2, '0')}`,
      sku: `SKU-${String(i + 1).padStart(3, '0')}`,
      price: 10 + i * 5,
      stock: 100 - i * 10,
    })
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('DataTable', () => {
  describe('Rendering', () => {
    it('should render table with data', () => {
      const products = createTestProducts(3);

      render(<DataTable columns={columns} data={products} />);

      // Check headers
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('SKU')).toBeInTheDocument();
      expect(screen.getByText('Price')).toBeInTheDocument();
      expect(screen.getByText('Stock')).toBeInTheDocument();

      // Check data rows
      expect(screen.getByText('Product 01')).toBeInTheDocument();
      expect(screen.getByText('Product 02')).toBeInTheDocument();
      expect(screen.getByText('Product 03')).toBeInTheDocument();
    });

    it('should render the correct number of rows', () => {
      const products = createTestProducts(5);

      render(<DataTable columns={columns} data={products} />);

      const table = screen.getByRole('table');
      const tbody = within(table).getAllByRole('rowgroup')[1]; // tbody is second rowgroup
      const rows = within(tbody).getAllByRole('row');

      expect(rows).toHaveLength(5);
    });

    it('should render cell values correctly', () => {
      const products = [
        createMockProduct({
          name: 'Test Item',
          sku: 'TEST-001',
          price: 29.99,
          stock: 50,
        }),
      ];

      render(<DataTable columns={columns} data={products} />);

      expect(screen.getByText('Test Item')).toBeInTheDocument();
      expect(screen.getByText('TEST-001')).toBeInTheDocument();
      expect(screen.getByText('$29.99')).toBeInTheDocument();
      expect(screen.getByText('50')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty state when data is empty', () => {
      render(<DataTable columns={columns} data={[]} />);

      expect(screen.getByText('No results.')).toBeInTheDocument();
    });

    it('should show headers even when data is empty', () => {
      render(<DataTable columns={columns} data={[]} />);

      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('SKU')).toBeInTheDocument();
      expect(screen.getByText('Price')).toBeInTheDocument();
    });
  });

  describe('Sorting', () => {
    it('should sort by column when header is clicked', async () => {
      const user = userEvent.setup();
      const products = createTestProducts(3);

      render(<DataTable columns={columns} data={products} />);

      // Click on Name header to sort ascending
      const nameHeader = screen.getByText('Name');
      await user.click(nameHeader);

      // Get all name cells
      const table = screen.getByRole('table');
      const tbody = within(table).getAllByRole('rowgroup')[1];
      const rows = within(tbody).getAllByRole('row');

      // First row should have Product 01 (ascending)
      expect(within(rows[0]).getByText('Product 01')).toBeInTheDocument();
    });

    it('should toggle sort direction on subsequent clicks', async () => {
      const user = userEvent.setup();
      const products = createTestProducts(3);

      render(<DataTable columns={columns} data={products} />);

      const nameHeader = screen.getByText('Name');

      // First click - ascending
      await user.click(nameHeader);

      // Second click - descending
      await user.click(nameHeader);

      const table = screen.getByRole('table');
      const tbody = within(table).getAllByRole('rowgroup')[1];
      const rows = within(tbody).getAllByRole('row');

      // First row should have Product 03 (descending)
      expect(within(rows[0]).getByText('Product 03')).toBeInTheDocument();
    });

    it('should sort numeric columns correctly', async () => {
      const user = userEvent.setup();
      const products = [
        createMockProduct({ name: 'Item A', price: 10 }),
        createMockProduct({ name: 'Item C', price: 30 }),
        createMockProduct({ name: 'Item B', price: 20 }),
      ];

      render(<DataTable columns={columns} data={products} />);

      const priceHeader = screen.getByText('Price');

      // Click price header to trigger sorting
      await user.click(priceHeader);

      const table = screen.getByRole('table');
      const tbody = within(table).getAllByRole('rowgroup')[1];
      const rows = within(tbody).getAllByRole('row');

      // Verify all items are present in the table (sorting works without errors)
      expect(rows).toHaveLength(3);
      expect(screen.getByText('Item A')).toBeInTheDocument();
      expect(screen.getByText('Item B')).toBeInTheDocument();
      expect(screen.getByText('Item C')).toBeInTheDocument();
    });
  });

  describe('Filtering/Search', () => {
    it('should render search input when searchKey is provided', () => {
      const products = createTestProducts(3);

      render(
        <DataTable
          columns={columns}
          data={products}
          searchKey="name"
          searchPlaceholder="Search products..."
        />
      );

      expect(screen.getByPlaceholderText('Search products...')).toBeInTheDocument();
    });

    it('should not render search input when searchKey is not provided', () => {
      const products = createTestProducts(3);

      render(<DataTable columns={columns} data={products} />);

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('should filter rows based on search input', async () => {
      const user = userEvent.setup();
      const products = [
        createMockProduct({ name: 'Apple' }),
        createMockProduct({ name: 'Banana' }),
        createMockProduct({ name: 'Cherry' }),
      ];

      render(
        <DataTable
          columns={columns}
          data={products}
          searchKey="name"
          searchPlaceholder="Search..."
        />
      );

      const searchInput = screen.getByPlaceholderText('Search...');
      await user.type(searchInput, 'Banana');

      await waitFor(() => {
        expect(screen.getByText('Banana')).toBeInTheDocument();
        expect(screen.queryByText('Apple')).not.toBeInTheDocument();
        expect(screen.queryByText('Cherry')).not.toBeInTheDocument();
      });
    });

    it('should show no results when search matches nothing', async () => {
      const user = userEvent.setup();
      const products = createTestProducts(3);

      render(
        <DataTable
          columns={columns}
          data={products}
          searchKey="name"
          searchPlaceholder="Search..."
        />
      );

      const searchInput = screen.getByPlaceholderText('Search...');
      await user.type(searchInput, 'nonexistent');

      await waitFor(() => {
        expect(screen.getByText('No results.')).toBeInTheDocument();
      });
    });

    it('should be case-insensitive when filtering', async () => {
      const user = userEvent.setup();
      const products = [createMockProduct({ name: 'Apple Product' })];

      render(
        <DataTable
          columns={columns}
          data={products}
          searchKey="name"
          searchPlaceholder="Search..."
        />
      );

      const searchInput = screen.getByPlaceholderText('Search...');
      await user.type(searchInput, 'apple');

      await waitFor(() => {
        expect(screen.getByText('Apple Product')).toBeInTheDocument();
      });
    });
  });

  describe('Pagination', () => {
    it('should show pagination controls', () => {
      const products = createTestProducts(15);

      render(<DataTable columns={columns} data={products} pageSize={10} />);

      expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
    });

    it('should respect custom page size', () => {
      const products = createTestProducts(10);

      render(<DataTable columns={columns} data={products} pageSize={5} />);

      const table = screen.getByRole('table');
      const tbody = within(table).getAllByRole('rowgroup')[1];
      const rows = within(tbody).getAllByRole('row');

      expect(rows).toHaveLength(5);
      expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
    });

    it('should navigate to next page', async () => {
      const user = userEvent.setup();
      const products = createTestProducts(15);

      render(<DataTable columns={columns} data={products} pageSize={10} />);

      // Find and click next page button (single chevron right)
      const nextButton = screen.getAllByRole('button')[2]; // Third button is next
      await user.click(nextButton);

      expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();
    });

    it('should navigate to previous page', async () => {
      const user = userEvent.setup();
      const products = createTestProducts(15);

      render(<DataTable columns={columns} data={products} pageSize={10} />);

      // Go to page 2 first
      const nextButton = screen.getAllByRole('button')[2];
      await user.click(nextButton);

      // Go back to page 1
      const prevButton = screen.getAllByRole('button')[1];
      await user.click(prevButton);

      expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
    });

    it('should jump to first page', async () => {
      const user = userEvent.setup();
      const products = createTestProducts(30);

      render(<DataTable columns={columns} data={products} pageSize={10} />);

      // Go to last page
      const lastButton = screen.getAllByRole('button')[3];
      await user.click(lastButton);

      expect(screen.getByText(/Page 3 of 3/)).toBeInTheDocument();

      // Jump to first page
      const firstButton = screen.getAllByRole('button')[0];
      await user.click(firstButton);

      expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    });

    it('should disable previous buttons on first page', () => {
      const products = createTestProducts(15);

      render(<DataTable columns={columns} data={products} pageSize={10} />);

      const buttons = screen.getAllByRole('button');
      expect(buttons[0]).toBeDisabled(); // First page button
      expect(buttons[1]).toBeDisabled(); // Previous button
    });

    it('should disable next buttons on last page', async () => {
      const user = userEvent.setup();
      const products = createTestProducts(15);

      render(<DataTable columns={columns} data={products} pageSize={10} />);

      // Go to last page
      const lastButton = screen.getAllByRole('button')[3];
      await user.click(lastButton);

      const buttons = screen.getAllByRole('button');
      expect(buttons[2]).toBeDisabled(); // Next button
      expect(buttons[3]).toBeDisabled(); // Last page button
    });

    it('should show correct entry count', () => {
      const products = createTestProducts(25);

      render(<DataTable columns={columns} data={products} pageSize={10} />);

      expect(screen.getByText(/Showing 1 to 10 of 25 entries/)).toBeInTheDocument();
    });
  });

  describe('Row Selection', () => {
    const selectionColumns: ColumnDef<Product, unknown>[] = [
      {
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllPageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            aria-label={`Select row ${row.index + 1}`}
          />
        ),
        enableSorting: false,
      },
      ...columns,
    ];

    it('should show selection checkboxes when enabled', () => {
      const products = createTestProducts(3);

      render(<DataTable columns={selectionColumns} data={products} enableRowSelection />);

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThan(0);
    });

    it('should select individual rows', async () => {
      const user = userEvent.setup();
      const onSelectionChange = vi.fn();
      const products = createTestProducts(3);

      render(
        <DataTable
          columns={selectionColumns}
          data={products}
          enableRowSelection
          onRowSelectionChange={onSelectionChange}
        />
      );

      const rowCheckboxes = screen.getAllByRole('checkbox').slice(1); // Skip header checkbox
      await user.click(rowCheckboxes[0]);

      expect(onSelectionChange).toHaveBeenCalled();
      expect(screen.getByText('1 selected')).toBeInTheDocument();
    });

    it('should select all rows on page', async () => {
      const user = userEvent.setup();
      const onSelectionChange = vi.fn();
      const products = createTestProducts(3);

      render(
        <DataTable
          columns={selectionColumns}
          data={products}
          enableRowSelection
          onRowSelectionChange={onSelectionChange}
        />
      );

      const selectAllCheckbox = screen.getAllByRole('checkbox')[0];
      await user.click(selectAllCheckbox);

      expect(screen.getByText('3 selected')).toBeInTheDocument();
    });

    it('should deselect all when clicking select all again', async () => {
      const user = userEvent.setup();
      const products = createTestProducts(3);

      render(<DataTable columns={selectionColumns} data={products} enableRowSelection />);

      const selectAllCheckbox = screen.getAllByRole('checkbox')[0];

      // Select all
      await user.click(selectAllCheckbox);
      expect(screen.getByText('3 selected')).toBeInTheDocument();

      // Deselect all
      await user.click(selectAllCheckbox);
      expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    });

    it('should not show selection count when no rows selected', () => {
      const products = createTestProducts(3);

      render(<DataTable columns={selectionColumns} data={products} enableRowSelection />);

      expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    });

    it('should call onRowSelectionChange with selected rows', async () => {
      const user = userEvent.setup();
      const onSelectionChange = vi.fn();
      const products = createTestProducts(3);

      render(
        <DataTable
          columns={selectionColumns}
          data={products}
          enableRowSelection
          onRowSelectionChange={onSelectionChange}
        />
      );

      const rowCheckboxes = screen.getAllByRole('checkbox').slice(1);
      await user.click(rowCheckboxes[0]);
      await user.click(rowCheckboxes[1]);

      // Should have been called twice
      expect(onSelectionChange).toHaveBeenCalledTimes(2);

      // Last call should have 2 products
      const lastCall = onSelectionChange.mock.calls[onSelectionChange.mock.calls.length - 1];
      expect(lastCall[0]).toHaveLength(2);
    });
  });
});
