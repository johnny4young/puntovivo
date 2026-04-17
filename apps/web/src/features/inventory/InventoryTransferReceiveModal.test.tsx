import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render } from '@/test/utils';
import type { TransferDetail } from '@/types';
import {
  InventoryTransferReceiveModal,
  type TransferReceiveSubmitPayload,
} from './InventoryTransferReceiveModal';

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

function buildDetail(
  lines: Array<{ id: string; productName: string; productSku: string; quantity: number }> = [
    { id: 'line-1', productName: 'Widget', productSku: 'W-001', quantity: 10 },
  ]
): TransferDetail {
  return {
    id: 'transfer-1',
    status: 'in_transit',
    fromSiteId: 'site-a',
    fromSiteName: 'Main',
    toSiteId: 'site-b',
    toSiteName: 'Branch',
    notes: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-04-15T10:00:00Z').toISOString(),
    receivedAt: null,
    receivedBy: null,
    updatedAt: new Date('2026-04-15T10:00:00Z').toISOString(),
    items: lines.map(line => ({
      id: line.id,
      productId: `p-${line.id}`,
      productName: line.productName,
      productSku: line.productSku,
      quantity: line.quantity,
      receivedQuantity: null,
    })),
    hasDiscrepancy: false,
    discrepancyNotes: null,
  };
}

describe('InventoryTransferReceiveModal', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('renders every shipped line with the shipped qty as the default received value', () => {
    getByIdState = { data: buildDetail(), isLoading: false, error: null };

    render(
      <InventoryTransferReceiveModal
        isOpen
        transferId="transfer-1"
        isSaving={false}
        submitError={null}
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );

    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Receive transfer' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Record the actual received quantities. Each line defaults to the shipped amount — lower any line if units are missing.'
      )
    ).toBeInTheDocument();
    const receivedInput = screen.getByRole('spinbutton', { name: /received quantity for widget/i });
    expect(receivedInput).toHaveValue(10);
  });

  it('submits the legacy payload (no lines, no notes) when the user accepts the defaults', async () => {
    getByIdState = { data: buildDetail(), isLoading: false, error: null };
    const handleSubmit = vi.fn<(payload: TransferReceiveSubmitPayload) => void>();

    render(
      <InventoryTransferReceiveModal
        isOpen
        transferId="transfer-1"
        isSaving={false}
        submitError={null}
        onClose={() => {}}
        onSubmit={handleSubmit}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Confirm receipt' }));

    expect(handleSubmit).toHaveBeenCalledTimes(1);
    expect(handleSubmit).toHaveBeenCalledWith({});
  });

  it('reveals the discrepancy notes field when a line is reduced and submits lines + notes', async () => {
    getByIdState = { data: buildDetail(), isLoading: false, error: null };
    const handleSubmit = vi.fn<(payload: TransferReceiveSubmitPayload) => void>();

    render(
      <InventoryTransferReceiveModal
        isOpen
        transferId="transfer-1"
        isSaving={false}
        submitError={null}
        onClose={() => {}}
        onSubmit={handleSubmit}
      />
    );

    const user = userEvent.setup();
    const receivedInput = screen.getByRole('spinbutton', { name: /received quantity for widget/i });
    await user.clear(receivedInput);
    await user.type(receivedInput, '7');

    // Discrepancy notes textarea only appears once a variance is entered.
    // The label wraps both the title and the help text, so match by regex.
    const notesField = await screen.findByLabelText(/discrepancy notes/i);
    await user.type(notesField, 'Box arrived damaged');

    // The short-qty badge shows up in the variance column.
    expect(screen.getByText('−3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm receipt' }));

    expect(handleSubmit).toHaveBeenCalledTimes(1);
    expect(handleSubmit).toHaveBeenCalledWith({
      lines: [{ itemId: 'line-1', receivedQuantity: 7 }],
      discrepancyNotes: 'Box arrived damaged',
    });
  });

  it('disables Confirm and shows an inline error when received exceeds shipped', async () => {
    getByIdState = { data: buildDetail(), isLoading: false, error: null };
    const handleSubmit = vi.fn<(payload: TransferReceiveSubmitPayload) => void>();

    render(
      <InventoryTransferReceiveModal
        isOpen
        transferId="transfer-1"
        isSaving={false}
        submitError={null}
        onClose={() => {}}
        onSubmit={handleSubmit}
      />
    );

    const user = userEvent.setup();
    const receivedInput = screen.getByRole('spinbutton', { name: /received quantity for widget/i });
    await user.clear(receivedInput);
    await user.type(receivedInput, '25');

    expect(
      screen.getByText('Received quantity cannot be greater than the shipped quantity.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm receipt' })).toBeDisabled();

    // Attempting to submit does not invoke onSubmit.
    await user.click(screen.getByRole('button', { name: 'Confirm receipt' }));
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('surfaces a submit error message from the server', () => {
    getByIdState = { data: buildDetail(), isLoading: false, error: null };

    render(
      <InventoryTransferReceiveModal
        isOpen
        transferId="transfer-1"
        isSaving={false}
        submitError="A received quantity cannot be greater than the shipped quantity."
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );

    expect(
      screen.getByText('A received quantity cannot be greater than the shipped quantity.')
    ).toBeInTheDocument();
  });

  it('drops discrepancy notes from the payload if the user restores every line to the shipped qty', async () => {
    getByIdState = { data: buildDetail(), isLoading: false, error: null };
    const handleSubmit = vi.fn<(payload: TransferReceiveSubmitPayload) => void>();

    render(
      <InventoryTransferReceiveModal
        isOpen
        transferId="transfer-1"
        isSaving={false}
        submitError={null}
        onClose={() => {}}
        onSubmit={handleSubmit}
      />
    );

    const user = userEvent.setup();
    const receivedInput = screen.getByRole('spinbutton', { name: /received quantity for widget/i });
    await user.clear(receivedInput);
    await user.type(receivedInput, '7');

    const notesField = await screen.findByLabelText(/discrepancy notes/i);
    await user.type(notesField, 'typed while investigating');

    await user.clear(receivedInput);
    await user.type(receivedInput, '10');

    expect(screen.queryByLabelText(/discrepancy notes/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm receipt' }));
    expect(handleSubmit).toHaveBeenCalledWith({});
  });

  it('clamps a cleared input to zero and reports the full line as shrinkage', async () => {
    getByIdState = { data: buildDetail(), isLoading: false, error: null };
    const handleSubmit = vi.fn<(payload: TransferReceiveSubmitPayload) => void>();

    render(
      <InventoryTransferReceiveModal
        isOpen
        transferId="transfer-1"
        isSaving={false}
        submitError={null}
        onClose={() => {}}
        onSubmit={handleSubmit}
      />
    );

    const user = userEvent.setup();
    const receivedInput = screen.getByRole('spinbutton', { name: /received quantity for widget/i });
    await user.clear(receivedInput);

    // Cleared input is valid (parses to 0) → Confirm stays enabled.
    expect(screen.getByRole('button', { name: 'Confirm receipt' })).not.toBeDisabled();
    // Shortage badge reads -10 (the entire shipped quantity).
    expect(screen.getByText('−10')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm receipt' }));
    expect(handleSubmit).toHaveBeenCalledWith({
      lines: [{ itemId: 'line-1', receivedQuantity: 0 }],
    });
  });
});
