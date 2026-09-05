import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@/test/utils';
import i18next from '@/i18n';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  profiles: {
    data: { items: [], nextCursor: null } as {
      items: Array<Record<string, unknown>>;
      nextCursor: null | { effectiveFrom: string; id: string };
    },
    isPending: false,
    isFetching: false,
    error: null as unknown,
  },
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: { id: 'site-1' } }),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      workforce: { payroll: { profiles: { invalidate: mocks.invalidate } } },
      auditLogs: { invalidate: mocks.invalidate },
    }),
    sites: {
      list: {
        useQuery: () => ({
          data: { items: [{ id: 'site-1', name: 'Central', isActive: true }] },
          error: null,
          refetch: mocks.refetch,
        }),
      },
    },
    users: {
      list: {
        useQuery: () => ({
          data: {
            items: [{ id: 'worker-1', name: 'Ana Worker', role: 'cashier' }],
            totalPages: 1,
          },
          isFetching: false,
          error: null,
          refetch: mocks.refetch,
        }),
      },
    },
    workforce: {
      payroll: {
        profiles: {
          list: { useQuery: () => ({ ...mocks.profiles, refetch: mocks.refetch }) },
          events: {
            useQuery: () => ({
              data: { items: [], nextCursor: null },
              isPending: false,
              error: null,
            }),
          },
        },
      },
    },
  },
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => ({
    mutateAsync: path === 'workforce.payroll.profiles.create' ? mocks.create : vi.fn(),
    isPending: false,
  }),
}));

import { PayrollProfilesPanel } from './PayrollProfilesPanel';

beforeEach(async () => {
  await i18next.changeLanguage('en');
  mocks.create.mockReset().mockResolvedValue({ id: 'profile-1', siteId: 'site-1', version: 1 });
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.refetch.mockReset().mockResolvedValue(undefined);
  mocks.profiles.data = { items: [], nextCursor: null };
  mocks.profiles.error = null;
});

describe('PayrollProfilesPanel', () => {
  it('creates one explicit private profile without inventing optional evidence', async () => {
    const user = userEvent.setup();
    render(<PayrollProfilesPanel />);
    await user.click(screen.getByRole('button', { name: 'Create payroll profile' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Employee'), 'worker-1');
    await user.type(within(dialog).getByLabelText('Effective from'), '2026-08-01');
    await user.type(within(dialog).getByLabelText('Identification number'), '123456789');
    await user.type(
      within(dialog).getByLabelText('Private review reason'),
      'Reviewed employee contribution evidence'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(mocks.create).toHaveBeenCalledWith({
      profile: expect.objectContaining({
        userId: 'worker-1',
        siteId: 'site-1',
        countryCode: 'CO',
        identificationType: 'CC',
        identificationNumber: '123456789',
        contributorType: '01',
        contributorSubtype: null,
        healthEntity: null,
        pensionEntity: null,
        compensationFund: null,
        paymentMethod: 'cash',
        paymentAccountLast4: null,
        effectiveFrom: '2026-08-01',
        effectiveUntil: null,
      }),
      reason: 'Reviewed employee contribution evidence',
    });
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('surfaces a safe localized write failure and keeps the editor open', async () => {
    mocks.create.mockRejectedValue({ data: { errorCode: 'PAYROLL_PROFILE_OVERLAP' } });
    const user = userEvent.setup();
    render(<PayrollProfilesPanel />);
    await user.click(screen.getByRole('button', { name: 'Create payroll profile' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Employee'), 'worker-1');
    await user.type(within(dialog).getByLabelText('Effective from'), '2026-08-01');
    await user.type(within(dialog).getByLabelText('Identification number'), '123456789');
    await user.type(
      within(dialog).getByLabelText('Private review reason'),
      'Reviewed overlapping evidence'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "Another payroll profile already covers part of this effective period. Review the employee's profiles."
    );
    expect(within(dialog).queryByText(/SQLITE|PAYROLL_PROFILE_OVERLAP/)).not.toBeInTheDocument();
  });
});
