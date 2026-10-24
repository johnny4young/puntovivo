import { StrictMode, useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';
import { Modal } from '@/components/form-controls/Modal';
import { Drawer } from '../Drawer';
import { ToastProvider, useToast } from '../ToastProvider';

function DialogHarness({
  language,
  onAction,
}: {
  language: 'en' | 'es';
  onAction?: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const title = language === 'en' ? 'Unable to save' : 'No se pudo guardar';
  return (
    <>
      <button onClick={() => setOpen(true)}>Open confirmation</button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Confirmation">
        <button
          onClick={() =>
            toast.error({
              title,
              durationMs: 60_000,
              ...(onAction ? { action: { label: 'Retry recovery', onClick: onAction } } : {}),
            })
          }
        >
          Confirm request
        </button>
        <button onClick={() => setOpen(false)}>Cancel request</button>
      </Modal>
    </>
  );
}

function StackHarness() {
  const toast = useToast();
  const [drawer, setDrawer] = useState(false);
  const [modal, setModal] = useState(false);
  return (
    <>
      <button onClick={() => setDrawer(true)}>Open drawer</button>
      <Drawer isOpen={drawer} onClose={() => setDrawer(false)} title="Outer drawer">
        <button onClick={() => toast.error({ title: 'Durable error', durationMs: 60_000 })}>
          Report error
        </button>
        <button onClick={() => setModal(true)}>Open inner</button>
        <Modal isOpen={modal} onClose={() => setModal(false)} title="Inner confirmation">
          <button onClick={() => setModal(false)}>Cancel inner</button>
        </Modal>
      </Drawer>
    </>
  );
}

function TimerHarness() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => toast.info({ title: 'Timed notice', durationMs: 4000 })}>
        Show timed notice
      </button>
      <button onClick={() => setOpen(true)}>Open timed dialog</button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Timed dialog">
        <button>Inside</button>
      </Modal>
    </>
  );
}

describe('toasts share the active dialog accessibility and focus boundary', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['en', 'es'] as const)(
    'announces one %s error without exposing the background or stealing focus',
    async language => {
      await i18next.changeLanguage(language);
      const user = userEvent.setup();
      const { container } = render(
        <ToastProvider>
          <DialogHarness language={language} />
        </ToastProvider>
      );
      const opener = screen.getByRole('button', { name: 'Open confirmation' });
      await user.click(opener);
      const confirm = screen.getByRole('button', { name: 'Confirm request' });
      await user.click(confirm);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(language === 'en' ? 'Unable to save' : 'No se pudo guardar');
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(screen.getByRole('dialog')).toContainElement(alert);
      expect(alert.closest('[aria-hidden="true"], [inert]')).toBeNull();
      expect(container).toHaveAttribute('aria-hidden', 'true');
      expect(container).toHaveProperty('inert', true);
      expect(confirm).toHaveFocus();
      const dismiss = screen.getByRole('button', {
        name: language === 'en' ? /dismiss unable to save/i : /descartar no se pudo guardar/i,
      });
      dismiss.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      const close = screen.getByRole('button', {
        name: language === 'en' ? /close modal/i : /cerrar modal/i,
      });
      expect(close).toHaveFocus();
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(dismiss).toHaveFocus();
      await user.click(dismiss);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
      await user.click(screen.getByRole('button', { name: 'Cancel request' }));
      expect(opener).toHaveFocus();
      expect(container).not.toHaveAttribute('aria-hidden');
      expect(container).toHaveProperty('inert', false);
    }
  );

  it('keeps one existing toast through a nested modal, then the drawer, then the page', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToastProvider>
        <StackHarness />
      </ToastProvider>
    );
    const opener = screen.getByRole('button', { name: 'Open drawer' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Report error' }));
    const alert = screen.getByRole('alert');
    const innerOpener = screen.getByRole('button', { name: 'Open inner' });
    await user.click(innerOpener);
    expect(
      within(screen.getByRole('dialog', { name: 'Inner confirmation' })).getByRole('alert')
    ).toBe(alert);
    expect(container).toHaveProperty('inert', true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Inner confirmation' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: 'Outer drawer' })).getByRole('alert')).toBe(
      alert
    );
    expect(innerOpener).toHaveFocus();
    expect(container).toHaveProperty('inert', true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBe(alert);
    expect(opener).toHaveFocus();
    expect(container).toHaveProperty('inert', false);
  });

  it('contains a rejected toast action and keeps modal recovery reachable', async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error('Synthetic recovery failure'))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <DialogHarness language="en" onAction={action} />
      </ToastProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Open confirmation' }));
    await user.click(screen.getByRole('button', { name: 'Confirm request' }));
    const recovery = screen.getByRole('button', { name: 'Retry recovery' });
    await user.click(recovery);
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(recovery).toHaveFocus();
    await user.click(recovery);
    expect(action).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  });

  it('does not remount or restart an existing notification timer during dialog transitions', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <TimerHarness />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show timed notice' }));
    const notice = screen.getByRole('status');
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(screen.getByRole('button', { name: 'Open timed dialog' }));
    expect(screen.getByRole('status')).toBe(notice);
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('status')).toBe(notice);
    act(() => vi.advanceTimersByTime(1999));
    expect(screen.getByRole('status')).toBe(notice);
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('cleans portal notifications and isolation on StrictMode unmount', async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(
      <StrictMode>
        <ToastProvider>
          <DialogHarness language="en" />
        </ToastProvider>
      </StrictMode>
    );
    await user.click(screen.getByRole('button', { name: 'Open confirmation' }));
    await user.click(screen.getByRole('button', { name: 'Confirm request' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    unmount();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container).not.toHaveAttribute('aria-hidden');
    expect(container).toHaveProperty('inert', false);
    expect(document.body.style.overflow).toBe('');
  });
});
