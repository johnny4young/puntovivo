import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import i18next from 'i18next';
import { render } from '@/test/utils';
import type { TransferDetail } from '@/types';
import { InventoryTransferDetailsModal } from './InventoryTransferDetailsModal';

interface GetByIdQueryState {
  data: TransferDetail | undefined;
  isLoading: boolean;
  error: Error | null;
}

let getByIdState: GetByIdQueryState = {
  data: undefined,
  isLoading: false,
  error: null,
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    transfers: {
      getById: {
        useQuery: () => getByIdState,
      },
    },
  },
}));

function buildDetail(overrides: Partial<TransferDetail> = {}): TransferDetail {
  return {
    id: 'transfer-1',
    status: 'completed',
    fromSiteId: 'site-a',
    fromSiteName: 'Main',
    toSiteId: 'site-b',
    toSiteName: 'Branch',
    notes: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-04-15T10:00:00Z').toISOString(),
    receivedAt: new Date('2026-04-15T12:00:00Z').toISOString(),
    receivedBy: 'user-1',
    updatedAt: new Date('2026-04-15T12:00:00Z').toISOString(),
    items: [
      {
        id: 'item-1',
        productId: 'p-1',
        productName: 'Widget',
        productSku: 'W-001',
        quantity: 10,
        receivedQuantity: 10,
      },
    ],
    hasDiscrepancy: false,
    discrepancyNotes: null,
    ...overrides,
  };
}

describe('InventoryTransferDetailsModal', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('renders a clean receipt with zero variance and no discrepancy block', () => {
    getByIdState = { data: buildDetail(), isLoading: false, error: null };

    render(
      <InventoryTransferDetailsModal
        isOpen
        transferId="transfer-1"
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.queryByText('Discrepancy notes')).not.toBeInTheDocument();
    // Both Shipped and Received columns are rendered, each showing 10.
    const tens = screen.getAllByText('10');
    expect(tens.length).toBeGreaterThanOrEqual(2);
  });

  it('shows the discrepancy notes block and a negative variance badge when received < shipped', () => {
    getByIdState = {
      data: buildDetail({
        hasDiscrepancy: true,
        discrepancyNotes: 'Box arrived damaged',
        items: [
          {
            id: 'item-1',
            productId: 'p-1',
            productName: 'Widget',
            productSku: 'W-001',
            quantity: 10,
            receivedQuantity: 7,
          },
        ],
      }),
      isLoading: false,
      error: null,
    };

    render(
      <InventoryTransferDetailsModal
        isOpen
        transferId="transfer-1"
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Discrepancy notes')).toBeInTheDocument();
    expect(screen.getByText('Box arrived damaged')).toBeInTheDocument();
    // Shipped 10, Received 7, Variance -3 — the variance cell is the only
    // place "-3" appears in the document, so assert on it directly.
    expect(screen.getByText('-3')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('renders a pending-receipt placeholder when the transfer is still in transit', () => {
    getByIdState = {
      data: buildDetail({
        status: 'in_transit',
        receivedAt: null,
        receivedBy: null,
        items: [
          {
            id: 'item-1',
            productId: 'p-1',
            productName: 'Widget',
            productSku: 'W-001',
            quantity: 10,
            receivedQuantity: null,
          },
        ],
      }),
      isLoading: false,
      error: null,
    };

    render(
      <InventoryTransferDetailsModal
        isOpen
        transferId="transfer-1"
        onClose={() => {}}
      />
    );

    // Both "Received" and "Variance" should use the em-dash placeholder.
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });
});
