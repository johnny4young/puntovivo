import { render, screen, within } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { todayFixture } from './fixtures';
import type { TodayPendingItem } from './todayModel';

const { todayData, resolveMutate, signoffData } = vi.hoisted(() => ({
  todayData: { current: null as unknown },
  resolveMutate: vi.fn(),
  signoffData: { current: null as unknown },
}));

vi.mock('../close/GuidedDayCloseSheet', () => ({
  GuidedDayCloseSheet: ({ date, today }: { date: string; today: unknown }) => (
    <div data-testid="guided-close" data-has-arc={today ? 'yes' : 'no'}>
      {date}
    </div>
  ),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'm-1', role: 'manager' } }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/features/approvals/ManagerApprovalQueue', () => ({
  ApprovalDecisionForm: ({ decision }: { decision: string }) => (
    <div data-testid="approval-form">{decision}</div>
  ),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ operations: { today: { invalidate: vi.fn() } } }),
    operations: {
      today: { useQuery: () => ({ data: todayData.current, isLoading: false }) },
    },
    managerApprovals: {
      queue: { useQuery: () => ({ data: { approver: { hasPin: true } } }) },
    },
    reports: {
      dayClose: {
        signoffMetadata: { useQuery: () => ({ data: signoffData.current }) },
      },
    },
    registerIncidents: {
      resolve: { useMutation: () => ({ mutate: resolveMutate, isPending: false }) },
    },
  },
}));

import { TodayOverview } from './TodayOverview';

const formatCurrency = (value: number) => `$ ${value}`;

function setViewportWide(wide: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
}

beforeEach(() => {
  todayData.current = todayFixture();
  resolveMutate.mockReset();
  signoffData.current = null;
  localStorage.clear();
  setViewportWide(false);
});

describe('TodayOverview', () => {
  it('leads with the sales total, the change against last week and the day band', () => {
    render(<TodayOverview formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('today-sales-total')).toHaveTextContent('$ 40000');
    expect(screen.getByTestId('today-sales-context')).toHaveTextContent('100 %');
    expect(screen.getByTestId('today-band-today')).toBeInTheDocument();
    expect(screen.getByTestId('today-band-comparison')).toBeInTheDocument();
    expect(screen.getByTestId('today-status-pill')).toHaveTextContent('DIAN needs a fix');
  });

  it('orders the queue by severity and outlines only the first blocking row', () => {
    render(<TodayOverview formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('today-pending-count')).toHaveTextContent('4');
    const rows = within(screen.getByTestId('today-pending')).getAllByRole('listitem');
    expect(rows.map(row => row.getAttribute('data-testid'))).toEqual([
      'today-pending-row-staleSession',
      'today-pending-row-approval',
      'today-pending-row-incident',
      'today-pending-row-attention',
    ]);
    expect(rows[0]).toHaveClass('border-danger-500');
    expect(rows[1]).not.toHaveClass('border-danger-500');
  });

  it('filters to items reported by cashiers', async () => {
    const user = userEvent.setup();
    render(<TodayOverview formatCurrency={formatCurrency} />);
    await user.click(screen.getByTestId('today-pending-filter-cashiers'));
    expect(screen.queryByTestId('today-pending-row-staleSession')).not.toBeInTheDocument();
    expect(screen.getByTestId('today-pending-row-incident')).toBeInTheDocument();
  });

  it('offers approve and reject with the PIN form, and resolves incidents in place', async () => {
    const user = userEvent.setup();
    render(<TodayOverview formatCurrency={formatCurrency} />);
    await user.click(screen.getByTestId('today-approval-approve'));
    expect(screen.getByTestId('approval-form')).toHaveTextContent('approved');
    expect(screen.getByTestId('today-pending-link-incident')).toHaveTextContent('Transfer 14');
    await user.click(screen.getByTestId('today-incident-resolve'));
    expect(resolveMutate).toHaveBeenCalledWith({ id: 'i-1' });
  });

  it('says who asked for an approval, why, and how long it has waited', () => {
    render(<TodayOverview formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('today-pending-row-approval')).toHaveTextContent(
      'Laura · Producto dañado · Norte · 24 min ago'
    );
  });

  it('shortens a long approval reason so the age stays on the line', () => {
    const base = todayFixture();
    todayData.current = todayFixture({
      pending: base.pending.map(item =>
        item.kind === 'approval' ? { ...item, reason: 'a'.repeat(300) } : item
      ),
    });
    render(<TodayOverview formatCurrency={formatCurrency} />);
    const row = screen.getByTestId('today-pending-row-approval');
    expect(row).toHaveTextContent(`Laura · ${'a'.repeat(79)}… · Norte · 24 min ago`);
  });

  it('names a checkout approval by its action', () => {
    const base = todayFixture();
    todayData.current = todayFixture({
      pending: base.pending.map(item =>
        item.kind === 'approval'
          ? {
              ...item,
              action: 'sale_discount',
              label: null,
              amount: 2856,
            }
          : item
      ),
    });
    render(<TodayOverview formatCurrency={formatCurrency} />);
    const row = screen.getByTestId('today-pending-row-approval');
    expect(row).toHaveTextContent(`Sale discount ${formatCurrency(2856)} awaits your approval`);
    expect(row).not.toHaveTextContent('checkout');
  });

  describe('incident detail', () => {
    type IncidentItem = Extract<TodayPendingItem, { kind: 'incident' }>;
    const baseIncident = () =>
      todayFixture().pending.find((item): item is IncidentItem => item.kind === 'incident')!;
    const renderIncident = (patch: Partial<IncidentItem['incident']>) => {
      const item = baseIncident();
      todayData.current = todayFixture({
        pending: [{ ...item, incident: { ...item.incident, ...patch } }],
      });
      render(<TodayOverview formatCurrency={formatCurrency} />);
      return screen.getByTestId('today-pending-row-incident');
    };

    it('shows a stockout reason, the report time and the site to transfer from', () => {
      const row = renderIncident({
        stockBySite: [
          { siteId: 'site-1', siteName: 'Norte', onHand: 0 },
          { siteId: 'site-3', siteName: 'Centro', onHand: 3 },
          { siteId: 'site-2', siteName: 'Sur', onHand: 14 },
        ],
      });
      expect(row).toHaveTextContent('Leche UHT out of stock');
      expect(row).toHaveTextContent(
        /Not on the shelf · Reported by Laura · Norte · .+ · Sur has 14/
      );
      expect(within(row).getByTestId('today-pending-link-incident')).toHaveTextContent(
        'Transfer 14'
      );
    });

    it.each([
      ['system_zero', 'System says 0'],
      ['expired', 'Expired'],
    ] as const)('names the %s stockout reason', (reason, label) => {
      expect(renderIncident({ reason })).toHaveTextContent(label);
    });

    it('shows shelf against system price and no stock elsewhere on a price mismatch', () => {
      const row = renderIncident({ kind: 'price_mismatch', shelfPrice: 4500 });
      expect(row).toHaveTextContent('Leche UHT: shelf price differs');
      expect(row).toHaveTextContent('shelf $ 4500 · system $ 4900 · Reported by Laura');
      expect(row).not.toHaveTextContent('Sur has');
      expect(within(row).queryByTestId('today-pending-link-incident')).not.toBeInTheDocument();
    });

    it('shows only the shelf price when the system price is unknown', () => {
      const row = renderIncident({
        kind: 'price_mismatch',
        shelfPrice: 4500,
        systemPrice: null,
      });
      expect(row).toHaveTextContent('shelf $ 4500 · Reported by Laura');
      expect(row).not.toHaveTextContent('system');
    });

    it('keeps the note of an item without barcode in the title, once', () => {
      const row = renderIncident({
        kind: 'no_barcode',
        productId: null,
        productName: null,
        note: 'Galletas de vitrina',
        stockBySite: [],
      });
      expect(row).toHaveTextContent('Product without barcode: Galletas de vitrina');
      expect(row.textContent?.match(/Galletas de vitrina/g)).toHaveLength(1);
      expect(row).toHaveTextContent(/vitrinaReported by Laura · Norte/);
    });

    it('adds the note when an item without barcode names a product', () => {
      const row = renderIncident({ kind: 'no_barcode', note: 'sin etiqueta' });
      expect(row).toHaveTextContent('Product without barcode: Leche UHT');
      expect(row).toHaveTextContent('sin etiqueta · Reported by Laura');
    });
  });

  it('shows open registers, the stale one, and the next handoff', () => {
    render(<TodayOverview formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('today-register')).toHaveTextContent('waits on 2');
    expect(screen.getByTestId('today-register-stale')).toHaveTextContent('is item 1');
    expect(screen.getByTestId('today-next-handoff')).toHaveTextContent('2 h 36 min');
    expect(screen.getByTestId('today-next-handoff-detail')).toHaveTextContent(
      'Handoff of Caja 1: Laura hands over to Camila'
    );
    expect(screen.queryByTestId('today-register-handoff')).not.toBeInTheDocument();
    expect(screen.queryByTestId('today-register-awaiting')).not.toBeInTheDocument();
  });

  it('keeps the handoff line without a receiver when no one is scheduled', () => {
    const base = todayFixture();
    todayData.current = todayFixture({ nextHandoff: { ...base.nextHandoff!, toUserName: null } });
    render(<TodayOverview formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('today-next-handoff-detail')).toHaveTextContent(
      'Handoff of Caja 1: Laura hands over'
    );
    expect(screen.getByTestId('today-next-handoff-detail')).not.toHaveTextContent('to Camila');
  });

  it('shows the handoff a register came from and the registers still waiting to be received', () => {
    const base = todayFixture();
    const receivedAt = '2026-11-11T19:06:00.000Z';
    todayData.current = todayFixture({
      registers: base.registers.map(register =>
        register.sessionId === 's-1'
          ? {
              ...register,
              lastHandoff: { receivedAt, fromUserName: 'Andrés', countDifference: -10000 },
            }
          : register
      ),
      awaitingHandoffs: [
        {
          id: 'h-2',
          siteId: 'site-1',
          registerName: 'Caja 2',
          fromUserName: 'Diego',
          toUserName: 'Camila',
          handedOverAt: receivedAt,
        },
        {
          id: 'h-3',
          siteId: 'site-1',
          registerName: 'Caja 4',
          fromUserName: 'Marta',
          toUserName: null,
          handedOverAt: receivedAt,
        },
      ],
    });
    render(<TodayOverview formatCurrency={formatCurrency} />);

    const line = screen.getByTestId('today-register-handoff');
    expect(line).toHaveTextContent("$ -10000 against Andrés's count");
    expect(line).toHaveClass('text-danger-700');
    const [named, open] = screen.getAllByTestId('today-register-awaiting');
    expect(named).toHaveTextContent('Caja 2 · handed over');
    expect(named).toHaveTextContent('waits for Camila');
    expect(named).toHaveTextContent('Diego handed it over at');
    expect(open).toHaveTextContent('to receive');
  });

  it('remembers the expanded day per viewer', async () => {
    const user = userEvent.setup();
    render(<TodayOverview formatCurrency={formatCurrency} />);
    const toggle = screen.getByTestId('today-expand');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(localStorage.getItem('puntovivo.today.expanded')).toBe('1');
  });

  it('draws the day arc only while the day is expanded', async () => {
    setViewportWide(true);
    const user = userEvent.setup();
    render(<TodayOverview formatCurrency={formatCurrency} />);
    expect(screen.queryByTestId('today-arc')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('today-expand'));
    const arc = await screen.findByTestId('today-arc');
    // Its baseline sits on the band's hour axis.
    expect(arc.style.marginTop).toContain('208px');
    expect(screen.getByRole('img', { name: /^Day from .+ to .+, \d+ % elapsed$/ })).toBeVisible();
    await user.click(screen.getByTestId('today-expand'));
    expect(screen.queryByTestId('today-arc')).not.toBeInTheDocument();
  });

  it('opens expanded with the arc when the viewer left the day expanded', async () => {
    setViewportWide(true);
    localStorage.setItem('puntovivo.today.expanded', '1');
    render(<TodayOverview formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('today-expand')).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByTestId('today-arc')).toBeInTheDocument();
  });

  it('never mounts the arc at phone width, where the band has no room beside it', () => {
    setViewportWide(false);
    localStorage.setItem('puntovivo.today.expanded', '1');
    render(<TodayOverview formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('today-expand')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByTestId('today-arc')).not.toBeInTheDocument();
  });

  it('opens the guided close for the business day from the header', async () => {
    const user = userEvent.setup();
    render(<TodayOverview formatCurrency={formatCurrency} />);
    const open = screen.getByTestId('today-close-day');
    expect(open).toHaveTextContent('Close the day');
    expect(screen.queryByTestId('guided-close')).not.toBeInTheDocument();
    await user.click(open);
    const sheet = await screen.findByTestId('guided-close');
    expect(sheet).toHaveAttribute('data-has-arc', 'yes');
    expect(sheet.textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('says the day is closed once it is signed', () => {
    signoffData.current = { id: 'signoff-1' };
    render(<TodayOverview formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('today-close-day')).toHaveTextContent('Day closed');
  });

  it('opens a dated close link even while Hoy is still loading', async () => {
    todayData.current = undefined;
    render(<TodayOverview formatCurrency={formatCurrency} />, {
      initialEntries: ['/dashboard?close=2026-11-11'],
    });
    const sheet = await screen.findByTestId('guided-close');
    expect(sheet).toHaveTextContent('2026-11-11');
    expect(sheet).toHaveAttribute('data-has-arc', 'no');
  });
});
