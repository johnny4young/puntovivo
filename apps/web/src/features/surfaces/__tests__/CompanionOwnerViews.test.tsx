import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { todayFixture } from '@/features/dashboard/today/fixtures';
import type { QueueItem } from '../companionApproval';

const { todayData, queueData, checklistData, formProps } = vi.hoisted(() => ({
  todayData: { current: null as unknown },
  queueData: { current: null as unknown },
  checklistData: { current: null as unknown },
  formProps: { current: null as null | Record<string, unknown> },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ operations: { today: { invalidate: vi.fn() } } }),
    operations: {
      today: {
        useQuery: () => ({ data: todayData.current, isError: false, refetch: vi.fn() }),
      },
    },
    managerApprovals: {
      queue: {
        useQuery: () =>
          queueData.current === 'error'
            ? { data: undefined, isPending: false, isError: true, isSuccess: false }
            : { data: queueData.current, isPending: false, isError: false, isSuccess: true },
      },
    },
    reports: {
      dayClose: { checklist: { useQuery: () => ({ data: checklistData.current }) } },
    },
  },
}));

vi.mock('@/features/approvals/ManagerApprovalQueue', () => ({
  ApprovalDecisionForm: (props: Record<string, unknown>) => {
    formProps.current = props;
    return <div data-testid="approval-form">{String(props.submitLabel)}</div>;
  },
}));

vi.mock('../CompanionSealedDay', () => ({
  CompanionSealedDay: ({ requestedDate }: { requestedDate: string | null }) => (
    <p data-testid="sealed-stub">{requestedDate ?? 'latest'}</p>
  ),
}));

import { CompanionOwnerViews } from '../CompanionOwnerViews';

const DISCOUNT: QueueItem = {
  id: 'a-1',
  action: 'sale_discount',
  status: 'pending',
  reason: 'Takes the whole month order today',
  resourceType: 'sale_checkout',
  resourceId: 'hash',
  summary: { label: 'checkout', amount: 74_400, currencyCode: 'COP' },
  siteId: 'site-1',
  requesterId: 'u-1',
  requestedAt: '2026-11-11T16:20:00.000Z',
  expiresAt: '2026-11-11T16:30:00.000Z',
  requiredApprovals: 1,
  requiredApproverRole: 'manager',
  approvalsCollected: 0,
  requesterName: 'Laura',
  siteName: 'Norte',
  decisionContext: {
    version: 1,
    discount: { percent: 12, roleLimitPercent: 10 },
    margin: { withDiscountPercent: 21, withoutDiscountPercent: 31 },
    customer: {
      id: 'c-1',
      name: 'Restaurante El Fogón',
      windowDays: 90,
      purchases: 12,
      daysPerVisit: 7,
      usualDiscountPercent: 9,
    },
    ticket: { totalBefore: 620_000, total: 545_600, itemCount: 14 },
  },
} as unknown as QueueItem;

function renderViews(path = '/c/', view: 'today' | 'registers' | 'day' = 'today') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CompanionOwnerViews view={view} liveState="open" businessDay="2026-11-11" />
    </MemoryRouter>
  );
}

beforeEach(() => {
  todayData.current = todayFixture();
  queueData.current = { approver: { id: 'owner-1', hasPin: true }, items: [DISCOUNT] };
  checklistData.current = null;
  formProps.current = null;
});

describe('CompanionOwnerViews', () => {
  it('shows what sold, the request waiting on the owner and what the store handles', () => {
    renderViews();
    expect(screen.getByTestId('companion-sold-total')).toHaveTextContent('$40,000.00');
    expect(screen.getByTestId('companion-sold-change')).toHaveTextContent('100% more than last');
    const card = screen.getByTestId('companion-your-call');
    expect(card).toHaveTextContent('Discount of COP 74,400 is waiting for your approval');
    expect(card).toHaveTextContent('12% for Restaurante El Fogón · asked by Laura');
    expect(within(card).getByTestId('companion-decide-open')).toHaveAttribute(
      'href',
      '/c/?decide=a-1'
    );
    // Stale register, incident and fiscal alert are the store's, the approval is not.
    expect(screen.getByTestId('companion-store-pending')).toHaveTextContent(
      '3 more items are handled at the store'
    );
    expect(screen.getAllByTestId('companion-register-open')).toHaveLength(2);
  });

  it('says so when nothing waits on the owner', () => {
    queueData.current = { approver: { id: 'owner-1', hasPin: true }, items: [] };
    renderViews();
    expect(screen.getByTestId('companion-nothing-waiting')).toBeInTheDocument();
    expect(screen.getByTestId('companion-store-pending')).toHaveTextContent('4 more items');
  });

  it('weighs the discount in the sheet and counters at the usual share', async () => {
    renderViews('/c/?decide=a-1');
    const sheet = screen.getByTestId('companion-decide-sheet');
    expect(sheet).toHaveTextContent('Blocking · the customer is waiting at Caja 1');
    expect(sheet).toHaveTextContent('12% discount');
    expect(screen.getByTestId('companion-decide-amount')).toHaveTextContent('-COP 74,400');
    expect(screen.getByTestId('companion-decide-ticket')).toHaveTextContent(
      'COP 620,000 → COP 545,600 · 14 items'
    );
    expect(screen.getByTestId('companion-decide-note')).toHaveTextContent(
      '«Takes the whole month order today»'
    );
    expect(screen.getByTestId('companion-decide-approve')).toHaveTextContent('Approve 12%');

    await userEvent.click(screen.getByTestId('companion-decide-counter'));
    expect(formProps.current).toMatchObject({
      requestId: 'a-1',
      decision: 'rejected',
      approverId: 'owner-1',
      fixedReason: 'Leave it at 9%',
      submitLabel: 'Leave it at 9%',
      large: true,
    });
  });

  it('offers no counter when the customer has no lower usual share', async () => {
    queueData.current = {
      approver: { id: 'owner-1', hasPin: true },
      items: [
        {
          ...DISCOUNT,
          decisionContext: {
            ...DISCOUNT.decisionContext!,
            customer: { ...DISCOUNT.decisionContext!.customer!, usualDiscountPercent: 0 },
          },
        },
      ],
    };
    renderViews('/c/?decide=a-1');
    expect(screen.queryByTestId('companion-decide-counter')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('companion-decide-reject'));
    expect(formProps.current).toMatchObject({ decision: 'rejected', fixedReason: undefined });
  });

  it('tells the owner a request already decided elsewhere is gone', () => {
    renderViews('/c/?decide=missing');
    expect(screen.getByTestId('companion-decide-sheet')).toHaveTextContent(
      'This request is no longer waiting for your decision.'
    );
  });

  it('asks an owner without a staff PIN to set one before deciding', () => {
    queueData.current = { approver: { id: 'owner-1', hasPin: false }, items: [DISCOUNT] };
    renderViews('/c/?decide=a-1');
    expect(screen.getByTestId('companion-decide-pin-missing')).toBeInTheDocument();
    expect(screen.queryByTestId('companion-decide-approve')).not.toBeInTheDocument();
  });

  it('lists registers with sales, drawers waiting and closed ones not already shown', () => {
    todayData.current = todayFixture({
      awaitingHandoffs: [
        {
          id: 'h-1',
          siteId: 'site-1',
          registerName: 'Caja 2',
          fromUserName: 'Andrés',
          toUserName: null,
          handedOverAt: '2026-11-11T19:06:00.000Z',
        },
      ],
    });
    checklistData.current = {
      date: '2026-11-11',
      drafts: [],
      sessions: [
        {
          id: 'c-2',
          siteId: 'site-1',
          registerName: 'Caja 2',
          status: 'closed',
          closedAt: '2026-11-11T19:06:00.000Z',
          counted: true,
        },
        {
          id: 'c-4',
          siteId: 'site-1',
          registerName: 'Caja 4',
          status: 'closed',
          closedAt: '2026-11-11T16:40:00.000Z',
          counted: true,
        },
        // Same name as an open register, but at another site.
        {
          id: 'c-1-sur',
          siteId: 'site-2',
          registerName: 'Caja 1',
          status: 'closed',
          closedAt: '2026-11-11T15:00:00.000Z',
          counted: false,
        },
      ],
    };
    renderViews('/c/?view=registers', 'registers');
    const open = screen.getAllByTestId('companion-register-open');
    expect(open[0]).toHaveTextContent('Caja 1 · Laura');
    expect(open[0]).toHaveTextContent('2 sales');
    expect(open[1]).toHaveTextContent('open since an earlier day');
    expect(screen.getByTestId('companion-register-awaiting')).toHaveTextContent(
      'waiting for someone to receive it'
    );
    const closed = screen.getAllByTestId('companion-register-closed');
    expect(closed).toHaveLength(2);
    expect(closed[0]).toHaveTextContent('Caja 4 · closed and counted at');
    expect(closed[1]).toHaveTextContent('Caja 1 · closed without a count at');
  });

  it('opens the sealed day for the date a notification names', () => {
    renderViews('/c/?view=day&date=2026-11-10', 'day');
    expect(screen.getByTestId('sealed-stub')).toHaveTextContent('2026-11-10');
  });

  it('does not tell the owner nothing waits when the queue could not be read', () => {
    queueData.current = 'error';
    renderViews();
    expect(screen.queryByTestId('companion-nothing-waiting')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Your approvals could not be loaded');
    // The approval is not counted as the store's while the queue is unknown.
    expect(screen.getByTestId('companion-store-pending')).toHaveTextContent('3 more items');
  });

  it('says a request could not be loaded instead of gone when the queue fails', () => {
    queueData.current = 'error';
    renderViews('/c/?decide=a-1');
    expect(screen.getByTestId('companion-decide-sheet')).toHaveTextContent(
      'The request could not be loaded. Try again.'
    );
  });

  it('offers the counter only for a discount the cashier can apply alone', () => {
    const withLimit = (roleLimitPercent: number | null, action = 'sale_discount') => ({
      approver: { id: 'owner-1', hasPin: true },
      items: [
        {
          ...DISCOUNT,
          action,
          decisionContext: {
            ...DISCOUNT.decisionContext!,
            discount: { percent: 12, roleLimitPercent },
          },
        },
      ],
    });
    queueData.current = withLimit(5);
    const above = renderViews('/c/?decide=a-1');
    expect(screen.queryByTestId('companion-decide-counter')).not.toBeInTheDocument();
    above.unmount();

    queueData.current = withLimit(10, 'credit_sale');
    const credit = renderViews('/c/?decide=a-1');
    expect(screen.queryByTestId('companion-decide-counter')).not.toBeInTheDocument();
    expect(screen.getByTestId('companion-decide-approve')).toHaveTextContent(/^Approve$/);
    credit.unmount();

    queueData.current = withLimit(null);
    renderViews('/c/?decide=a-1');
    expect(screen.getByTestId('companion-decide-counter')).toHaveTextContent('Leave it at 9%');
  });

  it('shows only the discounted total when the before is not exact', () => {
    queueData.current = {
      approver: { id: 'owner-1', hasPin: true },
      items: [
        {
          ...DISCOUNT,
          decisionContext: {
            ...DISCOUNT.decisionContext!,
            ticket: { totalBefore: null, total: 545_600, itemCount: 14 },
          },
        },
      ],
    };
    renderViews('/c/?decide=a-1');
    const ticket = screen.getByTestId('companion-decide-ticket');
    expect(ticket).toHaveTextContent('COP 545,600 · 14 items');
    expect(ticket.querySelector('s')).toBeNull();
  });

  it('draws the sheet dark over the sealed day', () => {
    renderViews('/c/?view=day&decide=a-1', 'day');
    expect(screen.getByTestId('companion-decide-sheet').closest('.dark')).not.toBeNull();
  });
});
