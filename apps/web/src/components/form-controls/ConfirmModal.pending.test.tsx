import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';
import { ConfirmModal } from './Modal';

for (const language of ['en', 'es'] as const) {
  it(`keeps the pending action reachable while blocking repeat activation (${language})`, async () => {
    await i18next.changeLanguage(language);
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    const label = language === 'en' ? 'Deactivate' : 'Desactivar';
    const props = {
      isOpen: true,
      onClose,
      onConfirm,
      title: 'Synthetic confirmation',
      message: 'Synthetic operation',
      confirmText: label,
    };
    const { rerender } = render(<ConfirmModal {...props} />);
    const confirm = screen.getByRole('button', { name: label });
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    rerender(<ConfirmModal {...props} loading />);
    // Loading is a temporary busy state, not a removed keyboard destination.
    const close = screen.getByRole('button', {
      name: language === 'en' ? 'Close modal' : 'Cerrar modal',
    });
    close.focus();
    await user.tab();
    expect(confirm).toHaveFocus();
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Enter}');
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    rerender(<ConfirmModal {...props} loading={false} />);
    expect(screen.getByRole('button', { name: label })).toBe(confirm);
    expect(confirm).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });
}

describe('business disabled confirmation', () => {
  it('keeps a business-disabled action natively unavailable, including while busy', async () => {
    await i18next.changeLanguage('en');
    const onConfirm = vi.fn();
    const props = {
      isOpen: true,
      onClose: vi.fn(),
      onConfirm,
      title: 'Synthetic confirmation',
      message: 'Synthetic operation',
      confirmDisabled: true,
    };
    const { rerender } = render(<ConfirmModal {...props} />);
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    rerender(<ConfirmModal {...props} loading />);
    expect(confirm).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not close while the request is pending', async () => {
    await i18next.changeLanguage('en');
    const onClose = vi.fn();
    const props = {
      isOpen: true,
      onClose,
      onConfirm: vi.fn(),
      title: 'Synthetic confirmation',
      message: 'Synthetic operation',
    };
    const { rerender } = render(<ConfirmModal {...props} loading />);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    expect(onClose).not.toHaveBeenCalled();

    rerender(<ConfirmModal {...props} loading={false} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
