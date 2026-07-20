import { act, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { Modal, ModalButton } from './Modal';

describe('Modal', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the reusable modal shell sections and action variants', () => {
    render(
      <Modal
        isOpen
        onClose={vi.fn()}
        title="Inventory adjustment"
        contentClassName="modal-content-test"
        footerClassName="modal-footer-test"
        footer={
          <>
            <ModalButton>Cancel</ModalButton>
            <ModalButton variant="primary">Save</ModalButton>
            <ModalButton variant="danger">Delete</ModalButton>
          </>
        }
      >
        <p>Adjust the product stock.</p>
      </Modal>
    );

    const shell = screen.getByText('Inventory adjustment').closest('.modal-shell');
    expect(shell).toHaveClass('max-w-[38rem]');

    expect(screen.getByText('Adjust the product stock.').parentElement).toHaveClass(
      'modal-body',
      'modal-content-test'
    );

    const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement;
    expect(footer).toHaveClass('modal-footer', 'modal-footer-test');

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('btn-outline');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('btn-primary');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn-danger');
  });

  it('uses ariaLabel for titleless modal dialogs', () => {
    render(
      <Modal isOpen onClose={vi.fn()} ariaLabel="Command palette">
        <input aria-label="Search actions" />
      </Modal>
    );

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  describe('focus restoration on close', () => {
    function FocusHarness({
      restoreFocusTo,
      restoreTarget,
    }: {
      restoreFocusTo?: () => HTMLElement | null;
      restoreTarget: 'opener' | 'override' | null;
    }) {
      const [isOpen, setIsOpen] = useState(false);
      const openerRef = (node: HTMLButtonElement | null) => {
        if (node && restoreTarget === 'opener') {
          node.dataset.testid = 'opener';
        }
      };
      return (
        <div>
          <button ref={openerRef} data-testid="opener" onClick={() => setIsOpen(true)}>
            Open
          </button>
          <input data-testid="override-target" />
          <Modal
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            title="Test"
            restoreFocusTo={restoreFocusTo}
          >
            <button data-testid="close" onClick={() => setIsOpen(false)}>
              Close
            </button>
          </Modal>
        </div>
      );
    }

    it('does not call restoreFocusTo before the modal has opened', () => {
      const restoreFocusTo = vi.fn(() =>
        document.querySelector<HTMLInputElement>('[data-testid="override-target"]')
      );

      render(<FocusHarness restoreFocusTo={restoreFocusTo} restoreTarget="override" />);

      expect(restoreFocusTo).not.toHaveBeenCalled();
    });

    it('restores focus to the previously-focused element when restoreFocusTo is not provided', async () => {
      render(<FocusHarness restoreTarget="opener" />);
      const opener = screen.getByTestId('opener');
      opener.focus();
      expect(document.activeElement).toBe(opener);

      act(() => {
        opener.click();
      });

      // Modal is open — close it.
      const close = await screen.findByTestId('close');
      act(() => {
        close.click();
      });

      await waitFor(() => expect(document.activeElement).toBe(opener));
    });

    it('restores focus to the element returned by restoreFocusTo when provided', async () => {
      const restoreFocusTo = () =>
        document.querySelector<HTMLInputElement>('[data-testid="override-target"]');
      render(<FocusHarness restoreFocusTo={restoreFocusTo} restoreTarget="override" />);
      const opener = screen.getByTestId('opener');
      opener.focus();

      act(() => {
        opener.click();
      });

      const close = await screen.findByTestId('close');
      act(() => {
        close.click();
      });

      const override = screen.getByTestId('override-target');
      await waitFor(() => expect(document.activeElement).toBe(override));
    });

    it('falls back to the previously-focused element when restoreFocusTo returns null', async () => {
      const restoreFocusTo = () => null;
      render(<FocusHarness restoreFocusTo={restoreFocusTo} restoreTarget="opener" />);
      const opener = screen.getByTestId('opener');
      opener.focus();

      act(() => {
        opener.click();
      });

      const close = await screen.findByTestId('close');
      act(() => {
        close.click();
      });

      await waitFor(() => expect(document.activeElement).toBe(opener));
    });
  });
});
