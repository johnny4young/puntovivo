import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { render } from '@/test/utils';

const mocks = vi.hoisted(() => ({
  getState: 'success' as 'success' | 'loading' | 'error',
  previewTotal: 4,
  savePending: false,
  getRefetch: vi.fn(),
  invalidateGet: vi.fn(),
  invalidatePreview: vi.fn(),
  save: vi.fn(),
  run: vi.fn(),
  toastSuccess: vi.fn(),
}));

const policy = {
  operationalAuditDays: 1825,
  privacyAuditDays: 1825,
  aiAuditDays: 180,
  syncedOutboxDays: 30,
};

const limits = {
  operationalAuditDays: { min: 365, max: 3650 },
  privacyAuditDays: { min: 365, max: 3650 },
  aiAuditDays: { min: 30, max: 730 },
  syncedOutboxDays: { min: 7, max: 365 },
};

const settingsData = { policy, defaults: policy, limits };

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      dataRetention: {
        get: { invalidate: mocks.invalidateGet },
        preview: { invalidate: mocks.invalidatePreview },
      },
    }),
    dataRetention: {
      get: {
        useQuery: () => ({
          data: mocks.getState === 'success' ? settingsData : undefined,
          isLoading: mocks.getState === 'loading',
          error: mocks.getState === 'error' ? new Error('retention unavailable') : null,
          refetch: mocks.getRefetch,
        }),
      },
      preview: {
        useQuery: () => ({
          data: {
            policy,
            evaluatedAt: '2026-07-14T12:00:00.000Z',
            operationalAuditLogs: {
              cutoff: '2021-07-15T12:00:00.000Z',
              count: mocks.previewTotal,
            },
            privacyAuditLogs: {
              cutoff: '2021-07-15T12:00:00.000Z',
              count: 0,
            },
            aiAuditLogs: { cutoff: '2026-01-15T12:00:00.000Z', count: 0 },
            syncedOutboxRows: {
              cutoff: '2026-06-14T12:00:00.000Z',
              count: 0,
            },
            total: mocks.previewTotal,
          },
          isLoading: false,
          error: null,
        }),
      },
      update: {
        useMutation: (options: { onSuccess?: () => Promise<void> }) => ({
          mutateAsync: async (input: unknown) => {
            mocks.save(input);
            await options.onSuccess?.();
          },
          isPending: mocks.savePending,
        }),
      },
      runNow: {
        useMutation: (options: {
          onSuccess?: (result: { deleted: { total: number } }) => Promise<void>;
        }) => ({
          mutateAsync: async () => {
            mocks.run();
            await options.onSuccess?.({ deleted: { total: mocks.previewTotal } });
          },
          isPending: false,
        }),
      },
    },
  },
}));

import { CompanyDataRetentionCard } from '../CompanyDataRetentionCard';

describe('CompanyDataRetentionCard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.getState = 'success';
    mocks.previewTotal = 4;
    mocks.savePending = false;
    await i18n.changeLanguage('en');
  });

  it('renders the bounded policy, cleanup preview, and authoritative-data safeguard', async () => {
    render(<CompanyDataRetentionCard />);

    expect(await screen.findByRole('heading', { name: 'Data retention' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /Operational audit history/i })).toHaveValue(
      1825
    );
    expect(screen.getByRole('spinbutton', { name: /AI usage telemetry/i })).toHaveAttribute(
      'min',
      '30'
    );
    expect(screen.getByTestId('retention-preview-total')).toHaveTextContent('4 eligible rows');
    expect(
      screen.getByText(/Sales, fiscal documents, payments, cash sessions/i)
    ).toBeInTheDocument();
  });

  it('blocks an invalid privacy floor and saves the corrected whole policy', async () => {
    const user = userEvent.setup();
    render(<CompanyDataRetentionCard />);

    const operational = await screen.findByRole('spinbutton', {
      name: /Operational audit history/i,
    });
    const privacy = screen.getByRole('spinbutton', {
      name: /Privacy-request evidence/i,
    });

    await user.clear(operational);
    await user.type(operational, '2000');
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be retained for less time/i);
    expect(screen.getByRole('button', { name: 'Save retention policy' })).toBeDisabled();

    await user.clear(privacy);
    await user.type(privacy, '2000');
    await user.click(screen.getByRole('button', { name: 'Save retention policy' }));

    expect(mocks.save).toHaveBeenCalledWith({
      ...policy,
      operationalAuditDays: 2000,
      privacyAuditDays: 2000,
    });
    expect(mocks.invalidateGet).toHaveBeenCalledTimes(1);
    expect(mocks.invalidatePreview).toHaveBeenCalledTimes(1);
  });

  it('locks policy inputs while a save is pending so later edits are not discarded', async () => {
    mocks.savePending = true;
    render(<CompanyDataRetentionCard />);

    expect(
      await screen.findByRole('spinbutton', { name: /Operational audit history/i })
    ).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: /AI usage telemetry/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving policy...' })).toBeDisabled();
  });

  it('requires confirmation before deleting eligible support data', async () => {
    const user = userEvent.setup();
    render(<CompanyDataRetentionCard />);

    await user.click(await screen.findByRole('button', { name: 'Run cleanup now' }));
    expect(mocks.run).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/permanently deletes 4 eligible rows/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete expired data' }));

    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.toastSuccess).toHaveBeenCalledWith({ title: '4 expired rows deleted' });
  });

  it('renders loading and recoverable error states', async () => {
    mocks.getState = 'loading';
    const { rerender } = render(<CompanyDataRetentionCard />);
    expect(screen.getByText('Loading the retention policy...')).toBeInTheDocument();

    mocks.getState = 'error';
    rerender(<CompanyDataRetentionCard />);
    await userEvent.setup().click(screen.getByRole('button', { name: /retry/i }));
    expect(mocks.getRefetch).toHaveBeenCalledTimes(1);
  });
});
