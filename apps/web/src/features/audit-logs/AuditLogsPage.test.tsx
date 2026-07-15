import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render } from '@/test/utils';
import { AuditLogsPage } from './AuditLogsPage';

const mocks = vi.hoisted(() => ({
  listUseQuery: vi.fn(),
  summaryUseQuery: vi.fn(),
  summaryRefetch: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    auditLogs: {
      list: {
        useQuery: mocks.listUseQuery,
      },
      sensitiveSummary: {
        useQuery: mocks.summaryUseQuery,
      },
    },
  },
}));

describe('AuditLogsPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.listUseQuery.mockReturnValue({
      data: { items: [] },
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    });
    mocks.summaryUseQuery.mockReturnValue({
      data: {
        total: 6,
        categories: [
          { category: 'privacy', count: 2, latestAt: '2026-01-11T10:00:00.000Z' },
          { category: 'access', count: 1, latestAt: '2026-01-12T10:00:00.000Z' },
          { category: 'money', count: 1, latestAt: '2026-01-13T10:00:00.000Z' },
          { category: 'inventory', count: 1, latestAt: '2026-01-15T10:00:00.000Z' },
          { category: 'ai', count: 1, latestAt: '2026-01-16T10:00:00.000Z' },
        ],
      },
      error: null,
      isLoading: false,
      refetch: mocks.summaryRefetch,
    });
    await i18next.changeLanguage('en');
  });

  it('filters immutable history by a review category and clears it for an action', async () => {
    const user = userEvent.setup();
    render(<AuditLogsPage />);

    const privacyCard = screen.getByTestId('audit-review-privacy');
    await user.click(privacyCard);

    expect(privacyCard).toHaveAttribute('aria-pressed', 'true');
    expect(mocks.listUseQuery).toHaveBeenLastCalledWith(
      { sensitiveCategory: 'privacy' },
      { staleTime: 30_000 }
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Action' }), 'sale.void');

    expect(privacyCard).toHaveAttribute('aria-pressed', 'false');
    expect(mocks.listUseQuery).toHaveBeenLastCalledWith(
      { action: 'sale.void' },
      { staleTime: 30_000 }
    );
  });

  it('keeps review counts aligned with the visible date range', async () => {
    const user = userEvent.setup();
    render(<AuditLogsPage />);

    await user.type(screen.getByLabelText('From'), '2026-01-12');
    await user.type(screen.getByLabelText('To'), '2026-01-15');

    const dateRange = {
      createdAfter: new Date('2026-01-12T00:00:00').toISOString(),
      createdBefore: new Date('2026-01-15T23:59:59').toISOString(),
    };
    expect(mocks.summaryUseQuery).toHaveBeenLastCalledWith(dateRange, {
      staleTime: 30_000,
    });
    expect(mocks.listUseQuery).toHaveBeenLastCalledWith(dateRange, {
      staleTime: 30_000,
    });
  });

  it('offers customer personal-data exports as an action filter', () => {
    render(<AuditLogsPage />);

    const actionFilter = screen.getByRole('combobox', { name: 'Action' });
    expect(
      within(actionFilter).getByRole('option', {
        name: 'Customer personal data exported',
      })
    ).toHaveValue('customer.personal_data.export');
    expect(screen.getByRole('option', { name: 'Customer personal data deleted' })).toHaveValue(
      'customer.personal_data.delete'
    );
    expect(screen.getByRole('option', { name: 'Customer personal data anonymized' })).toHaveValue(
      'customer.personal_data.anonymize'
    );
  });

  it('offers data-retention evidence as action and resource filters', () => {
    render(<AuditLogsPage />);

    const actionFilter = screen.getByRole('combobox', { name: 'Action' });
    expect(
      within(actionFilter).getByRole('option', {
        name: 'Data retention policy updated',
      })
    ).toHaveValue('data_retention.policy.updated');
    expect(
      within(actionFilter).getByRole('option', {
        name: 'Expired support data deleted',
      })
    ).toHaveValue('data_retention.sweep.run');

    const resourceFilter = screen.getByRole('combobox', { name: 'Resource type' });
    expect(within(resourceFilter).getByRole('option', { name: 'Tenant' })).toHaveValue('tenant');
  });

  it('offers backup restore-drill evidence as action and resource filters', () => {
    render(<AuditLogsPage />);

    const actionFilter = screen.getByRole('combobox', { name: 'Action' });
    expect(
      within(actionFilter).getByRole('option', {
        name: 'Backup restore drill run',
      })
    ).toHaveValue('backup.restore_drill');

    const resourceFilter = screen.getByRole('combobox', { name: 'Resource type' });
    expect(within(resourceFilter).getByRole('option', { name: 'Backup snapshot' })).toHaveValue(
      'backup_snapshot'
    );
  });

  it('offers staff PIN lifecycle and cashier-switch actions', () => {
    render(<AuditLogsPage />);

    const actionFilter = screen.getByRole('combobox', { name: 'Action' });
    expect(
      within(actionFilter).getByRole('option', {
        name: 'Staff PIN updated',
      })
    ).toHaveValue('user.pin.update');
    expect(
      within(actionFilter).getByRole('option', {
        name: 'Cashier switched',
      })
    ).toHaveValue('auth.staff_switch');
  });
});
