import { describe, expect, it } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
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
});
