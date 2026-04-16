import { render, screen } from '@testing-library/react';
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
});
