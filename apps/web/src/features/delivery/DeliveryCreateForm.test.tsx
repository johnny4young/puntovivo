import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import i18n from '@/i18n';
import { DeliveryCreateForm } from './DeliveryCreateForm';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  fromSale: vi.fn(),
  debouncePending: false,
  sales: [{ id: 'sale-1', saleNumber: 'SALE-1', total: 24, currencyCode: 'COP' }],
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    deliveryOrders: {
      saleOptions: {
        useQuery: () => ({ data: h.sales, isFetching: false, error: null, refetch: vi.fn() }),
      },
    },
  },
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => ({
    mutateAsync: path === 'deliveryOrders.create' ? h.create : h.fromSale,
    isPending: false,
  }),
}));
vi.mock('@/hooks/useDebouncedValue', () => ({
  useDebouncedValue: (value: string) => (h.debouncePending ? '' : value),
}));

async function fillRecipient() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Recipient name'), 'Recipient');
  await user.type(screen.getByLabelText('Delivery address'), 'Address');
  return user;
}
describe('Delivery creation safety', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    h.debouncePending = false;
    h.create.mockResolvedValue({ id: 'delivery' });
    h.fromSale.mockResolvedValue({ id: 'delivery-sale' });
    h.sales = [{ id: 'sale-1', saleNumber: 'SALE-1', total: 24, currencyCode: 'COP' }];
    await i18n.changeLanguage('en');
  });
  it('creates an explicitly non-financial manual quote', async () => {
    const created = vi.fn();
    render(<DeliveryCreateForm siteId="site" onCreated={created} onCancel={vi.fn()} />);
    expect(screen.getByText(/does not collect payment or deduct inventory/)).toBeVisible();
    const user = await fillRecipient();
    await user.clear(screen.getByLabelText('Quoted amount (no payment recorded)'));
    await user.type(screen.getByLabelText('Quoted amount (no payment recorded)'), '24');
    await user.click(screen.getByRole('button', { name: 'Create delivery' }));
    expect(h.create).toHaveBeenCalledWith({
      siteId: 'site',
      customerName: 'Recipient',
      customerPhone: '',
      address: 'Address',
      addressNotes: '',
      totalAmount: 24,
    });
    expect(h.fromSale).not.toHaveBeenCalled();
    expect(created).toHaveBeenCalledWith('delivery');
  });
  it('sends only the chosen sale reference, never client totals or item snapshots', async () => {
    render(
      <DeliveryCreateForm
        siteId="site"
        initialSaleId="sale-1"
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const user = await fillRecipient();
    expect(screen.queryByLabelText('Quoted amount (no payment recorded)')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create delivery' }));
    expect(h.fromSale).toHaveBeenCalledWith({
      siteId: 'site',
      saleId: 'sale-1',
      customerName: 'Recipient',
      customerPhone: '',
      address: 'Address',
      addressNotes: '',
    });
    expect(h.create).not.toHaveBeenCalled();
  });
  it('cannot submit a missing or no-longer-eligible sale', () => {
    h.sales = [];
    render(
      <DeliveryCreateForm
        siteId="site"
        initialSaleId="sale-1"
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Create delivery' })).toBeDisabled();
  });
  it('cannot submit a previous sale during a pending search', () => {
    h.debouncePending = true;
    render(
      <DeliveryCreateForm
        siteId="site"
        initialSaleId="sale-1"
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Create delivery' })).toBeDisabled();
  });
  it('shows localized rejection rather than raw database diagnostics', async () => {
    h.create.mockRejectedValue({
      data: { code: 'INTERNAL_SERVER_ERROR' },
      message: 'SQLite failed at secret-file.db',
    });
    render(<DeliveryCreateForm siteId="site" onCreated={vi.fn()} onCancel={vi.fn()} />);
    const user = await fillRecipient();
    await user.click(screen.getByRole('button', { name: 'Create delivery' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The delivery could not be created. Try again.'
    );
    expect(screen.queryByText(/secret-file/)).not.toBeInTheDocument();
  });
});
