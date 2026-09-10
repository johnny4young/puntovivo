import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils';
import { ProviderAccountsPage } from './ProviderAccountsPage';

const queryState = vi.hoisted(() => ({ error: null as unknown }));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    providers: {
      list: {
        useQuery: (input: { isActive?: boolean }) => ({
          data: {
            items: [
              {
                id: 'provider-1',
                name: 'Safe Supplier',
                contactName: 'Accounts Desk',
                taxId: '900123',
                email: 'ap@example.test',
                isActive: true,
              },
              {
                id: 'provider-2',
                name: 'Inactive Supplier With Balance',
                contactName: null,
                taxId: null,
                email: null,
                isActive: false,
              },
            ].filter(
              provider => input.isActive === undefined || provider.isActive === input.isActive
            ),
          },
          isLoading: false,
          error: queryState.error,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock('./ProviderPayablesModal', () => ({
  ProviderPayablesModal: ({ provider }: { provider: { name: string } }) => (
    <div role="dialog" aria-label={`Account ${provider.name}`} />
  ),
}));

describe('ProviderAccountsPage', () => {
  beforeEach(() => {
    queryState.error = null;
  });

  it('exposes only the supplier-account action on the manager-safe route', async () => {
    const user = userEvent.setup();
    render(<ProviderAccountsPage />);

    expect(screen.getByRole('heading', { name: 'Supplier accounts' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByText('Inactive Supplier With Balance')).toBeVisible();
    expect(screen.getByText('Inactive')).toBeVisible();

    const activeRow = screen.getByText('Safe Supplier').closest('tr');
    expect(activeRow).not.toBeNull();
    await user.click(
      within(activeRow!).getByRole('button', { name: 'Open account for Safe Supplier' })
    );
    expect(await screen.findByRole('dialog', { name: 'Account Safe Supplier' })).toBeVisible();
  });

  it('does not expose provider-directory transport internals', () => {
    queryState.error = {
      message: 'SQLITE_ERROR: no such column provider_payables.secret',
      data: { code: 'INTERNAL_SERVER_ERROR' },
    };

    render(<ProviderAccountsPage />);

    expect(screen.getByText('Something went wrong. Please try again.')).toBeVisible();
    expect(screen.queryByText(/no such column/i)).not.toBeInTheDocument();
  });
});
