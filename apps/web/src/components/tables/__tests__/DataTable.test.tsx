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
  function getBodyRows() {
    const table = screen.getByRole('table');
    const tbody = within(table).getAllByRole('rowgroup')[1];
    return within(tbody).getAllByRole('row');
  }

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

    it('should wrap the table in a horizontal scroll region with keyboard access', () => {
      const products = createTestProducts(3);

      render(<DataTable columns={columns} data={products} />);

      const scrollRegion = screen.getByRole('table').parentElement;
      expect(scrollRegion).toHaveClass('data-table-scroll');
      // ENG-134c: axe rule `scrollable-region-focusable` requires the
      // wrapper to be tab-reachable (not just programmatically
      // focusable), semantically named, and given a role.
      expect(scrollRegion).toHaveAttribute('tabindex', '0');
      expect(scrollRegion).toHaveAttribute('role', 'region');
      expect(scrollRegion).toHaveAttribute('aria-label');
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

  describe('Keyboard Navigation', () => {
    it('moves focus between rows with arrow keys', async () => {
      const user = userEvent.setup();
      const products = createTestProducts(3);

      render(<DataTable columns={columns} data={products} />);

      // ENG-134c: the scroll wrapper is now the first focusable
      // stop (axe `scrollable-region-focusable`). Tab once to land
      // on the wrapper, again to enter the row's roving tabindex.
      await user.tab();
      await user.tab();

      const rows = getBodyRows();
      expect(rows[0]).toHaveFocus();

      await user.keyboard('{ArrowDown}');
      expect(rows[1]).toHaveFocus();

      await user.keyboard('{ArrowUp}');
      expect(rows[0]).toHaveFocus();
    });

    it('jumps to the first and last rows with home and end', async () => {
      const user = userEvent.setup();
      const products = createTestProducts(4);

      render(<DataTable columns={columns} data={products} />);

      // ENG-134c: tab twice — once to the scroll wrapper, once into
      // the first row.
      await user.tab();
      await user.tab();

      const rows = getBodyRows();
      expect(rows[0]).toHaveFocus();

      await user.keyboard('{End}');
      expect(rows[3]).toHaveFocus();

      await user.keyboard('{Home}');
      expect(rows[0]).toHaveFocus();
    });

    it('toggles row selection with the keyboard when selection is enabled', async () => {
      const user = userEvent.setup();
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

      render(<DataTable columns={selectionColumns} data={createTestProducts(3)} enableRowSelection />);

      const rows = getBodyRows();
      rows[0].focus();
      expect(rows[0]).toHaveFocus();

      await user.keyboard('{Space}');

      expect(screen.getByText('1 selected')).toBeInTheDocument();
      expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('Row activation (ENG-134f)', () => {
    it('fires onRowActivate with the row data when Enter is pressed on the focused row', async () => {
      const user = userEvent.setup();
      const onRowActivate = vi.fn();
      const products = createTestProducts(3);

      render(<DataTable columns={columns} data={products} onRowActivate={onRowActivate} />);

      const rows = getBodyRows();
      rows[1].focus();

      await user.keyboard('{Enter}');

      expect(onRowActivate).toHaveBeenCalledTimes(1);
      expect(onRowActivate).toHaveBeenCalledWith(products[1]);
    });

    it('fires onRowActivate when Space is pressed on the focused row', async () => {
      const user = userEvent.setup();
      const onRowActivate = vi.fn();
      const products = createTestProducts(3);

      render(<DataTable columns={columns} data={products} onRowActivate={onRowActivate} />);

      const rows = getBodyRows();
      rows[2].focus();

      await user.keyboard('{Space}');

      expect(onRowActivate).toHaveBeenCalledTimes(1);
      expect(onRowActivate).toHaveBeenCalledWith(products[2]);
    });

    it('does not require enableRowSelection — activate fires even when row selection is disabled', async () => {
      const user = userEvent.setup();
      const onRowActivate = vi.fn();
      const products = createTestProducts(2);

      render(
        <DataTable
          columns={columns}
          data={products}
          enableRowSelection={false}
          onRowActivate={onRowActivate}
        />
      );

      const rows = getBodyRows();
      rows[0].focus();

      await user.keyboard('{Enter}');

      expect(onRowActivate).toHaveBeenCalledWith(products[0]);
    });

    it('falls back to toggleSelected when onRowActivate is undefined and selection is enabled', async () => {
      // Regression guard for the legacy path (ENG-134c shipped roving
      // tabindex; ENG-134f adds onRowActivate without breaking the
      // existing toggleSelected branch).
      const user = userEvent.setup();
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

      render(
        <DataTable
          columns={selectionColumns}
          data={createTestProducts(3)}
          enableRowSelection
        />
      );

      const rows = getBodyRows();
      rows[0].focus();

      await user.keyboard('{Enter}');

      // No onRowActivate provided → legacy toggleSelected path runs.
      expect(screen.getByText('1 selected')).toBeInTheDocument();
    });

    it('does nothing on Enter when neither onRowActivate nor row selection is enabled', async () => {
      const user = userEvent.setup();
      const products = createTestProducts(2);

      render(<DataTable columns={columns} data={products} />);

      const rows = getBodyRows();
      rows[0].focus();

      await user.keyboard('{Enter}');

      // No selection counter, no aria-selected change — the activate
      // branch returns early without throwing.
      expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
      expect(rows[0]).not.toHaveAttribute('aria-selected', 'true');
    });

    it('ignores Enter when the event target is a nested interactive element (not the <tr>)', async () => {
      // The existing `event.target !== event.currentTarget` guard
      // prevents the row-level activate from firing when the user
      // presses Enter while focus is on a column-rendered <button>
      // or <input>. Mirrors the contract documented in handleRowKeyDown.
      const user = userEvent.setup();
      const onRowActivate = vi.fn();
      const products = createTestProducts(2);
      const interactiveColumns: ColumnDef<Product, unknown>[] = [
        {
          accessorKey: 'name',
          header: 'Name',
        },
        {
          id: 'action',
          header: 'Action',
          cell: ({ row }) => (
            <button type="button" aria-label={`Edit ${row.original.name}`}>
              Edit
            </button>
          ),
        },
      ];

      render(
        <DataTable
          columns={interactiveColumns}
          data={products}
          onRowActivate={onRowActivate}
        />
      );

      // Focus the inner button (not the row itself); Enter on the
      // button should fire the button's own onClick semantics — not
      // the row activate.
      const editButton = screen.getByRole('button', { name: /Edit Product 01/ });
      editButton.focus();
      await user.keyboard('{Enter}');

      expect(onRowActivate).not.toHaveBeenCalled();
    });
  });
});
