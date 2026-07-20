import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render } from '@/test/utils';
import type { QuotationListEntry } from '@/types';
import { QuotationsHistoryTable } from './QuotationsHistoryTable';

type ListResult = {
  data: { items: QuotationListEntry[] } | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

let listResult: ListResult;

interface MutationOptions {
  onSuccess?: () => unknown | Promise<unknown>;
  onError?: (error: unknown) => unknown;
}

const statusMutationState = {
  mutate: vi.fn(),
  reset: vi.fn(),
  isPending: false,
};

const deleteMutationState = {
  mutate: vi.fn(),
  reset: vi.fn(),
  isPending: false,
};

const listInvalidate = vi.fn(async () => undefined);
const detailInvalidate = vi.fn(async () => undefined);
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      quotations: {
        list: { invalidate: listInvalidate },
        getById: { invalidate: detailInvalidate },
      },
    }),
    quotations: {
      list: { useQuery: () => listResult },
      updateStatus: {
        useMutation: (_opts: MutationOptions) => statusMutationState,
      },
      delete: {
        useMutation: (_opts: MutationOptions) => deleteMutationState,
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

const draftEntry: QuotationListEntry = {
  id: 'q-1',
  quotationNumber: 'COT-000001',
  status: 'draft',
  customerId: 'c-1',
  customerName: 'Acme Corp',
  siteId: 'site-1',
  siteName: 'Main Site',
  subtotal: 100,
  taxAmount: 19,
  total: 119,
  itemCount: 2,
  validUntil: null,
  createdAt: new Date('2026-04-15T10:00:00Z').toISOString(),
  createdBy: 'user-1',
};

const sentEntry: QuotationListEntry = {
  ...draftEntry,
  id: 'q-2',
  quotationNumber: 'COT-000002',
  status: 'sent',
  customerName: null, // walk-in
};

const rejectedEntry: QuotationListEntry = {
  ...draftEntry,
  id: 'q-3',
  quotationNumber: 'COT-000003',
  status: 'rejected',
};

function setListResult(items: QuotationListEntry[]): void {
  listResult = {
    data: { items },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('QuotationsHistoryTable', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('renders the empty state when there are no quotations', () => {
    setListResult([]);
    render(<QuotationsHistoryTable onOpenDetails={() => {}} />);
    expect(
      screen.getByText('No quotations yet. Click New quotation to create the first one.')
    ).toBeInTheDocument();
  });

  it('lists quotations with their status badge and customer name (or walk-in placeholder)', () => {
    setListResult([draftEntry, sentEntry]);
    render(<QuotationsHistoryTable onOpenDetails={() => {}} />);

    expect(screen.getByText('COT-000001')).toBeInTheDocument();
    expect(screen.getByText('COT-000002')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Walk-in')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });

  it('renders the smallest useful column set — site / items / valid-until / created-at trimmed', () => {
    setListResult([draftEntry]);
    render(<QuotationsHistoryTable onOpenDetails={() => {}} />);

    // Core columns stay.
    expect(screen.getByRole('columnheader', { name: 'Number' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Customer' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Total' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();

    // Trimmed columns are gone (reachable via the View detail modal).
    expect(screen.queryByRole('columnheader', { name: 'Site' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Items' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Valid until' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Created at' })).not.toBeInTheDocument();
  });

  it('exposes draft transition actions (Send, Reject, Expire) and a Delete on draft rows', () => {
    setListResult([draftEntry]);
    render(<QuotationsHistoryTable onOpenDetails={() => {}} />);

    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expire' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('omits the Delete action on non-draft rows', () => {
    setListResult([sentEntry]);
    render(<QuotationsHistoryTable onOpenDetails={() => {}} />);

    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('renders no transition actions on a terminal status (rejected)', () => {
    setListResult([rejectedEntry]);
    render(<QuotationsHistoryTable onOpenDetails={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expire' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    // The view (Details) button is always present.
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument();
  });

  it('forwards the row id to onOpenDetails when Details is clicked', async () => {
    setListResult([draftEntry]);
    const onOpenDetails = vi.fn();
    render(<QuotationsHistoryTable onOpenDetails={onOpenDetails} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(onOpenDetails).toHaveBeenCalledWith('q-1');
  });

  it('fires onOpenDetails when Enter is pressed on a focused row', async () => {
    setListResult([draftEntry]);
    const onOpenDetails = vi.fn();
    render(<QuotationsHistoryTable onOpenDetails={onOpenDetails} />);

    const user = userEvent.setup();
    const row = screen.getByRole('row', { name: /COT-000001/ });
    row.focus();
    await user.keyboard('{Enter}');

    expect(onOpenDetails).toHaveBeenCalledTimes(1);
    expect(onOpenDetails).toHaveBeenCalledWith('q-1');
  });

  it('fires the status mutation with the chosen transition', async () => {
    setListResult([draftEntry]);
    statusMutationState.mutate.mockClear();
    render(<QuotationsHistoryTable onOpenDetails={() => {}} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(statusMutationState.mutate).toHaveBeenCalledWith({
      id: 'q-1',
      status: 'sent',
    });
  });

  it('opens the confirm modal before deleting and dispatches the mutation on confirm', async () => {
    setListResult([draftEntry]);
    deleteMutationState.mutate.mockClear();
    render(<QuotationsHistoryTable onOpenDetails={() => {}} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete quotation?')).toBeInTheDocument();

    // The confirm button uses the same label as the row action — narrow by
    // role text inside the dialog.
    const confirmButton = screen.getAllByRole('button', { name: 'Delete' }).at(-1);
    await user.click(confirmButton!);

    expect(deleteMutationState.mutate).toHaveBeenCalledWith({ id: 'q-1' });
  });
});
