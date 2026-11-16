import { render, screen } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CashSession } from '@/types';

const { pendingState } = vi.hoisted(() => ({
  pendingState: { current: { data: undefined as unknown, isLoading: true } },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: { shiftHandoffs: { pending: { useQuery: () => pendingState.current } } },
}));

vi.mock('@/features/sales/CashSessionOpenModal', () => ({
  CashSessionOpenModal: () => <div data-testid="open-modal" />,
}));

vi.mock('@/features/sales/CashSessionCloseModal', () => ({
  CashSessionCloseModal: ({ isOpen, onHandOut }: { isOpen: boolean; onHandOut?: () => void }) =>
    isOpen ? (
      <button type="button" data-testid="close-modal" onClick={onHandOut}>
        close
      </button>
    ) : null,
}));

vi.mock('@/features/shift-handoff/HandOutShiftDialog', () => ({
  HandOutShiftDialog: ({ onHandedOut }: { onHandedOut: () => void }) => (
    <button type="button" data-testid="hand-out-dialog" onClick={onHandedOut}>
      hand out
    </button>
  ),
}));

vi.mock('@/features/shift-handoff/ReceiveShiftDialog', () => ({
  ReceiveShiftDialog: ({
    onOpenWithout,
    onReceived,
  }: {
    onOpenWithout: () => void;
    onReceived: (draft: unknown) => void;
  }) => (
    <div data-testid="receive-dialog">
      <button type="button" data-testid="receive-skip" onClick={onOpenWithout}>
        skip
      </button>
      <button
        type="button"
        data-testid="receive-done"
        onClick={() => onReceived({ id: 'd-1', label: 'P2', suspendedAt: '2026-11-11T18:00:00Z' })}
      >
        done
      </button>
    </div>
  ),
}));

import { CashSessionModals } from './CashSessionModals';

const baseProps = {
  isCashSessionModalOpen: false,
  cashSessionModalKey: 0,
  isOpeningCashSession: false,
  cashSessionError: null,
  selectedRegisterAssignment: null,
  onCloseOpenModal: vi.fn(),
  onSubmitOpen: vi.fn(),
  isCashSessionCloseModalOpen: false,
  cashSessionCloseModalKey: 0,
  activeCashSession: null,
  isClosingCashSession: false,
  cashSessionCloseError: null,
  onCloseCloseModal: vi.fn(),
  onSubmitClose: vi.fn(),
  suspendedDraftsCount: 0,
  isCashSessionMovementModalOpen: false,
  cashSessionMovementModalKey: 0,
  isRecordingMovement: false,
  cashSessionMovementError: null,
  onCloseMovementModal: vi.fn(),
  onSubmitMovement: vi.fn(),
  dayCloseSessionId: null,
  onCloseDayClose: vi.fn(),
};

beforeEach(() => {
  pendingState.current = { data: undefined, isLoading: true };
});

describe('CashSessionModals handoff', () => {
  it('offers the waiting drawer before a fresh open and resumes the chosen draft', async () => {
    const user = userEvent.setup();
    const onResumeDraft = vi.fn();
    const onCloseOpenModal = vi.fn();
    const { rerender } = render(
      <CashSessionModals
        {...baseProps}
        isCashSessionModalOpen
        onCloseOpenModal={onCloseOpenModal}
        onResumeDraft={onResumeDraft}
      />
    );
    expect(screen.queryByTestId('open-modal')).not.toBeInTheDocument();

    pendingState.current = {
      data: { handoffs: [{ id: 'h-1' }], pinRequired: false },
      isLoading: false,
    };
    rerender(
      <CashSessionModals
        {...baseProps}
        isCashSessionModalOpen
        onCloseOpenModal={onCloseOpenModal}
        onResumeDraft={onResumeDraft}
      />
    );
    await user.click(await screen.findByTestId('receive-done'));
    expect(onCloseOpenModal).toHaveBeenCalled();
    expect(onResumeDraft).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd-1', tableId: null, resumedDeviceId: null })
    );
  });

  it('opens the usual way when there is no handoff or the cashier skips it', async () => {
    const user = userEvent.setup();
    pendingState.current = {
      data: { handoffs: [{ id: 'h-1' }], pinRequired: false },
      isLoading: false,
    };
    render(<CashSessionModals {...baseProps} isCashSessionModalOpen />);
    await user.click(await screen.findByTestId('receive-skip'));
    expect(await screen.findByTestId('open-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('receive-dialog')).not.toBeInTheDocument();
  });

  it('swaps the close for the handoff and closes both once handed out', async () => {
    const user = userEvent.setup();
    const onCloseCloseModal = vi.fn();
    render(
      <CashSessionModals
        {...baseProps}
        isCashSessionCloseModalOpen
        activeCashSession={{ id: 'cs-1', registerName: 'Caja 2' } as CashSession}
        onCloseCloseModal={onCloseCloseModal}
      />
    );
    await user.click(await screen.findByTestId('close-modal'));
    const handOut = await screen.findByTestId('hand-out-dialog');
    expect(screen.queryByTestId('close-modal')).not.toBeInTheDocument();
    await user.click(handOut);
    expect(onCloseCloseModal).toHaveBeenCalled();
  });
});
