import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { todayFixture } from '@/features/dashboard/today/fixtures';
import type { MorningRecap } from '../morningModel';

const { todayData, recapData, queueItems } = vi.hoisted(() => ({
  todayData: { current: null as unknown },
  recapData: { current: null as unknown },
  queueItems: { current: [] as unknown[] },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ operations: { today: { invalidate: vi.fn() } } }),
    operations: {
      today: { useQuery: () => ({ data: todayData.current, isError: false }) },
      morningRecap: {
        useQuery: (_input: unknown, options: { enabled: boolean }) =>
          !options.enabled
            ? { data: undefined, isError: false }
            : recapData.current === 'error'
              ? { data: undefined, isError: true }
              : { data: recapData.current, isError: false },
      },
    },
    managerApprovals: {
      queue: {
        useQuery: () => ({
          data: { approver: { id: 'owner-1', hasPin: true }, items: queueItems.current },
          isPending: false,
          isError: false,
          isSuccess: true,
        }),
      },
    },
    reports: { dayClose: { checklist: { useQuery: () => ({ data: null }) } } },
  },
}));

import { CompanionOwnerViews } from '../CompanionOwnerViews';

const dayStartIso = '2026-11-10T05:00:00.000Z';

function recap(overrides: Partial<MorningRecap> = {}): MorningRecap {
  return {
    date: '2026-11-10',
    yesterday: {
      date: '2026-11-10',
      dayStartIso,
      hourly: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        revenue: hour === 12 ? 300000 : hour === 18 ? 200000 : 0,
      })),
      total: 500000,
      comparisonTotal: 400000,
    },
    seal: { signedAt: '2026-11-11T02:41:00.000Z', netRevenue: 498000, salesCount: 171 },
    fiscal: { accepted: 2, rejected: 0, inProgress: 0 },
    backup: { state: 'ok', at: '2026-11-11T03:00:00.000Z' },
    registersToOpen: [
      { siteId: 's-1', siteName: 'Norte', registerName: 'Caja 1', openingFloat: 200000 },
      { siteId: 's-1', siteName: 'Norte', registerName: 'Caja 2', openingFloat: 200000 },
    ],
    carriedSales: [{ id: 'd-1', saleNumber: 'S-1', label: 'Domicilio Calle 80', total: 42100 }],
    ...overrides,
  };
}

function morningToday(firstShiftAt = '2026-11-11T12:30:00.000Z') {
  const base = todayFixture();
  return todayFixture({
    shifts: [
      {
        userId: 'u-1',
        userName: 'Laura',
        siteId: 's-1',
        startsAt: firstShiftAt,
        endsAt: '2026-11-11T21:00:00.000Z',
      },
    ],
    generatedAt: '2026-11-11T12:05:00.000Z',
    sales: { ...base.sales, total: 0, orders: 0, comparisonTotal: 7_900_000 },
    hourly: base.hourly.map(row => ({
      ...row,
      today: 0,
      comparison: row.hour === 12 ? 900000 : row.hour === 18 ? 700000 : 0,
    })),
    registers: [],
    awaitingHandoffs: [],
  });
}

function renderViews() {
  return render(
    <MemoryRouter initialEntries={['/c/']}>
      <CompanionOwnerViews view="today" liveState="open" businessDay="2026-11-11" />
    </MemoryRouter>
  );
}

beforeEach(() => {
  todayData.current = morningToday();
  recapData.current = recap();
  queueItems.current = [];
});

describe('CompanionMorning', () => {
  it('recaps the sealed day and lists what to do before opening', async () => {
    renderViews();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Good morning');
    expect(screen.getByTestId('companion-connection')).toHaveTextContent('Live');
    const yesterday = screen.getByTestId('companion-morning-yesterday');
    expect(yesterday).toHaveTextContent('Yesterday, sealed');
    expect(screen.getByTestId('companion-morning-yesterday-total')).toHaveTextContent('498,000');
    expect(screen.getByTestId('companion-morning-yesterday-change')).toHaveTextContent('25%');
    expect(screen.getByTestId('companion-morning-notes')).toHaveTextContent(
      'Since the close, the DIAN accepted the 2 that were missing. Backup OK.'
    );

    const before = screen.getByTestId('companion-before-opening');
    expect(before).toHaveTextContent('Before opening2');
    expect(screen.getByTestId('companion-morning-opens')).toHaveTextContent('opens in 25 min');
    const open = screen.getByTestId('companion-morning-open');
    expect(open).toHaveTextContent('Open Caja 1 and Caja 2');
    expect(open).toHaveTextContent('Suggested float');
    expect(open).toHaveTextContent('each');
    expect(open).not.toHaveTextContent('Norte');
    const openLink = within(open).getByRole('link', { name: 'Open' });
    expect(openLink).toHaveAttribute('href', '/sales');
    expect(openLink).toHaveAccessibleDescription('Open Caja 1 and Caja 2');
    expect(screen.getByTestId('companion-morning-carried')).toHaveTextContent('Domicilio Calle 80');

    const expected = screen.getByTestId('companion-morning-expected');
    expect(expected).toHaveTextContent('Expected today');
    expect(expected).toHaveTextContent('peaks:');
    expect(screen.queryByTestId('companion-today')).not.toBeInTheDocument();
  });

  it('asks to seal an unsigned yesterday and flags what the DIAN rejected or the backup missed', async () => {
    recapData.current = recap({
      seal: null,
      fiscal: null,
      backup: { state: 'failed', at: '2026-11-11T03:00:00.000Z' },
      registersToOpen: [
        { siteId: 's-1', siteName: 'Norte', registerName: 'Caja 1', openingFloat: 100000 },
        { siteId: 's-2', siteName: 'Sur', registerName: 'Caja 1', openingFloat: 50000 },
      ],
      carriedSales: [],
    });
    todayData.current = morningToday('2026-11-11T16:00:00.000Z');
    renderViews();
    expect(await screen.findByTestId('companion-morning-yesterday')).toHaveTextContent(
      'Yesterday, not sealed'
    );
    expect(screen.getByTestId('companion-morning-yesterday-total')).toHaveTextContent('500,000');
    expect(screen.getByTestId('companion-morning-notes')).toHaveTextContent(
      'The last backup failed.'
    );
    expect(
      within(screen.getByTestId('companion-morning-close')).getByRole('link', { name: 'Close' })
    ).toHaveAttribute('href', '/?close=2026-11-10');
    const rows = screen.getAllByTestId('companion-morning-open');
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('Norte'),
      expect.stringContaining('Sur'),
    ]);
    expect(screen.getByTestId('companion-morning-opens')).toHaveTextContent(/opens at 11:00/);
  });

  it('still flags a failed backup after a day without sales', async () => {
    recapData.current = recap({
      yesterday: { ...recap().yesterday, total: 0, hourly: [] },
      seal: null,
      fiscal: null,
      backup: { state: 'failed', at: '2026-11-11T03:00:00.000Z' },
    });
    renderViews();
    expect(await screen.findByTestId('companion-morning-notes')).toHaveTextContent(
      'The last backup failed.'
    );
    expect(screen.queryByTestId('companion-morning-yesterday')).not.toBeInTheDocument();
  });

  it('does not say every missing invoice was accepted when the DIAN rejected one', async () => {
    recapData.current = recap({ fiscal: { accepted: 2, rejected: 1, inProgress: 0 } });
    renderViews();
    const notes = await screen.findByTestId('companion-morning-notes');
    expect(notes).toHaveTextContent('Since the close, the DIAN accepted 2 invoices.');
    expect(notes).toHaveTextContent('The DIAN rejected 1 invoice.');
  });

  it('keeps an approval waiting on the owner on top and says when nothing is left to do', async () => {
    recapData.current = recap({ registersToOpen: [], carriedSales: [] });
    todayData.current = morningToday('2026-11-11T11:00:00.000Z');
    queueItems.current = [
      {
        id: 'a-1',
        action: 'sale_refund',
        reason: 'Producto dañado',
        resourceType: 'sale',
        summary: { label: 'Refund', amount: 48500 },
        requestedAt: '2026-11-11T12:00:00.000Z',
        requesterName: 'Laura',
        decisionContext: null,
      },
    ];
    renderViews();
    expect(await screen.findByTestId('companion-your-call')).toBeInTheDocument();
    expect(screen.getByTestId('companion-morning-ready')).toHaveTextContent(
      'Nothing to do before opening'
    );
    expect(screen.queryByTestId('companion-morning-opens')).not.toBeInTheDocument();
  });

  it('says so when the recap fails and leaves the open day to Hoy', async () => {
    recapData.current = 'error';
    const failed = renderViews();
    expect(
      await screen.findByText("Yesterday's recap could not be loaded. Try again.")
    ).toBeVisible();
    failed.unmount();

    todayData.current = todayFixture();
    renderViews();
    expect(screen.getByTestId('companion-today')).toBeInTheDocument();
    expect(screen.queryByTestId('companion-morning')).not.toBeInTheDocument();
  });
});
