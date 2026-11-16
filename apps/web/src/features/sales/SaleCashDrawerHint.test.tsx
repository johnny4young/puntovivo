import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ kind: string; config: Record<string, unknown> | null }>,
  site: { id: 'site-1' } as { id: string } | null,
  useQuery: vi.fn(),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: mocks.site }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: { peripherals: { activeForSite: { useQuery: mocks.useQuery } } },
}));

import { SaleCashDrawerHint } from './SaleCashDrawerHint';

beforeEach(() => {
  mocks.site = { id: 'site-1' };
  mocks.rows = [];
  mocks.useQuery.mockImplementation(() => ({ data: mocks.rows }));
});

describe('SaleCashDrawerHint', () => {
  it('announces the drawer when the receipt prints on completion and kicks it', () => {
    mocks.rows = [
      { kind: 'printer', config: { autoPrintOnComplete: true, kickDrawerAfterReceipt: true } },
    ];
    render(<SaleCashDrawerHint />);

    expect(screen.getByTestId('sale-cash-drawer-hint')).toHaveTextContent(
      'The drawer opens when you confirm'
    );
    expect(mocks.useQuery).toHaveBeenCalledWith(
      { siteId: 'site-1' },
      { enabled: true, staleTime: 300_000 }
    );
  });

  it.each([
    ['no printer', []],
    [
      'a printer that does not print on completion',
      [{ kind: 'printer', config: { autoPrintOnComplete: false, kickDrawerAfterReceipt: true } }],
    ],
    [
      'a printer that does not kick the drawer',
      [{ kind: 'printer', config: { autoPrintOnComplete: true } }],
    ],
    ['a drawer without a printer', [{ kind: 'cash_drawer', config: null }]],
  ])('stays silent with %s', (_label, rows) => {
    mocks.rows = rows;
    render(<SaleCashDrawerHint />);

    expect(screen.queryByTestId('sale-cash-drawer-hint')).not.toBeInTheDocument();
  });

  it('does not query without an active site', () => {
    mocks.site = null;
    render(<SaleCashDrawerHint />);

    expect(mocks.useQuery).toHaveBeenCalledWith(
      { siteId: '' },
      expect.objectContaining({ enabled: false })
    );
  });
});
