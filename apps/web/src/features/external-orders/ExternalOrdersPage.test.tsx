import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import i18n from '@/i18n';
import { ExternalOrdersPage } from './ExternalOrdersPage';
const h = vi.hoisted(() => ({
  role: 'admin',
  site: 'site-1',
  loading: false,
  error: null as unknown,
  hasMore: false,
  query: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: h.role } }) }));
vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: h.site ? { id: h.site } : null }),
}));
vi.mock('./ConnectorsPanel', () => ({
  ConnectorsPanel: ({ siteId }: { siteId: string }) => <div data-testid="connectors">{siteId}</div>,
}));
vi.mock('./ExternalOrderPanel', () => ({
  ExternalOrderPanel: ({ id, siteId }: { id: string; siteId: string }) => (
    <div data-testid="detail">
      {siteId}:{id}
    </div>
  ),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      externalOrders: { invalidate: vi.fn() },
      sales: { invalidate: vi.fn() },
      deliveryOrders: { invalidate: vi.fn() },
    }),
    externalOrders: {
      list: {
        useQuery: (input: unknown, options: unknown) => {
          h.query(input, options);
          return {
            data: {
              rows: [
                {
                  id: 'order',
                  externalId: 'external-1',
                  status: 'received',
                  createdAt: '2026-09-01',
                  snapshot: { customerName: 'Customer' },
                },
              ],
              hasMore: h.hasMore,
            },
            isLoading: h.loading,
            isFetching: h.loading,
            error: h.error,
            refetch: h.refetch,
          };
        },
      },
    },
  },
}));
beforeEach(async () => {
  vi.clearAllMocks();
  h.role = 'admin';
  h.site = 'site-1';
  h.loading = false;
  h.error = null;
  h.hasMore = false;
  await i18n.changeLanguage('en');
});
describe('External inbox state and permission UI', () => {
  it('loads translated text leaves rather than rendering a namespace object', () => {
    h.loading = true;
    render(<ExternalOrdersPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
    expect(screen.queryByText(/returned an object/)).not.toBeInTheDocument();
  });
  it('only offers connector administration to admins', async () => {
    h.role = 'manager';
    const { rerender } = render(<ExternalOrdersPage />);
    expect(screen.queryByRole('button', { name: 'Connectors' })).not.toBeInTheDocument();
    h.role = 'admin';
    rerender(<ExternalOrdersPage />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connectors' }));
    expect(screen.getByTestId('connectors')).toHaveTextContent('site-1');
  });
  it('drops selected order, pagination and connector state when changing site', async () => {
    h.hasMore = true;
    const { rerender } = render(<ExternalOrdersPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /external-1/ }));
    expect(screen.getByTestId('detail')).toHaveTextContent('site-1:order');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByTestId('detail')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Connectors' }));
    h.site = 'site-2';
    rerender(<ExternalOrdersPage />);
    expect(screen.queryByTestId('connectors')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(h.query).toHaveBeenLastCalledWith(
      { siteId: 'site-2', status: 'received' },
      expect.objectContaining({ enabled: true })
    );
  });
  it('keeps queries disabled without site and never shows stale data as an actionable queue', () => {
    h.site = '';
    render(<ExternalOrdersPage />);
    expect(screen.getByText('Select an active site to manage external orders.')).toBeVisible();
    expect(h.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ siteId: '' }),
      expect.objectContaining({ enabled: false })
    );
  });
  it('offers a safe retry and disables forward paging after read failure', async () => {
    h.error = { data: { code: 'INTERNAL_SERVER_ERROR' }, message: 'SQLite private.db' };
    h.hasMore = true;
    render(<ExternalOrdersPage />);
    expect(screen.getByRole('alert')).not.toHaveTextContent('private.db');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.refetch).toHaveBeenCalledOnce();
  });
});
