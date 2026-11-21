import { fireEvent, render, screen, within } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeChecklistFixture, closeReportFixture, closeSignoffFixture } from './fixtures';

const { state, mutations } = vi.hoisted(() => ({
  state: {
    signoff: null as unknown,
    report: null as unknown,
    checklist: null as unknown,
    hasPin: false,
  },
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'm-1', role: 'manager', name: 'Marta Ríos' } }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => {
    mutations[path] ??= vi.fn();
    return { mutate: mutations[path], isPending: false };
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({}),
    reports: {
      dayClose: {
        signoff: {
          useQuery: () => ({ data: state.signoff, isSuccess: true, error: null }),
        },
        preview: { useQuery: () => ({ data: state.report, error: null }) },
        checklist: { useQuery: () => ({ data: state.checklist, error: null }) },
      },
    },
    cashSessions: {
      mySigner: { useQuery: () => ({ data: { hasPin: state.hasPin } }) },
    },
  },
}));

import { GuidedDayCloseSheet } from './GuidedDayCloseSheet';

const formatCurrency = (value: number) => `$ ${value}`;

function renderSheet() {
  return render(
    <GuidedDayCloseSheet
      isOpen
      onClose={vi.fn()}
      date="2026-11-11"
      today={null}
      formatCurrency={formatCurrency}
    />
  );
}

function drawSignature() {
  const pad = screen.getByTestId('day-close-signature-pad');
  pad.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 600, height: 160, right: 600, bottom: 160 }) as DOMRect;
  fireEvent.pointerDown(pad, { clientX: 10, clientY: 20, pointerId: 1 });
  fireEvent.pointerMove(pad, { clientX: 80, clientY: 60, pointerId: 1 });
  fireEvent.pointerUp(pad, { pointerId: 1 });
}

beforeEach(() => {
  state.signoff = null;
  state.report = closeReportFixture();
  state.checklist = closeChecklistFixture();
  state.hasPin = false;
  for (const key of Object.keys(mutations)) delete mutations[key];
});

describe('GuidedDayCloseSheet', () => {
  it('shows the day in numbers, the steps and how many rows are ready', () => {
    renderSheet();
    expect(screen.getByRole('heading', { name: /Close for/ })).toBeInTheDocument();
    expect(screen.getByTestId('day-close-progress')).toHaveTextContent('4 of 7 ready');
    expect(screen.getByTestId('day-close-figures')).toHaveTextContent('$ 5189850');
    expect(screen.getByTestId('day-close-figures')).toHaveTextContent('$ 3313200');
    expect(screen.getByTestId('day-close-difference')).toHaveClass('text-danger-700');
    expect(screen.getByTestId('day-close-sold')).toHaveTextContent('171 sales');
    const steps = within(screen.getByTestId('day-close-stepper')).getAllByRole('listitem');
    expect(steps.map(step => step.dataset.state)).toEqual(['done', 'now', 'next']);
    expect(screen.getByTestId('day-close-row-fiscal')).toHaveTextContent(
      'DIAN: 169 accepted · 2 in progress'
    );
  });

  it('explains a difference inline and asks for a note when the reason is other', async () => {
    const user = userEvent.setup();
    renderSheet();
    const row = screen.getByTestId('day-close-row-difference-session-1');
    expect(row).toHaveAttribute('data-state', 'todo');
    expect(screen.getByTestId('day-close-row-difference-session-2')).toHaveAttribute(
      'data-state',
      'done'
    );
    await user.click(screen.getByTestId('day-close-reason-unrecorded_withdrawal-session-1'));
    expect(mutations['cashSessions.explainDifference']).toHaveBeenCalledWith({
      sessionId: 'session-1',
      reason: 'unrecorded_withdrawal',
    });

    await user.click(screen.getByTestId('day-close-reason-other-session-1'));
    await user.type(screen.getByTestId('day-close-reason-note-session-1'), 'Billete roto');
    await user.click(within(row).getByRole('button', { name: 'Save' }));
    expect(mutations['cashSessions.explainDifference']).toHaveBeenLastCalledWith({
      sessionId: 'session-1',
      reason: 'other',
      note: 'Billete roto',
    });
  });

  it('leaves a suspended sale for tomorrow or discards it after confirming', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByTestId('day-close-draft-carry-draft-1'));
    expect(mutations['sales.carryOver']).toHaveBeenCalledWith({ saleId: 'draft-1' });

    await user.click(screen.getByTestId('day-close-draft-discard-draft-1'));
    expect(mutations['sales.discardDraft']).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(mutations['sales.discardDraft']).toHaveBeenCalledWith({ saleId: 'draft-1' });
  });

  it('keeps signing disabled while blockers remain, even with a signature', () => {
    renderSheet();
    drawSignature();
    expect(screen.getByTestId('day-close-sign')).toBeDisabled();
    expect(screen.getByTestId('day-close-hint')).toHaveTextContent('2 items left to resolve');
  });

  it('signs with the drawn signature once the day is ready', async () => {
    const user = userEvent.setup();
    state.report = closeReportFixture({
      readiness: { readyToSign: true, blockers: [], warnings: [] },
    });
    renderSheet();
    expect(screen.getByTestId('day-close-sign')).toBeDisabled();
    drawSignature();
    await user.click(screen.getByTestId('day-close-sign'));
    expect(mutations['reports.dayClose.signOff']).toHaveBeenCalledWith({
      date: '2026-11-11',
      attestationAccepted: true,
      signature: { method: 'drawn', path: 'M10 20L80 60' },
    });
  });

  it('signs with the staff PIN when the manager has one', async () => {
    const user = userEvent.setup();
    state.hasPin = true;
    state.report = closeReportFixture({
      readiness: { readyToSign: true, blockers: [], warnings: [] },
    });
    renderSheet();
    expect(screen.getByTestId('day-close-signature')).toHaveTextContent(
      'sign with your finger or your PIN'
    );
    await user.click(screen.getByTestId('day-close-sign-mode'));
    await user.type(screen.getByTestId('handoff-pin'), '482915');
    await user.click(screen.getByTestId('day-close-sign'));
    expect(mutations['reports.dayClose.signOff']).toHaveBeenCalledWith({
      date: '2026-11-11',
      attestationAccepted: true,
      signature: { method: 'pin', pin: '482915' },
    });
  });

  it('shows the sealed day with the stored signature and freezes every action', () => {
    const report = closeReportFixture({
      readiness: { readyToSign: true, blockers: [], warnings: [] },
    });
    state.signoff = closeSignoffFixture(report);
    state.checklist = closeChecklistFixture({
      sessions: closeChecklistFixture().sessions.map(session => ({
        ...session,
        differenceReason: 'wrong_change' as const,
      })),
      drafts: [{ ...closeChecklistFixture().drafts[0]!, carriedOver: true }],
    });
    renderSheet();
    expect(screen.getByTestId('day-close-seal')).toHaveTextContent('11');
    expect(screen.getByTestId('day-close-signed')).toHaveTextContent('Signed by Marta Ríos');
    expect(screen.getByTestId('day-close-signed-path')).toBeInTheDocument();
    expect(screen.queryByTestId('day-close-sign')).not.toBeInTheDocument();
    expect(screen.queryByTestId('day-close-draft-carry-draft-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('day-close-row-drafts-carried')).toHaveTextContent(
      '1 suspended sale resolved'
    );
    expect(screen.getByTestId('day-close-row-drafts-carried')).toHaveTextContent(
      'Left for tomorrow · $ 42100'
    );
    expect(screen.queryByTestId('day-close-reason-other-session-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('day-close-done')).toBeInTheDocument();
    expect(screen.getByTestId('day-close-progress')).toHaveTextContent('7 of 7 ready');
  });

  it('sends only totals to the owner summary', () => {
    renderSheet();
    const href = screen.getByTestId('day-close-owner-summary').getAttribute('href')!;
    const text = decodeURIComponent(href.split('text=')[1]!);
    expect(text).toContain('Sold: $ 8517350 in 171 sales');
    expect(text).toContain('Cash to deposit: $ 5189850');
    expect(text).toContain('Not signed yet');
    expect(text).not.toContain('Domicilio');
    expect(text).not.toContain('Andrés');
  });
});
