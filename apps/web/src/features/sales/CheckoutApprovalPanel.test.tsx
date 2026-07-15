import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { CheckoutApprovalPanel } from './CheckoutApprovalPanel';

const baseProps = {
  isLoading: false,
  isHashing: false,
  isRequesting: false,
  hasError: false,
  onRequest: vi.fn(),
  onRefresh: vi.fn(),
};

describe('CheckoutApprovalPanel', () => {
  it('requires a meaningful reason and sends the matching action', async () => {
    const user = userEvent.setup();
    const onRequest = vi.fn();
    render(
      <CheckoutApprovalPanel
        {...baseProps}
        onRequest={onRequest}
        views={[
          {
            action: 'sale_discount',
            requestId: null,
            status: 'not_requested',
            decisionReason: null,
          },
        ]}
      />
    );

    const request = screen.getByRole('button', { name: 'Request approval' });
    expect(request).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Explain why this checkout needs approval'), 'OK');
    expect(request).toBeDisabled();
    await user.type(
      screen.getByPlaceholderText('Explain why this checkout needs approval'),
      ' price'
    );
    await user.click(request);

    expect(onRequest).toHaveBeenCalledWith('sale_discount', 'OK price');
  });

  it('shows approved, decision, error, and refresh states without raw details', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(
      <CheckoutApprovalPanel
        {...baseProps}
        hasError
        onRefresh={onRefresh}
        views={[
          {
            action: 'credit_sale',
            requestId: 'approval-1',
            status: 'approved',
            decisionReason: 'Customer history verified',
          },
        ]}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Approved');
    expect(screen.getByText('Decision note: Customer history verified')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Approval status could not be refreshed');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
