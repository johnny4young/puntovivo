import { StrictMode, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Modal } from '@/components/form-controls/Modal';
import { Drawer } from '../Drawer';
import { ToastProvider, useToast } from '../ToastProvider';

function Harness({ withDrawer = false, onRetry }: { withDrawer?: boolean; onRetry?: () => void }) {
  const toast = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const raise = (title: string) =>
    toast.error({
      title,
      durationMs: 60_000,
      ...(onRetry ? { action: { label: 'Retry', onClick: onRetry } } : {}),
    });
  return (
    <>
      <button onClick={() => raise('Page error')}>Raise on page</button>
      <button onClick={() => (withDrawer ? setDrawerOpen(true) : setModalOpen(true))}>Open</button>
      <Drawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} title="Drawer">
        <button onClick={() => setModalOpen(true)}>Open nested</button>
        <button onClick={() => raise('Drawer error')}>Raise in drawer</button>
      </Drawer>
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Confirmation">
        <button onClick={() => raise('Modal error')}>Raise in modal</button>
        <button onClick={() => setModalOpen(false)}>Close modal</button>
      </Modal>
    </>
  );
}

function renderHarness(props?: { withDrawer?: boolean; onRetry?: () => void }) {
  return render(
    <StrictMode>
      <ToastProvider>
        <div id="app-root">
          <Harness {...props} />
        </div>
      </ToastProvider>
    </StrictMode>
  );
}

const isolated = (element: Element) => Boolean(element.closest('[aria-hidden="true"], [inert]'));

interface ToastStateFiber {
  type: unknown;
  return: ToastStateFiber | null;
  memoizedState: { queue: { pending: unknown } };
}

// A queued update holds its closure until the provider renders again, and only
// the fiber can show that from a test.
function queuedToastUpdate(element: Element): unknown {
  const fiberKey = Object.keys(element).find(key => key.startsWith('__reactFiber$'))!;
  let fiber = (element as unknown as Record<string, ToastStateFiber | null>)[fiberKey] ?? null;
  while (fiber && fiber.type !== ToastProvider) fiber = fiber.return;
  return fiber!.memoizedState.queue.pending;
}

describe('toasts raised while a dialog is open', () => {
  it('leave nothing queued on the provider when a dialog without toasts closes', () => {
    renderHarness();
    const open = screen.getByText('Open');

    for (let cycle = 0; cycle < 3; cycle += 1) {
      fireEvent.click(open);
      fireEvent.click(screen.getByText('Close modal'));
    }

    expect(queuedToastUpdate(open)).toBeNull();
  });


  it('render inside the dialog as an exposed alert', () => {
    renderHarness();
    fireEvent.click(screen.getByText('Open'));
    fireEvent.click(screen.getByText('Raise in modal'));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Modal error');
    expect(screen.getByRole('dialog', { name: 'Confirmation' })).toContainElement(alert);
    expect(isolated(alert)).toBe(false);
  });

  it('leave toasts raised before the dialog opened on the page', () => {
    renderHarness();
    fireEvent.click(screen.getByText('Raise on page'));
    fireEvent.click(screen.getByText('Open'));

    const toast = screen.getByText('Page error').closest('[data-toast-id]')!;
    expect(screen.getByRole('dialog', { name: 'Confirmation' })).not.toContainElement(
      toast as HTMLElement
    );
  });

  it('go to the topmost dialog when dialogs are nested', () => {
    renderHarness({ withDrawer: true });
    fireEvent.click(screen.getByText('Open'));
    fireEvent.click(screen.getByText('Open nested'));
    fireEvent.click(screen.getByText('Raise in modal'));

    const alert = screen.getByRole('alert');
    expect(screen.getByRole('dialog', { name: 'Confirmation' })).toContainElement(alert);
  });

  it('move once when their dialog closes, without a second announcement', () => {
    renderHarness({ withDrawer: true });
    fireEvent.click(screen.getByText('Open'));
    fireEvent.click(screen.getByText('Open nested'));
    fireEvent.click(screen.getByText('Raise in modal'));
    fireEvent.click(screen.getByText('Close modal'));

    const toast = screen.getByText('Modal error').closest('[data-toast-id]')!;
    expect(screen.getByRole('dialog', { name: 'Drawer' })).toContainElement(toast as HTMLElement);
    expect(toast).toHaveAttribute('role', 'status');
    expect(toast).toHaveAttribute('aria-live', 'off');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keep focus inside the dialog when a focused toast is dismissed', () => {
    renderHarness();
    fireEvent.click(screen.getByText('Open'));
    fireEvent.click(screen.getByText('Raise in modal'));
    const dismiss = screen.getByRole('button', { name: /Modal error/ });
    dismiss.focus();

    act(() => fireEvent.click(dismiss));

    expect(screen.queryByText('Modal error')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Confirmation' })).toContainElement(
      document.activeElement as HTMLElement
    );
  });

  it('keep a toast action reachable inside the dialog', async () => {
    let retried = 0;
    renderHarness({ onRetry: () => void retried++ });
    fireEvent.click(screen.getByText('Open'));
    fireEvent.click(screen.getByText('Raise in modal'));

    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(screen.getByRole('dialog', { name: 'Confirmation' })).toContainElement(retry);
    expect(isolated(retry)).toBe(false);
    await act(async () => fireEvent.click(retry));
    expect(retried).toBe(1);
  });
});
