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
  verifyChainUseQuery: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
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
      verifyChain: {
        useQuery: mocks.verifyChainUseQuery,
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
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
    mocks.verifyChainUseQuery.mockReturnValue({
      data: undefined,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({ data: undefined, error: null }),
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

  it('reports external rewind protection separately from a sealed head', async () => {
    const user = userEvent.setup();
    mocks.verifyChainUseQuery.mockReturnValue({
      data: undefined,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        error: null,
        data: {
          valid: true,
          checkedCount: 42,
          unchainedCount: 1,
          anchored: true,
          freshnessAnchored: true,
        },
      }),
    });
    render(<AuditLogsPage />);

    await user.click(screen.getByTestId('audit-verify-chain'));

    expect(mocks.toastSuccess).toHaveBeenCalledWith({
      title: 'Audit chain intact and rewind-protected',
      description:
        'Chained entries verified against the authenticated head and external monotonic counter: 42. Entries predating the chain: 1.',
    });
  });

  it('does not overclaim rewind protection for an HMAC-only head', async () => {
    const user = userEvent.setup();
    mocks.verifyChainUseQuery.mockReturnValue({
      data: undefined,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        error: null,
        data: {
          valid: true,
          checkedCount: 7,
          unchainedCount: 0,
          anchored: true,
          freshnessAnchored: false,
        },
      }),
    });
    render(<AuditLogsPage />);

    await user.click(screen.getByTestId('audit-verify-chain'));

    expect(mocks.toastSuccess).toHaveBeenCalledWith({
      title: 'Audit chain intact with a sealed head',
      description:
        'Chained entries verified against the authenticated head: 7. Entries predating the chain: 0. External rewind protection is not configured.',
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

  it('offers launch import evidence as action and resource filters', () => {
    render(<AuditLogsPage />);

    const actionFilter = screen.getByRole('combobox', { name: 'Action' });
    expect(
      within(actionFilter).getByRole('option', {
        name: 'Product launch data imported',
      })
    ).toHaveValue('data_import.products');
    expect(
      within(actionFilter).getByRole('option', {
        name: 'Customer launch data imported',
      })
    ).toHaveValue('data_import.customers');
    expect(
      within(actionFilter).getByRole('option', {
        name: 'Supplier launch data imported',
      })
    ).toHaveValue('data_import.providers');
    expect(
      within(actionFilter).getByRole('option', {
        name: 'Customer opening receivables imported',
      })
    ).toHaveValue('data_import.customer_balances');
    expect(
      within(actionFilter).getByRole('option', {
        name: 'Register opening cash imported',
      })
    ).toHaveValue('data_import.opening_cash');
    expect(
      within(actionFilter).getByRole('option', {
        name: 'Fiscal profile imported',
      })
    ).toHaveValue('data_import.fiscal_profile');

    const resourceFilter = screen.getByRole('combobox', { name: 'Resource type' });
    expect(within(resourceFilter).getByRole('option', { name: 'Data import' })).toHaveValue(
      'data_import'
    );
  });

  it('offers signed day-close evidence as action and resource filters', () => {
    render(<AuditLogsPage />);

    const actionFilter = screen.getByRole('combobox', { name: 'Action' });
    expect(within(actionFilter).getByRole('option', { name: 'Day close signed' })).toHaveValue(
      'day_close.sign_off'
    );

    const resourceFilter = screen.getByRole('combobox', { name: 'Resource type' });
    expect(within(resourceFilter).getByRole('option', { name: 'Signed day close' })).toHaveValue(
      'day_close_signoff'
    );
  });

  it('offers webhook custody and recovery evidence as action and resource filters', () => {
    render(<AuditLogsPage />);

    const actionFilter = screen.getByRole('combobox', { name: 'Action' });
    expect(
      within(actionFilter).getByRole('option', { name: 'Webhook destination created' })
    ).toHaveValue('webhook_subscription.create');
    expect(
      within(actionFilter).getByRole('option', { name: 'Webhook destination disabled' })
    ).toHaveValue('webhook_subscription.disable');
    expect(
      within(actionFilter).getByRole('option', { name: 'Webhook destination revoked' })
    ).toHaveValue('webhook_subscription.revoke');
    expect(
      within(actionFilter).getByRole('option', { name: 'Webhook delivery retry queued' })
    ).toHaveValue('webhook_delivery.retry');

    const resourceFilter = screen.getByRole('combobox', { name: 'Resource type' });
    expect(within(resourceFilter).getByRole('option', { name: 'Webhook destination' })).toHaveValue(
      'webhook_subscription'
    );
    expect(within(resourceFilter).getByRole('option', { name: 'Webhook delivery' })).toHaveValue(
      'webhook_outbox'
    );
  });

  it('offers audited Co-pilot response-mode changes as an AI action filter', () => {
    render(<AuditLogsPage />);

    const actionFilter = screen.getByRole('combobox', { name: 'Action' });
    expect(
      within(actionFilter).getByRole('option', { name: 'Co-pilot response mode updated' })
    ).toHaveValue('ai.copilot.response_mode.updated');
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

  it('offers employee clock-in/out evidence as action and resource filters', () => {
    render(<AuditLogsPage />);

    const actionFilter = screen.getByRole('combobox', { name: 'Action' });
    expect(within(actionFilter).getByRole('option', { name: 'Employee clocked in' })).toHaveValue(
      'employee_shift.clock_in'
    );
    expect(within(actionFilter).getByRole('option', { name: 'Employee clocked out' })).toHaveValue(
      'employee_shift.clock_out'
    );

    const resourceFilter = screen.getByRole('combobox', { name: 'Resource type' });
    expect(within(resourceFilter).getByRole('option', { name: 'Employee shift' })).toHaveValue(
      'employee_shift'
    );
  });

  it('offers employee-break lifecycle evidence as action and resource filters', () => {
    render(<AuditLogsPage />);

    const actionFilter = screen.getByRole('combobox', { name: 'Action' });
    expect(
      within(actionFilter).getByRole('option', { name: 'Employee break started' })
    ).toHaveValue('employee_shift_break.start');
    expect(within(actionFilter).getByRole('option', { name: 'Employee break ended' })).toHaveValue(
      'employee_shift_break.end'
    );

    const resourceFilter = screen.getByRole('combobox', { name: 'Resource type' });
    expect(within(resourceFilter).getByRole('option', { name: 'Employee break' })).toHaveValue(
      'employee_shift_break'
    );
  });

  it('offers scheduled-shift lifecycle evidence as action and resource filters', () => {
    render(<AuditLogsPage />);

    const actionFilter = screen.getByRole('combobox', { name: 'Action' });
    expect(
      within(actionFilter).getByRole('option', { name: 'Scheduled shift created' })
    ).toHaveValue('scheduled_shift.create');
    expect(
      within(actionFilter).getByRole('option', { name: 'Scheduled shift updated' })
    ).toHaveValue('scheduled_shift.update');
    expect(
      within(actionFilter).getByRole('option', { name: 'Scheduled shift cancelled' })
    ).toHaveValue('scheduled_shift.cancel');

    const resourceFilter = screen.getByRole('combobox', { name: 'Resource type' });
    expect(within(resourceFilter).getByRole('option', { name: 'Scheduled shift' })).toHaveValue(
      'scheduled_shift'
    );
  });

  it.each([
    ['en', 'Action', 'Shift exchange decision recorded', 'Resource type', 'Shift exchange'],
    [
      'es',
      'Acción',
      'Decisión de intercambio de turnos registrada',
      'Tipo de recurso',
      'Intercambio de turnos',
    ],
  ])(
    'offers exchange evidence filters in %s',
    async (language, action, label, resource, exchange) => {
      await i18next.changeLanguage(language);
      render(<AuditLogsPage />);
      expect(
        within(screen.getByRole('combobox', { name: action })).getByRole('option', { name: label })
      ).toHaveValue('shift_swap.changed');
      expect(
        within(screen.getByRole('combobox', { name: resource })).getByRole('option', {
          name: exchange,
        })
      ).toHaveValue('shift_swap');
    }
  );

  it.each([
    ['en', 'Action', 'Schedule plan decision recorded', 'Resource type', 'Schedule plan'],
    [
      'es',
      'Acción',
      'Decisión de plan de horarios registrada',
      'Tipo de recurso',
      'Plan de horarios',
    ],
  ])(
    'offers schedule plan evidence filters in %s',
    async (language, action, label, resource, plan) => {
      await i18next.changeLanguage(language);
      render(<AuditLogsPage />);
      expect(
        within(screen.getByRole('combobox', { name: action })).getByRole('option', { name: label })
      ).toHaveValue('schedule_plan.changed');
      expect(
        within(screen.getByRole('combobox', { name: resource })).getByRole('option', { name: plan })
      ).toHaveValue('schedule_plan');
    }
  );

  it.each([
    ['en', 'Action', 'Employment terms changed', 'Resource type', 'Employment contract'],
    ['es', 'Acción', 'Condiciones laborales modificadas', 'Tipo de recurso', 'Contrato laboral'],
  ])(
    'offers safe employment evidence filters in %s',
    async (language, action, label, resource, contract) => {
      await i18next.changeLanguage(language);
      const user = userEvent.setup();
      render(<AuditLogsPage />);
      const actionFilter = screen.getByRole('combobox', { name: action });
      const resourceFilter = screen.getByRole('combobox', { name: resource });
      expect(within(actionFilter).getByRole('option', { name: label })).toHaveValue(
        'employment_contract.changed'
      );
      expect(within(resourceFilter).getByRole('option', { name: contract })).toHaveValue(
        'employment_contract'
      );
      await user.selectOptions(actionFilter, 'employment_contract.changed');
      await user.selectOptions(resourceFilter, 'employment_contract');
      expect(mocks.listUseQuery).toHaveBeenLastCalledWith(
        expect.objectContaining({
          action: 'employment_contract.changed',
          resourceType: 'employment_contract',
        }),
        { staleTime: 30_000 }
      );
    }
  );

  it('offers manager approval lifecycle evidence as action and resource filters', () => {
    render(<AuditLogsPage />);

    const actionFilter = screen.getByRole('combobox', { name: 'Action' });
    expect(
      within(actionFilter).getByRole('option', { name: 'Manager approval requested' })
    ).toHaveValue('manager_approval.request');
    expect(
      within(actionFilter).getByRole('option', { name: 'Manager approval granted' })
    ).toHaveValue('manager_approval.approve');
    expect(
      within(actionFilter).getByRole('option', { name: 'Manager approval rejected' })
    ).toHaveValue('manager_approval.reject');
    expect(
      within(actionFilter).getByRole('option', { name: 'Manager approval cancelled' })
    ).toHaveValue('manager_approval.cancel');

    const resourceFilter = screen.getByRole('combobox', { name: 'Resource type' });
    expect(within(resourceFilter).getByRole('option', { name: 'Manager approval' })).toHaveValue(
      'manager_approval'
    );
  });
});
