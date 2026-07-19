import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@/test/utils';
import {
  CustomerPrivacyDispositionModal,
  type CustomerPrivacyDispositionPreview,
} from './CustomerPrivacyDispositionModal';

const basePreview: CustomerPrivacyDispositionPreview = {
  customer: {
    id: 'customer-1',
    name: 'Cliente Demo',
    version: 3,
    privacyStatus: 'active',
  },
  disposition: 'delete',
  linkedRecordCounts: {
    sales: 0,
    quotations: 0,
    ledgerEntries: 0,
    deliveryOrders: 0,
    fiscalDocuments: 0,
  },
  totalLinkedRecords: 0,
  retentionReason: null,
};

function renderModal(preview: CustomerPrivacyDispositionPreview = basePreview) {
  const props = {
    isOpen: true,
    customerName: preview.customer.name,
    preview,
    isLoading: false,
    error: null,
    confirmation: '',
    isSubmitting: false,
    onConfirmationChange: vi.fn(),
    onClose: vi.fn(),
    onConfirm: vi.fn(),
  };
  return { ...render(<CustomerPrivacyDispositionModal {...props} />), props };
}

describe('CustomerPrivacyDispositionModal', () => {
  it('explains when an unlinked profile is eligible for permanent deletion', () => {
    renderModal();

    expect(screen.getByText('Eligible for permanent deletion')).toBeInTheDocument();
    expect(screen.getByText(/no linked transactional records/i)).toBeInTheDocument();
    expect(screen.queryByText('Sales')).not.toBeInTheDocument();
  });

  it('shows retained record counts before an anonymization', () => {
    renderModal({
      ...basePreview,
      disposition: 'anonymize',
      linkedRecordCounts: {
        ...basePreview.linkedRecordCounts,
        sales: 2,
        fiscalDocuments: 1,
      },
      totalLinkedRecords: 3,
      retentionReason: 'linked_records',
    });

    expect(screen.getByText('Transactional records will be retained')).toBeInTheDocument();
    expect(screen.getByText('3 linked records require retention')).toBeInTheDocument();
    expect(screen.getByText('Sales').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Fiscal documents').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Anonymize personal data' })).toBeDisabled();
  });

  it('forwards confirmation edits while the form is interactive', () => {
    const onConfirmationChange = vi.fn();
    render(
      <CustomerPrivacyDispositionModal
        isOpen
        customerName={basePreview.customer.name}
        preview={basePreview}
        isLoading={false}
        confirmation=""
        isSubmitting={false}
        onConfirmationChange={onConfirmationChange}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Confirmation'), { target: { value: 'Cliente' } });
    expect(onConfirmationChange).toHaveBeenCalledWith('Cliente');
  });

  it('disables confirmation, cancellation, and input while submitting', () => {
    render(
      <CustomerPrivacyDispositionModal
        isOpen
        customerName={basePreview.customer.name}
        preview={basePreview}
        isLoading={false}
        confirmation={basePreview.customer.name}
        isSubmitting
        onConfirmationChange={vi.fn()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Applying disposition...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByLabelText('Confirmation')).toBeDisabled();
  });

  it('renders loading and safe error states without exposing destructive actions', () => {
    const { rerender } = render(
      <CustomerPrivacyDispositionModal
        isOpen
        customerName="Cached customer"
        isLoading
        confirmation=""
        isSubmitting={false}
        onConfirmationChange={vi.fn()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Evaluating linked records...');
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();

    rerender(
      <CustomerPrivacyDispositionModal
        isOpen
        customerName="Cached customer"
        isLoading={false}
        error="sensitive server detail"
        confirmation=""
        isSubmitting={false}
        onConfirmationChange={vi.fn()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The disposition preview could not be loaded. Close this dialog and try again.'
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('sensitive server detail');
  });
});
