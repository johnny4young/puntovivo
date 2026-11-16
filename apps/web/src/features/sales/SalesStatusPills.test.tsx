import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { render } from '@/test/utils';
import { SalesStatusPills } from './SalesStatusPills';

const syncStatus = vi.hoisted(() => ({ pendingCount: 0 }));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    sync: { status: { useQuery: () => ({ data: { pendingCount: syncStatus.pendingCount } }) } },
  },
}));

function setOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

afterEach(() => {
  syncStatus.pendingCount = 0;
  vi.restoreAllMocks();
});

describe('SalesStatusPills', () => {
  it('stays quiet about the connection while online with nothing queued', () => {
    render(<SalesStatusPills scannerLocked={false} hasReceiptPrinter />);

    expect(screen.queryByTestId('sales-connection-pill')).not.toBeInTheDocument();
    expect(screen.getByTestId('sales-devices-pill')).toHaveTextContent('Scanner and printer ready');
  });

  it('tells an offline cashier to keep selling and how much is queued', () => {
    syncStatus.pendingCount = 6;
    render(<SalesStatusPills scannerLocked={false} hasReceiptPrinter />);
    setOnline(false);

    expect(screen.getByTestId('sales-connection-pill')).toHaveTextContent(
      'Offline · keep selling · 6 changes to send'
    );

    setOnline(true);
    expect(screen.getByTestId('sales-connection-pill')).toHaveTextContent('6 changes to send');
  });

  it('shows offline without a count when the queue is empty', () => {
    render(<SalesStatusPills scannerLocked={false} hasReceiptPrinter />);
    setOnline(false);

    expect(screen.getByTestId('sales-connection-pill')).toHaveTextContent('Offline · keep selling');
    expect(screen.getByTestId('sales-connection-pill')).not.toHaveTextContent('to send');
  });

  it('names the device that is not ready', () => {
    const noPrinter = render(<SalesStatusPills scannerLocked={false} hasReceiptPrinter={false} />);
    expect(screen.getByTestId('sales-devices-pill')).toHaveTextContent('No receipt printer');
    noPrinter.unmount();

    render(<SalesStatusPills scannerLocked hasReceiptPrinter />);
    expect(screen.getByTestId('sales-devices-pill')).toHaveTextContent('Product editing locked');
  });
});
