import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@/test/utils';
import SaleDeliverySheet from './SaleDeliverySheet';

const h = vi.hoisted(() => ({
  fromSale: vi.fn(),
  success: vi.fn(),
  customer: null as null | { name: string; phone: string | null; address: string | null },
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    customers: {
      getById: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => ({
          data: options.enabled ? h.customer : undefined,
          isLoading: false,
        }),
      },
    },
  },
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ mutateAsync: h.fromSale, isPending: false }),
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: h.success, error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const SALE = { id: 'sale-1', saleNumber: 'VTA-1', total: 840_985, change: 0 };

describe('SaleDeliverySheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.customer = null;
    h.fromSale.mockResolvedValue({ id: 'delivery-1' });
  });

  it("fills in the customer's name, phone and address and creates the delivery for the sale", async () => {
    h.customer = { name: 'Constructora Andina', phone: '3001234567', address: 'Cra 5 # 26-40' };
    const onClose = vi.fn();
    render(
      <SaleDeliverySheet
        siteId="site-1"
        sale={{ ...SALE, customerId: 'customer-1', customerName: 'Constructora Andina' }}
        onClose={onClose}
      />
    );
    expect(screen.getByText(/Sale VTA-1/)).toBeInTheDocument();
    expect(screen.getByLabelText('Recipient name')).toHaveValue('Constructora Andina');
    expect(screen.getByLabelText('Phone')).toHaveValue('3001234567');
    expect(screen.getByLabelText('Delivery address')).toHaveValue('Cra 5 # 26-40');

    await userEvent.setup().click(screen.getByTestId('sale-delivery-submit'));

    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(h.fromSale).toHaveBeenCalledWith({
      siteId: 'site-1',
      saleId: 'sale-1',
      customerName: 'Constructora Andina',
      customerPhone: '3001234567',
      address: 'Cra 5 # 26-40',
      addressNotes: '',
    });
    expect(h.success).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delivery created' }));
  });

  it('leaves out a saved value longer than the server accepts', () => {
    h.customer = {
      name: 'Obra',
      phone: '300 123 4567 / 601 555 1234 ext 12 oficina',
      address: 'Calle 1',
    };
    render(
      <SaleDeliverySheet
        siteId="site-1"
        sale={{ ...SALE, customerId: 'customer-1', customerName: 'Obra' }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Phone')).toHaveValue('');
    expect(screen.getByLabelText('Delivery address')).toHaveValue('Calle 1');
  });

  it('asks for the address of a walk-in sale and keeps the sheet open on a refusal', async () => {
    h.fromSale.mockRejectedValue(new Error('refused'));
    const onClose = vi.fn();
    render(<SaleDeliverySheet siteId="site-1" sale={SALE} onClose={onClose} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('sale-delivery-submit'));
    // Native validation stops the empty form.
    expect(h.fromSale).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Recipient name'), 'Obra');
    await user.type(screen.getByLabelText('Delivery address'), 'Calle 1');
    await user.click(screen.getByTestId('sale-delivery-submit'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledWith(false);
  });
});
