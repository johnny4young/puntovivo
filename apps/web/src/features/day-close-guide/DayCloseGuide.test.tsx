import { render, screen, within } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { guideFixture } from './fixtures';

const { guideData, explainMutate, carryMutate, criticalMutate } = vi.hoisted(() => ({
  guideData: { current: null as unknown },
  explainMutate: vi.fn(),
  carryMutate: vi.fn(),
  criticalMutate: { 'reports.dayClose.signOff': vi.fn(), 'sales.discardDraft': vi.fn() } as Record<
    string,
    ReturnType<typeof vi.fn>
  >,
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'm-1', name: 'Marta Ríos', role: 'admin' } }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => ({ mutate: criticalMutate[path], isPending: false }),
}));

vi.mock('@/lib/trpc', () => {
  const invalidate = vi.fn().mockResolvedValue(undefined);
  const node: object = new Proxy(
    {},
    { get: (_t, key) => (key === 'invalidate' ? invalidate : node) }
  );
  return {
    trpc: {
      useUtils: () => node,
      reports: {
        dayClose: {
          guide: { useQuery: () => ({ data: guideData.current }) },
          explainDifference: { useMutation: () => ({ mutate: explainMutate, isPending: false }) },
          carryOverDraft: { useMutation: () => ({ mutate: carryMutate, isPending: false }) },
        },
      },
    },
  };
});

import { DayCloseGuide } from './DayCloseGuide';

const formatCurrency = (value: number) => `$ ${value}`;

beforeEach(() => {
  guideData.current = guideFixture();
  explainMutate.mockReset();
  carryMutate.mockReset();
  Object.values(criticalMutate).forEach(mock => mock.mockReset());
});

describe('DayCloseGuide', () => {
  it('shows the day in figures and the checklist that still needs decisions', () => {
    render(<DayCloseGuide isOpen onClose={vi.fn()} formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('close-guide-figures')).toHaveTextContent('Cash to deposit$ 5189850');
    expect(screen.getByTestId('close-guide-cash-difference')).toHaveClass('text-danger-700');
    expect(screen.getByTestId('close-guide-registers')).toHaveTextContent(
      'Registers closed · 3 of 3'
    );
    expect(screen.getByTestId('close-guide-difference-cs-1')).toHaveTextContent(
      'Caja 1 difference: $ -12300'
    );
    expect(screen.getByTestId('close-guide-difference-cs-1')).toHaveTextContent(
      'Within the tolerance: Caja 2 $ -2000'
    );
    expect(screen.getByTestId('close-guide-fiscal')).toHaveTextContent(
      'DIAN: 169 accepted · 2 in process'
    );
    expect(screen.getByTestId('close-guide-anomalies')).toHaveTextContent('none');
    expect(screen.queryByTestId('close-guide-arc')).not.toBeInTheDocument();
    expect(screen.getByTestId('close-guide-sign')).toBeDisabled();
  });

  it('shows a handoff whose recount differed from the outgoing count', () => {
    guideData.current = guideFixture({
      handoffs: [
        {
          id: 'h-1',
          siteId: 'site-1',
          registerName: 'Caja 2',
          fromUserName: 'Andrés',
          toUserName: 'Camila',
          createdAt: '2026-11-11T19:04:00.000Z',
          receivedAt: '2026-11-11T19:06:00.000Z',
          recountDifference: -500,
        },
      ],
    });
    render(<DayCloseGuide isOpen onClose={vi.fn()} formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('close-guide-handoff-h-1')).toHaveTextContent(
      'Caja 2 handoff: the counts differ by $ -500'
    );
    expect(screen.getByTestId('close-guide-handoff-h-1')).toHaveTextContent(
      'Andrés counted, Camila recounted'
    );
  });

  it('stores a reason, asks for a note on Other and decides the parked sale', async () => {
    const user = userEvent.setup();
    render(<DayCloseGuide isOpen onClose={vi.fn()} formatCurrency={formatCurrency} />);
    const row = screen.getByTestId('close-guide-difference-cs-1');
    await user.click(within(row).getByTestId('close-guide-reason-wrong_change'));
    expect(explainMutate).toHaveBeenCalledWith({
      sessionId: 'cs-1',
      reason: 'wrong_change',
      note: null,
    });

    await user.click(within(row).getByTestId('close-guide-reason-other'));
    expect(within(row).getByTestId('close-guide-reason-save')).toBeDisabled();
    await user.type(within(row).getByTestId('close-guide-reason-note'), 'Paid a supplier');
    await user.click(within(row).getByTestId('close-guide-reason-save'));
    expect(explainMutate).toHaveBeenLastCalledWith({
      sessionId: 'cs-1',
      reason: 'other',
      note: 'Paid a supplier',
    });

    await user.click(screen.getByTestId('close-guide-draft-carry'));
    expect(carryMutate).toHaveBeenCalledWith({ saleId: 'd-1' });
    await user.click(screen.getByTestId('close-guide-draft-discard'));
    expect(criticalMutate['sales.discardDraft']).toHaveBeenCalledWith({ saleId: 'd-1' });
  });

  it('signs with the PIN once everything is settled', async () => {
    const user = userEvent.setup();
    guideData.current = guideFixture({
      differences: [],
      drafts: [],
      blockers: [],
      readyToSign: true,
    });
    render(<DayCloseGuide isOpen onClose={vi.fn()} formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('close-guide-signature-pad')).toBeInTheDocument();
    await user.click(screen.getByTestId('close-guide-method-pin'));
    expect(screen.getByTestId('close-guide-sign')).toBeDisabled();
    await user.type(screen.getByTestId('close-guide-pin'), '654321');
    await user.click(screen.getByTestId('close-guide-sign'));
    expect(criticalMutate['reports.dayClose.signOff']).toHaveBeenCalledWith({
      date: '2026-11-11',
      attestationAccepted: true,
      signature: { method: 'pin', pin: '654321' },
    });
  });

  it('shows the sealed day with the arc, the stamp and the drawn signature', () => {
    guideData.current = guideFixture({
      differences: [],
      drafts: [],
      blockers: [],
      readyToSign: true,
      signoff: {
        id: 'so-1',
        signedAt: '2026-11-12T02:41:00.000Z',
        signedByName: 'Marta Ríos',
        signatureMethod: 'drawn',
        signatureImage: 'data:image/png;base64,AAAA',
      },
    });
    render(<DayCloseGuide isOpen onClose={vi.fn()} formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('close-guide-sold')).toHaveTextContent('$ 8517350');
    expect(screen.getByTestId('close-guide-arc')).toHaveTextContent('5.8 % more');
    expect(screen.getByTestId('close-guide-stamp')).toHaveTextContent('Day closed');
    expect(screen.getByTestId('close-guide-signature-image')).toHaveAttribute(
      'src',
      'data:image/png;base64,AAAA'
    );
    expect(screen.queryByTestId('close-guide-sign')).not.toBeInTheDocument();
    expect(screen.getByTestId('close-guide-share')).toHaveAttribute(
      'href',
      expect.stringContaining('https://wa.me/?text=')
    );
  });
});
