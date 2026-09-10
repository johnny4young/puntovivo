import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import i18next from '@/i18n';

const mocks = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'manager',
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1', tenantId: 'tenant-1', role: mocks.role } }),
}));
vi.mock('./PayrollProfilesPanel', () => ({
  PayrollProfilesPanel: () => <p>profiles-view</p>,
}));
vi.mock('./PayrollPeriodsPanel', () => ({
  PayrollPeriodsPanel: ({ onOpenRuns }: { onOpenRuns: (period: object) => void }) => (
    <button
      type="button"
      onClick={() =>
        onOpenRuns({
          id: 'period-1',
          tenantId: 'tenant-1',
          countryCode: 'CO',
          frequency: 'monthly',
          fromDate: '2026-08-01',
          untilDate: '2026-09-01',
          payDate: '2026-09-05',
          currencyCode: 'COP',
          status: 'open',
          version: 1,
        })
      }
    >
      periods-view
    </button>
  ),
}));
vi.mock('./PayrollRunsPanel', () => ({
  PayrollRunsPanel: () => <p>runs-view</p>,
}));

import { PayrollPanel } from './PayrollPanel';

beforeEach(async () => {
  mocks.role = 'admin';
  await i18next.changeLanguage('en');
});

describe('PayrollPanel', () => {
  it('keeps periods, profiles and one selected run workspace in an explicit admin flow', async () => {
    const user = userEvent.setup();
    render(<PayrollPanel />);
    expect(screen.getByRole('heading', { name: 'Colombia pre-payroll' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'periods-view' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Employee profiles' }));
    expect(await screen.findByText('profiles-view')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Periods and runs' }));
    await user.click(await screen.findByRole('button', { name: 'periods-view' }));
    expect(await screen.findByText('runs-view')).toBeInTheDocument();
  });

  it('does not mount private payroll queries for a non-administrator', () => {
    mocks.role = 'manager';
    render(<PayrollPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Only administrators can access private pre-payroll evidence.'
    );
    expect(screen.queryByText('periods-view')).not.toBeInTheDocument();
  });
});
