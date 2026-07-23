import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import { TableToolbar, type TableToolbarProps } from '../TableToolbar';

function renderToolbar(overrides: Partial<TableToolbarProps> = {}) {
  const props: TableToolbarProps = {
    columns: [
      { key: 'register', header: 'Register' },
      { key: 'operator', header: 'Operator' },
    ],
    visibleColumns: new Set(['register', 'operator']),
    onToggleColumn: vi.fn(),
    onShowAllColumns: vi.fn(),
    ...overrides,
  };

  return { ...render(<TableToolbar {...props} />), props };
}

describe('TableToolbar', () => {
  it('clears a controlled search through the compact shared icon button', async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    renderToolbar({ searchValue: 'register 04', onSearchChange });

    const clearButton = screen.getByRole('button', { name: 'Clear search' });
    expect(clearButton).toHaveAttribute('type', 'button');
    expect(clearButton).toHaveClass('btn-ghost', 'btn-icon', 'h-8', 'w-8');

    await user.click(clearButton);

    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  it('opens the export menu and invokes the selected export action', async () => {
    const user = userEvent.setup();
    const onExportCSV = vi.fn();
    renderToolbar({ showSearch: false, onExportCSV });

    const exportTrigger = screen.getByRole('button', { name: 'Export' });
    expect(exportTrigger).toHaveClass('btn-outline', 'min-h-9');
    await user.click(exportTrigger);
    await user.click(screen.getByRole('button', { name: /Export as CSV/ }));

    expect(onExportCSV).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /Export as CSV/ })).not.toBeInTheDocument();
  });

  it('keeps column recovery inside the shared compact action grammar', async () => {
    const user = userEvent.setup();
    const onShowAllColumns = vi.fn();
    renderToolbar({ showSearch: false, onShowAllColumns });

    await user.click(screen.getByRole('button', { name: 'Toggle Columns' }));
    const showAll = screen.getByRole('button', { name: 'Show all columns' });
    expect(showAll).toHaveClass('btn-ghost', 'min-h-9');
    await user.click(showAll);

    expect(onShowAllColumns).toHaveBeenCalledOnce();
  });
});
