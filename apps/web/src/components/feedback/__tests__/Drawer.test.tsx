/**
 * ENG-186 — Tests for the reusable <Drawer> slide-over.
 *
 * Pins the dialog a11y contract it inherits from <Modal>:
 *   - Renders nothing when closed; portals a labelled dialog when open.
 *   - Close button, ESC, and backdrop click all call onClose (each
 *     individually gateable via closeOnEsc / closeOnBackdrop).
 *   - A click inside the panel does NOT close it.
 *   - Focus moves into the panel on open and the Tab trap wraps.
 *   - restoreFocusTo overrides focus restoration on close (the
 *     cashier-speed /sales seam: focus returns to the search input).
 *   - Body scroll is locked while open and restored on close.
 *   - Background content is inert/hidden from screen readers while open.
 *   - No serious/critical axe violations.
 *
 * @module components/feedback/__tests__/Drawer.test
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { assertNoA11yViolations } from '@/test/a11y';
import { Drawer } from '../Drawer';

function renderDrawer(props: Partial<React.ComponentProps<typeof Drawer>> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const utils = render(
    <Drawer isOpen onClose={onClose} title="Sales history" {...props}>
      <button type="button">First action</button>
      <button type="button">Second action</button>
    </Drawer>
  );
  return { onClose, ...utils };
}

describe('Drawer (ENG-186)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    document.body.style.overflow = '';
  });

  it('renders nothing when closed', () => {
    render(
      <Drawer isOpen={false} onClose={vi.fn()} title="Sales history">
        <p>Body</p>
      </Drawer>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('portals a labelled modal dialog when open', () => {
    renderDrawer();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const heading = screen.getByText('Sales history');
    expect(dialog).toHaveAttribute('aria-labelledby', heading.id);
    expect(heading.id).toBeTruthy();
    expect(screen.getByRole('button', { name: /first action/i })).toBeInTheDocument();
  });

  it('generates unique title ids when multiple labelled drawers are mounted', () => {
    render(
      <>
        <Drawer isOpen onClose={vi.fn()} title="Sales history">
          <button type="button">First action</button>
        </Drawer>
        <Drawer isOpen onClose={vi.fn()} title="Suspended sales">
          <button type="button">Resume sale</button>
        </Drawer>
      </>
    );

    const [historyDialog, suspendedDialog] = screen.getAllByRole('dialog', { hidden: true });
    const historyHeading = screen.getByText('Sales history');
    const suspendedHeading = screen.getByText('Suspended sales');
    expect(historyDialog).toHaveAttribute('aria-labelledby', historyHeading.id);
    expect(suspendedDialog).toHaveAttribute('aria-labelledby', suspendedHeading.id);
    expect(historyHeading.id).not.toBe(suspendedHeading.id);
    expect(historyDialog).toHaveAttribute('aria-hidden', 'true');
    expect(historyDialog).toHaveProperty('inert', true);
    expect(suspendedDialog).not.toHaveAttribute('aria-hidden');
    expect(suspendedDialog).not.toHaveProperty('inert', true);
  });

  it('falls back to ariaLabel when there is no visible title', () => {
    render(
      <Drawer isOpen onClose={vi.fn()} ariaLabel="Suspended sales">
        <p>Body</p>
      </Drawer>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', 'Suspended sales');
    expect(dialog).not.toHaveAttribute('aria-labelledby');
  });

  it('supports the xl desktop width used by complex operational forms', () => {
    renderDrawer({ size: 'xl', testId: 'wide-drawer' });
    expect(screen.getByTestId('wide-drawer')).toHaveClass('sm:max-w-[40rem]');
  });

  it('renders pinned content outside the scrollable body', () => {
    renderDrawer({
      pinnedContent: <p>Stable total</p>,
      footer: <button type="button">Confirm</button>,
    });

    const pinned = screen.getByText('Stable total').parentElement;
    expect(pinned).toHaveClass('drawer-pinned-content', 'shrink-0');
    expect(pinned?.nextElementSibling).toHaveClass('modal-body', 'min-h-0');
    expect(pinned?.previousElementSibling).toHaveClass('modal-header', 'shrink-0');
    expect(screen.getByRole('button', { name: 'Confirm' }).parentElement).toHaveClass(
      'modal-footer',
      'shrink-0'
    );
  });

  it('the header close button calls onClose', () => {
    const { onClose } = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: /close modal/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ESC closes by default but is suppressed when closeOnEsc is false', () => {
    const { onClose, rerender } = renderDrawer();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <Drawer isOpen onClose={onClose} title="Sales history" closeOnEsc={false}>
        <button type="button">First action</button>
      </Drawer>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('only the topmost drawer handles ESC when dialogs are stacked', () => {
    const onBottomClose = vi.fn();
    const onTopClose = vi.fn();
    render(
      <>
        <Drawer isOpen onClose={onBottomClose} title="Sales history">
          <button type="button">First action</button>
        </Drawer>
        <Drawer isOpen onClose={onTopClose} title="Suspended sales">
          <button type="button">Resume sale</button>
        </Drawer>
      </>
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onBottomClose).not.toHaveBeenCalled();
    expect(onTopClose).toHaveBeenCalledTimes(1);
  });

  it('backdrop click closes but a click inside the panel does not', () => {
    const { onClose } = renderDrawer();
    // The panel (role=dialog child) click bubbles but is not the backdrop.
    fireEvent.click(screen.getByText('Sales history'));
    expect(onClose).not.toHaveBeenCalled();

    // The backdrop is the aria-hidden sibling of the panel.
    const backdrop = screen.getByRole('dialog').querySelector(':scope > [aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('isolates background content while open and restores its prior state', () => {
    const { container, rerender, onClose } = renderDrawer();
    expect(container).toHaveAttribute('aria-hidden', 'true');
    expect(container).toHaveProperty('inert', true);

    rerender(
      <Drawer isOpen={false} onClose={onClose} title="Sales history">
        <button type="button">First action</button>
      </Drawer>
    );

    expect(container).not.toHaveAttribute('aria-hidden');
    expect(container).toHaveProperty('inert', false);
  });

  it('moves focus into the panel on open', async () => {
    renderDrawer();
    await waitFor(() => {
      const close = screen.getByRole('button', { name: /close modal/i });
      expect(close).toHaveFocus();
    });
  });

  it('traps Tab focus within the panel', async () => {
    renderDrawer();
    const close = screen.getByRole('button', { name: /close modal/i });
    const second = screen.getByRole('button', { name: /second action/i });
    // Tab from the last focusable wraps to the first (close button).
    second.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
    // Shift+Tab from the first wraps to the last.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(second).toHaveFocus();
  });

  it('ignores hidden and disabled controls when wrapping focus', () => {
    render(
      <Drawer
        isOpen
        onClose={vi.fn()}
        title="Sales history"
        footer={
          <button type="button" disabled>
            Unavailable action
          </button>
        }
      >
        <button type="button">Last available action</button>
        <select hidden aria-label="Backing value">
          <option>Hidden</option>
        </select>
      </Drawer>
    );

    const close = screen.getByRole('button', { name: /close modal/i });
    const lastAvailable = screen.getByRole('button', { name: 'Last available action' });
    lastAvailable.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
  });

  it('restoreFocusTo overrides focus restoration on close', () => {
    const external = document.createElement('button');
    external.textContent = 'Search';
    document.body.appendChild(external);

    const onClose = vi.fn();
    const { rerender } = render(
      <Drawer isOpen onClose={onClose} title="Sales history" restoreFocusTo={() => external}>
        <button type="button">First action</button>
      </Drawer>
    );
    rerender(
      <Drawer
        isOpen={false}
        onClose={onClose}
        title="Sales history"
        restoreFocusTo={() => external}
      >
        <button type="button">First action</button>
      </Drawer>
    );
    expect(external).toHaveFocus();
    external.remove();
  });

  it('locks body scroll while open and restores it on close', () => {
    const { rerender, onClose } = renderDrawer();
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <Drawer isOpen={false} onClose={onClose} title="Sales history">
        <button type="button">First action</button>
      </Drawer>
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('has no serious accessibility violations', async () => {
    renderDrawer();
    await assertNoA11yViolations(document.body);
  });
});
