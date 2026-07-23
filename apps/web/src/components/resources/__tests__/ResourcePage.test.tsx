import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';
import { useState } from 'react';
import i18n from '@/i18n';
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

/**
 * the error title used to be built as
 * `Unable to load ${title.toLowerCase()}` in the component. Unlike the other
 * English strings in the shared components, it was NOT a default a caller
 * could override: it rendered for every locale, so a Spanish operator whose
 * network hiccuped read "Unable to load clientes" — half a sentence in a
 * language this product does not ship in.
 */
describe('ResourcePage error title localization', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('states the load failure in the active locale', async () => {
    await i18n.changeLanguage('es');

    render(
      <ResourcePage
        title="Clientes"
        action={<button type="button">Agregar</button>}
        columns={columns}
        data={[]}
        isLoading={false}
        error="Fallo de red"
        searchKey="name"
        searchPlaceholder="Buscar clientes..."
        loadingMessage="Cargando clientes..."
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText('No se pudo cargar clientes')).toBeInTheDocument();
    expect(screen.queryByText(/unable to load/i)).not.toBeInTheDocument();
    // The retry label defaulted to English too.
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});
