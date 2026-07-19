import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import i18next from 'i18next';
import { render } from '@/test/utils';
import { SaleReprintModal } from './SaleReprintModal';

describe('SaleReprintModal', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('renders the controlled other-reason form and pending state', () => {
    render(
      <SaleReprintModal
        isOpen
        isPending
        isPrinting
        reason="other"
        reasonDetail="Damaged copy"
        error="Unable to reprint"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onReasonChange={vi.fn()}
        onReasonDetailChange={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'Reprint receipt' })).toBeInTheDocument();
    expect(screen.getByLabelText('Reason (optional)')).toHaveValue('other');
    expect(screen.getByLabelText('Reason detail')).toHaveValue('Damaged copy');
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to reprint');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reprinting...' })).toBeDisabled();
  });

  it('routes form and action events to the coordinator', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const onReasonChange = vi.fn();
    const onReasonDetailChange = vi.fn();

    render(
      <SaleReprintModal
        isOpen
        isPending={false}
        isPrinting={false}
        reason="other"
        reasonDetail=""
        error={null}
        onClose={onClose}
        onConfirm={onConfirm}
        onReasonChange={onReasonChange}
        onReasonDetailChange={onReasonDetailChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Reason (optional)'), {
      target: { value: 'customer_request' },
    });
    fireEvent.change(screen.getByLabelText('Reason detail'), {
      target: { value: 'Customer asked for another copy' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reprint' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onReasonChange).toHaveBeenCalledWith('customer_request');
    expect(onReasonDetailChange).toHaveBeenNthCalledWith(1, '');
    expect(onReasonDetailChange).toHaveBeenNthCalledWith(2, 'Customer asked for another copy');
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
