import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';

interface HandlesData {
  handles: Array<{ kind: string; value: string }>;
  qrPayload: string | null;
  qrSource: string | null;
}

const mocks = vi.hoisted(() => ({
  data: undefined as HandlesData | undefined,
  isLoading: false,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    paymentSettings: {
      transferHandles: {
        useQuery: () => ({ data: mocks.data, isLoading: mocks.isLoading }),
      },
    },
  },
}));

import { SaleTransferPanel } from './SaleTransferPanel';

beforeEach(() => {
  mocks.isLoading = false;
  mocks.data = { handles: [], qrPayload: null, qrSource: null };
});

describe('SaleTransferPanel', () => {
  it('draws the QR of the first handle and lists every handle', async () => {
    mocks.data = {
      handles: [
        { kind: 'breb', value: '@tiendaprueba' },
        { kind: 'nequi', value: '3000000000' },
      ],
      qrPayload: null,
      qrSource: '@tiendaprueba',
    };
    render(<SaleTransferPanel isAdmin={false} />);

    const qr = await screen.findByTestId('sale-transfer-qr');
    expect(qr).toHaveAccessibleName('QR code to transfer to the store');
    // A version-1 code is 21 modules plus the quiet zone on each side.
    expect(qr.getAttribute('viewBox')).toBe('0 0 25 25');
    expect(qr.querySelector('path')?.getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/);
    expect(screen.getAllByTestId('sale-transfer-handle').map(item => item.textContent)).toEqual([
      'Key @tiendaprueba',
      'Nequi 3000000000',
    ]);
    expect(
      screen.getByText("The customer scans it to copy the store's key or number.")
    ).toBeVisible();
  });

  it('says a wallet can read the QR only when the bank content is stored', async () => {
    mocks.data = {
      handles: [{ kind: 'bank', value: '000-111' }],
      qrPayload: '00020101021226',
      qrSource: '00020101021226',
    };
    render(<SaleTransferPanel isAdmin={false} />);

    await screen.findByTestId('sale-transfer-qr');
    expect(screen.getByText('The customer scans it from their bank or wallet app.')).toBeVisible();
  });

  it('tells a cashier to ask an administrator when nothing is configured', () => {
    render(<SaleTransferPanel isAdmin={false} />);

    expect(screen.getByTestId('sale-transfer-unconfigured')).toHaveTextContent(
      'Ask an administrator to set it up.'
    );
    expect(screen.queryByTestId('sale-transfer-configure')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sale-transfer-qr')).not.toBeInTheDocument();
  });

  it('links an administrator to the payment settings', () => {
    render(<SaleTransferPanel isAdmin />);

    expect(screen.getByTestId('sale-transfer-configure')).toHaveAttribute(
      'href',
      '/company?tab=payments'
    );
  });

  it('shows nothing while the handles load', () => {
    mocks.isLoading = true;
    mocks.data = undefined;
    const { container } = render(<SaleTransferPanel isAdmin />);

    expect(container).toBeEmptyDOMElement();
  });
});
