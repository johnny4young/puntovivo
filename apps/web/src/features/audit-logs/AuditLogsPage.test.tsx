import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { render } from '@/test/utils';
import { AuditLogsPage } from './AuditLogsPage';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    auditLogs: {
      list: {
        useQuery: vi.fn(() => ({
          data: { items: [] },
          error: null,
          isLoading: false,
          refetch: vi.fn(),
        })),
      },
    },
  },
}));

describe('AuditLogsPage', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
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
});
