import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';
import { Modal } from '@/components/form-controls/Modal';
import { ToastProvider, useToast } from '../ToastProvider';

function ActionOpener({ onWait }: { onWait: () => Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() =>
          toast.error({
            title: 'Recovery required',
            durationMs: 60_000,
            action: {
              label: 'Review recovery',
              onClick: () => {
                setOpen(true);
                return onWait();
              },
            },
          })
        }
      >
        Show recovery
      </button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Review recovery dialog">
        <button onClick={() => setOpen(false)}>Cancel recovery</button>
      </Modal>
    </>
  );
}

function ExpiryHarness() {
  const toast = useToast();
  return (
    <Modal isOpen onClose={() => undefined} title="Expiry dialog">
      <button
        onClick={() => {
          toast.error({ title: 'Long-lived error', durationMs: 4000 });
          toast.info({ title: 'Short notice', durationMs: 1000 });
        }}
      >
        Create notifications
      </button>
    </Modal>
  );
}

describe('stable notification portal lifecycle', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('restores focus to the same toast action that opened a dialog', async () => {
    let finish: () => void = () => undefined;
    const pending = new Promise<void>(resolve => {
      finish = resolve;
    });
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ActionOpener onWait={() => pending} />
      </ToastProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Show recovery' }));
    const opener = screen.getByRole('button', { name: 'Review recovery' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toContainElement(screen.getByRole('alert'));
    expect(screen.getByRole('button', { name: 'Close modal' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review recovery' })).toBe(opener);
    expect(opener).toHaveFocus();
    await act(async () => {
      finish();
      await pending;
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not steal focus when another toast expires, and contains focus when the focused one expires', () => {
    vi.useFakeTimers();
    const uuid = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
    try {
      render(
        <ToastProvider>
          <ExpiryHarness />
        </ToastProvider>
      );
      fireEvent.click(screen.getByRole('button', { name: 'Create notifications' }));
      const dismiss = screen.getByRole('button', { name: 'Dismiss Long-lived error' });
      dismiss.focus();
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(dismiss).toHaveFocus();
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    } finally {
      uuid.mockRestore();
    }
  });
});
