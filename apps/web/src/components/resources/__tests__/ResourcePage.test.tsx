import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';
import { useState } from 'react';
import { render, screen } from '@/test/utils';
import { ResourcePage } from '../ResourcePage';

interface TestRecord {
  name: string;
}

const columns: ColumnDef<TestRecord>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
  },
];

function ControlledResourcePage({ onSearchChange }: { onSearchChange: (value: string) => void }) {
  const [searchValue, setSearchValue] = useState('Remote provider');

  return (
    <ResourcePage
      title="Providers"
      action={<button type="button">Add</button>}
      columns={columns}
      data={[{ name: 'Existing provider' }]}
      isLoading={false}
      error={null}
      searchKey="name"
      searchPlaceholder="Search providers..."
      searchValue={searchValue}
      onSearchChange={value => {
        setSearchValue(value);
        onSearchChange(value);
      }}
      loadingMessage="Loading providers..."
    />
  );
}

describe('ResourcePage', () => {
  it('renders the shared table loading skeleton while loading', () => {
    render(
      <ResourcePage
        title="Providers"
        description="Manage providers"
        action={<button type="button">Add</button>}
        columns={columns}
        data={[]}
        isLoading
        error={null}
        searchKey="name"
        searchPlaceholder="Search providers..."
        loadingMessage="Loading providers..."
      />
    );

    expect(screen.getByRole('status', { name: /loading providers/i })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders a retryable table error state', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <ResourcePage
        title="Providers"
        description="Manage providers"
        action={<button type="button">Add</button>}
        columns={columns}
        data={[]}
        isLoading={false}
        error="Network request failed"
        searchKey="name"
        searchPlaceholder="Search providers..."
        loadingMessage="Loading providers..."
        onRetry={onRetry}
      />
    );

    expect(screen.getByText(/unable to load providers/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('forwards controlled search changes for server-backed resources', async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();

    render(<ControlledResourcePage onSearchChange={onSearchChange} />);

    const search = screen.getByPlaceholderText('Search providers...');
    expect(search).toHaveValue('Remote provider');
    await user.clear(search);
    await user.type(search, 'Imported provider');

    expect(onSearchChange).toHaveBeenLastCalledWith('Imported provider');
  });
});
