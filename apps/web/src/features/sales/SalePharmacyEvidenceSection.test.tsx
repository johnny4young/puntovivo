import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { fireEvent, render, screen, waitFor } from '@/test/utils';
import { SalePharmacyEvidenceSection } from './SalePharmacyEvidenceSection';

const mutationState = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; input: unknown }>,
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (
    path: string,
    options?: {
      onSuccess?: (data: { id: string; status: string }, variables: unknown) => unknown;
    }
  ) => ({
    mutate: (input: unknown) => {
      mutationState.calls.push({ path, input });
      const variables = input as { id?: string; productId?: string };
      const id =
        path === 'pharmacy.approveEvidence'
          ? (variables.id ?? 'evidence-pending-1')
          : variables.productId === 'medicine-2'
            ? 'evidence-pending-2'
            : 'evidence-pending-1';
      void options?.onSuccess?.(
        {
          id,
          status: path === 'pharmacy.approveEvidence' ? 'approved' : 'pending',
        },
        input
      );
    },
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
}));

const requirement = {
  productId: 'medicine-1',
  productName: 'Amoxicillin 500 mg',
  classification: 'prescription' as const,
  requestedQuantity: 2,
  policyVersion: 'co-pharmacy-v1',
  evidenceRequired: true,
  professionalApprovalRequired: true,
  blockedErrorCode: null,
  eligibleEvidence: [],
};

const secondRequirement = {
  ...requirement,
  productId: 'medicine-2',
  productName: 'Azithromycin 500 mg',
  requestedQuantity: 1,
};

describe('SalePharmacyEvidenceSection', () => {
  beforeEach(() => {
    mutationState.calls = [];
  });

  it('records sealed prescription evidence, then requires a separate explicit approval', async () => {
    const user = userEvent.setup();
    let releaseRefetch: () => void = () => {};
    const onRefetch = vi.fn(
      () =>
        new Promise<void>(resolve => {
          releaseRefetch = resolve;
        })
    );
    const onEvidenceApproved = vi.fn();
    const { rerender } = render(
      <StrictMode>
        <SalePharmacyEvidenceSection
          enabled
          isLoading={false}
          isUnavailable={false}
          countryCode="CO"
          businessDate="2026-09-02"
          customerId="customer-1"
          customerValid
          canApproveEvidence
          requirements={[requirement]}
          selectedEvidenceIds={[]}
          ready={false}
          onToggleEvidence={vi.fn()}
          onEvidenceApproved={onEvidenceApproved}
          onRefetch={onRefetch}
        />
      </StrictMode>
    );

    await user.click(screen.getByText('Record prescription evidence'));
    await waitFor(() => {
      expect(screen.getByLabelText('Valid from')).toHaveValue('2026-09-02');
      expect(screen.getByLabelText('Expires on')).toHaveValue('2026-10-02');
    });
    await user.type(screen.getByLabelText('Prescription reference'), 'RX-CO-2026-001');
    await user.type(screen.getByLabelText('Prescriber name'), 'Dra. Laura Pérez');
    await user.type(screen.getByLabelText('Prescriber credential'), 'RETHUS-12345');
    await user.type(screen.getByLabelText('Buyer document (when required)'), 'CC-100000');
    await user.click(screen.getByRole('button', { name: 'Record evidence' }));

    expect(mutationState.calls).toEqual([
      {
        path: 'pharmacy.recordEvidence',
        input: {
          productId: 'medicine-1',
          customerId: 'customer-1',
          reference: 'RX-CO-2026-001',
          prescriberName: 'Dra. Laura Pérez',
          prescriberCredential: 'RETHUS-12345',
          buyerDocument: 'CC-100000',
          notes: null,
          authorizedQuantity: 2,
          validFrom: '2026-09-02',
          expiresAt: '2026-10-02',
        },
      },
    ]);
    expect(screen.getByRole('button', { name: 'Approve and select evidence' })).toBeVisible();
    expect(screen.getByLabelText('Medicine')).toBeEnabled();
    expect(screen.getByLabelText('Prescription reference')).toHaveValue('');
    expect(screen.getByLabelText('Prescriber name')).toHaveValue('');
    expect(screen.getByLabelText('Prescriber credential')).toHaveValue('');
    expect(screen.getByLabelText('Buyer document (when required)')).toHaveValue('');
    expect(onEvidenceApproved).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Approve and select evidence' }));
    await waitFor(() => expect(onRefetch).toHaveBeenCalledOnce());
    expect(mutationState.calls.at(-1)).toEqual({
      path: 'pharmacy.approveEvidence',
      input: { id: 'evidence-pending-1' },
    });
    expect(onEvidenceApproved).not.toHaveBeenCalled();
    releaseRefetch();
    await waitFor(() =>
      expect(
        screen.getByText('Approval was recorded. Refresh evidence if it does not appear yet.')
      ).toBeVisible()
    );
    expect(onEvidenceApproved).not.toHaveBeenCalled();

    rerender(
      <StrictMode>
        <SalePharmacyEvidenceSection
          enabled
          isLoading={false}
          isUnavailable={false}
          countryCode="CO"
          businessDate="2026-09-02"
          customerId="customer-1"
          customerValid
          canApproveEvidence
          requirements={[
            {
              ...requirement,
              eligibleEvidence: [{ id: 'evidence-pending-1', remainingQuantity: 2 }],
            },
          ]}
          selectedEvidenceIds={[]}
          ready
          onToggleEvidence={vi.fn()}
          onEvidenceApproved={onEvidenceApproved}
          onRefetch={onRefetch}
        />
      </StrictMode>
    );

    await waitFor(() => expect(onEvidenceApproved).toHaveBeenCalledWith('evidence-pending-1'));
  });

  it('keeps approval with an authorized employee instead of offering a doomed action', async () => {
    const user = userEvent.setup();
    render(
      <SalePharmacyEvidenceSection
        enabled
        isLoading={false}
        isUnavailable={false}
        countryCode="CO"
        businessDate="2026-09-02"
        customerId="customer-1"
        customerValid
        canApproveEvidence={false}
        requirements={[requirement]}
        selectedEvidenceIds={[]}
        ready={false}
        onToggleEvidence={vi.fn()}
        onEvidenceApproved={vi.fn()}
        onRefetch={vi.fn(async () => undefined)}
      />
    );

    await user.click(screen.getByText('Record prescription evidence'));
    await user.type(screen.getByLabelText('Prescription reference'), 'RX-PENDING-001');
    await user.type(screen.getByLabelText('Prescriber name'), 'Dr. External');
    await user.type(screen.getByLabelText('Prescriber credential'), 'MED-EXTERNAL');
    await user.click(screen.getByRole('button', { name: 'Record evidence' }));

    expect(screen.getByText(/pending approval by an employee/i)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Approve and select evidence' })
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Prescription reference')).toHaveValue('');
    expect(screen.getByLabelText('Prescriber name')).toHaveValue('');
    expect(screen.getByLabelText('Prescriber credential')).toHaveValue('');
    expect(mutationState.calls.map(call => call.path)).toEqual(['pharmacy.recordEvidence']);
  });

  it('re-approves a still-valid prescription after its previous authorization becomes unusable', async () => {
    const user = userEvent.setup();
    const onRefetch = vi.fn(async () => undefined);
    render(
      <SalePharmacyEvidenceSection
        enabled
        isLoading={false}
        isUnavailable={false}
        countryCode="CO"
        businessDate="2026-09-02"
        customerId="customer-1"
        customerValid
        canApproveEvidence
        requirements={[
          {
            ...requirement,
            reapprovalEvidence: [
              {
                id: 'evidence-reapproval-1',
                reasonCode: 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE',
              },
            ],
          },
        ]}
        selectedEvidenceIds={[]}
        ready={false}
        onToggleEvidence={vi.fn()}
        onEvidenceApproved={vi.fn()}
        onRefetch={onRefetch}
      />
    );

    expect(screen.getByText(/previous professional approval is no longer usable/i)).toBeVisible();
    expect(
      screen.getByText(/professional authorization is not active for this site/i)
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Re-approve evidence' }));

    expect(mutationState.calls.at(-1)).toEqual({
      path: 'pharmacy.approveEvidence',
      input: { id: 'evidence-reapproval-1' },
    });
    await waitFor(() => expect(onRefetch).toHaveBeenCalledOnce());
  });

  it('keeps sensitive evidence out of browser assistance and blocks an invalid date range', async () => {
    const user = userEvent.setup();
    render(
      <SalePharmacyEvidenceSection
        enabled
        isLoading={false}
        isUnavailable={false}
        countryCode="CO"
        businessDate="2026-09-02"
        customerId="customer-1"
        customerValid
        canApproveEvidence
        requirements={[requirement]}
        selectedEvidenceIds={[]}
        ready={false}
        onToggleEvidence={vi.fn()}
        onEvidenceApproved={vi.fn()}
        onRefetch={vi.fn(async () => undefined)}
      />
    );

    await user.click(screen.getByText('Record prescription evidence'));
    const reference = screen.getByLabelText('Prescription reference');
    const prescriberName = screen.getByLabelText('Prescriber name');
    const prescriberCredential = screen.getByLabelText('Prescriber credential');
    const buyerDocument = screen.getByLabelText('Buyer document (when required)');
    const notes = screen.getByLabelText('Restricted notes');

    for (const field of [reference, prescriberName, prescriberCredential, buyerDocument, notes]) {
      expect(field).toHaveAttribute('autocomplete', 'off');
      expect(field).toHaveAttribute('spellcheck', 'false');
    }
    expect(reference).toHaveAttribute('maxlength', '200');
    expect(prescriberName).toHaveAttribute('maxlength', '160');
    expect(prescriberCredential).toHaveAttribute('maxlength', '160');
    expect(buyerDocument).toHaveAttribute('maxlength', '120');
    expect(notes).toHaveAttribute('maxlength', '500');

    await user.type(reference, 'RX-DATE-001');
    await user.type(prescriberName, 'Dra. Fecha');
    await user.type(prescriberCredential, 'MED-DATE');
    fireEvent.change(screen.getByLabelText('Expires on'), {
      target: { value: '2026-09-01' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/expiry cannot be before/i);
    expect(screen.getByRole('button', { name: 'Record evidence' })).toBeDisabled();
    expect(mutationState.calls).toEqual([]);
  });

  it('retains separate pending approvals for every prescription product in the cart', async () => {
    const user = userEvent.setup();
    const onEvidenceApproved = vi.fn();
    const sharedProps = {
      enabled: true,
      isLoading: false,
      isUnavailable: false,
      countryCode: 'CO',
      businessDate: '2026-09-02',
      customerId: 'customer-1',
      customerValid: true,
      canApproveEvidence: true,
      ready: false,
      onToggleEvidence: vi.fn(),
      onEvidenceApproved,
      onRefetch: vi.fn(async () => undefined),
    };
    const { rerender } = render(
      <SalePharmacyEvidenceSection
        {...sharedProps}
        requirements={[requirement, secondRequirement]}
        selectedEvidenceIds={[]}
      />
    );

    await user.click(screen.getByText('Record prescription evidence'));
    await user.type(screen.getByLabelText('Prescription reference'), 'RX-MEDICINE-1');
    await user.type(screen.getByLabelText('Prescriber name'), 'Dra. Uno');
    await user.type(screen.getByLabelText('Prescriber credential'), 'MED-ONE');
    await user.click(screen.getByRole('button', { name: 'Record evidence' }));

    await user.selectOptions(screen.getByLabelText('Medicine'), 'medicine-2');
    expect(screen.getByLabelText('Prescription reference')).toHaveValue('');
    expect(screen.getByLabelText('Prescriber name')).toHaveValue('');
    expect(screen.getByLabelText('Prescriber credential')).toHaveValue('');
    await user.type(screen.getByLabelText('Prescription reference'), 'RX-MEDICINE-2');
    await user.type(screen.getByLabelText('Prescriber name'), 'Dr. Dos');
    await user.type(screen.getByLabelText('Prescriber credential'), 'MED-TWO');
    await user.click(screen.getByRole('button', { name: 'Record evidence' }));

    await user.selectOptions(screen.getByLabelText('Medicine'), 'medicine-1');
    await user.click(screen.getByRole('button', { name: 'Approve and select evidence' }));
    expect(onEvidenceApproved).not.toHaveBeenCalled();
    expect(mutationState.calls.at(-1)).toEqual({
      path: 'pharmacy.approveEvidence',
      input: { id: 'evidence-pending-1' },
    });

    rerender(
      <SalePharmacyEvidenceSection
        {...sharedProps}
        requirements={[
          {
            ...requirement,
            eligibleEvidence: [{ id: 'evidence-pending-1', remainingQuantity: 2 }],
          },
          secondRequirement,
        ]}
        selectedEvidenceIds={[]}
      />
    );

    await waitFor(() => expect(onEvidenceApproved).toHaveBeenCalledWith('evidence-pending-1'));

    rerender(
      <SalePharmacyEvidenceSection
        {...sharedProps}
        requirements={[
          {
            ...requirement,
            eligibleEvidence: [{ id: 'evidence-pending-1', remainingQuantity: 2 }],
          },
          secondRequirement,
        ]}
        selectedEvidenceIds={['evidence-pending-1']}
      />
    );

    await waitFor(() => expect(screen.getByLabelText('Medicine')).toHaveValue('medicine-2'));
    await user.click(screen.getByRole('button', { name: 'Approve and select evidence' }));
    expect(onEvidenceApproved).not.toHaveBeenCalledWith('evidence-pending-2');
    expect(mutationState.calls.at(-1)).toEqual({
      path: 'pharmacy.approveEvidence',
      input: { id: 'evidence-pending-2' },
    });

    rerender(
      <SalePharmacyEvidenceSection
        {...sharedProps}
        requirements={[
          {
            ...requirement,
            eligibleEvidence: [{ id: 'evidence-pending-1', remainingQuantity: 2 }],
          },
          {
            ...secondRequirement,
            eligibleEvidence: [{ id: 'evidence-pending-2', remainingQuantity: 1 }],
          },
        ]}
        selectedEvidenceIds={['evidence-pending-1']}
      />
    );

    await waitFor(() => expect(onEvidenceApproved).toHaveBeenCalledWith('evidence-pending-2'));
  });

  it('fails closed and offers an explicit retry when policy cannot be read', async () => {
    const user = userEvent.setup();
    const onRefetch = vi.fn(async () => undefined);
    render(
      <SalePharmacyEvidenceSection
        enabled
        isLoading={false}
        isUnavailable
        countryCode={null}
        businessDate={null}
        customerId="customer-1"
        customerValid
        canApproveEvidence
        requirements={[]}
        selectedEvidenceIds={[]}
        ready={false}
        onToggleEvidence={vi.fn()}
        onEvidenceApproved={vi.fn()}
        onRefetch={onRefetch}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/Checkout stays blocked/);
    await user.click(screen.getByRole('button', { name: 'Retry policy check' }));
    expect(onRefetch).toHaveBeenCalledOnce();
  });

  it('stays hidden after preflight confirms an ordinary retail cart', () => {
    render(
      <SalePharmacyEvidenceSection
        enabled
        isLoading={false}
        isUnavailable={false}
        countryCode="CO"
        businessDate="2026-09-02"
        customerId=""
        customerValid={null}
        canApproveEvidence={false}
        requirements={[]}
        selectedEvidenceIds={[]}
        ready
        onToggleEvidence={vi.fn()}
        onEvidenceApproved={vi.fn()}
        onRefetch={vi.fn(async () => undefined)}
      />
    );

    expect(screen.queryByTestId('sale-pharmacy-evidence')).not.toBeInTheDocument();
  });

  it('prevents selecting surplus evidence while keeping the chosen record removable', async () => {
    const user = userEvent.setup();
    const onToggleEvidence = vi.fn();
    render(
      <SalePharmacyEvidenceSection
        enabled
        isLoading={false}
        isUnavailable={false}
        countryCode="CO"
        businessDate="2026-09-02"
        customerId="customer-1"
        customerValid
        canApproveEvidence
        requirements={[
          {
            ...requirement,
            eligibleEvidence: [
              { id: 'evidence-full', remainingQuantity: 2 },
              { id: 'evidence-extra', remainingQuantity: 1 },
            ],
          },
        ]}
        selectedEvidenceIds={['evidence-full']}
        ready
        onToggleEvidence={onToggleEvidence}
        onEvidenceApproved={vi.fn()}
        onRefetch={vi.fn(async () => undefined)}
      />
    );

    const selected = screen.getByRole('checkbox', { name: /evidence nce-full/i });
    const surplus = screen.getByRole('checkbox', { name: /evidence ce-extra/i });
    expect(selected).toBeChecked();
    expect(selected).toBeEnabled();
    expect(surplus).toBeDisabled();
    expect(screen.getByText(/already covers this medicine/i)).toBeVisible();
    expect(screen.queryByText('Record prescription evidence')).not.toBeInTheDocument();

    await user.click(selected);
    expect(onToggleEvidence).toHaveBeenCalledWith('evidence-full', false);
  });

  it('refreshes evidence explicitly after another authorized employee approves it', async () => {
    const user = userEvent.setup();
    const onRefetch = vi.fn(async () => undefined);
    const onEvidenceApproved = vi.fn();
    const { rerender } = render(
      <SalePharmacyEvidenceSection
        enabled
        isLoading={false}
        isUnavailable={false}
        countryCode="CO"
        businessDate="2026-09-02"
        customerId="customer-1"
        customerValid
        canApproveEvidence
        requirements={[requirement]}
        selectedEvidenceIds={[]}
        ready={false}
        onToggleEvidence={vi.fn()}
        onEvidenceApproved={onEvidenceApproved}
        onRefetch={onRefetch}
      />
    );

    await user.click(screen.getByText('Record prescription evidence'));
    await user.type(screen.getByLabelText('Prescription reference'), 'RX-EXTERNAL-001');
    await user.type(screen.getByLabelText('Prescriber name'), 'Dr. External');
    await user.type(screen.getByLabelText('Prescriber credential'), 'MED-EXTERNAL');
    await user.click(screen.getByRole('button', { name: 'Record evidence' }));
    expect(screen.getByRole('button', { name: 'Approve and select evidence' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Refresh evidence' }));
    expect(onRefetch).toHaveBeenCalledOnce();

    rerender(
      <SalePharmacyEvidenceSection
        enabled
        isLoading={false}
        isUnavailable={false}
        countryCode="CO"
        businessDate="2026-09-02"
        customerId="customer-1"
        customerValid
        canApproveEvidence
        requirements={[
          {
            ...requirement,
            eligibleEvidence: [{ id: 'evidence-pending-1', remainingQuantity: 2 }],
          },
        ]}
        selectedEvidenceIds={[]}
        ready
        onToggleEvidence={vi.fn()}
        onEvidenceApproved={onEvidenceApproved}
        onRefetch={onRefetch}
      />
    );

    await waitFor(() => expect(onEvidenceApproved).toHaveBeenCalledWith('evidence-pending-1'));
    expect(
      screen.queryByRole('button', { name: 'Approve and select evidence' })
    ).not.toBeInTheDocument();
  });

  it('discards subject-bound evidence and sensitive fields when the customer changes', async () => {
    const user = userEvent.setup();
    const sharedProps = {
      enabled: true,
      isLoading: false,
      isUnavailable: false,
      countryCode: 'CO',
      businessDate: '2026-09-02',
      customerValid: true,
      canApproveEvidence: true,
      requirements: [requirement],
      selectedEvidenceIds: [],
      ready: false,
      onToggleEvidence: vi.fn(),
      onEvidenceApproved: vi.fn(),
      onRefetch: vi.fn(async () => undefined),
    };
    const { rerender } = render(
      <SalePharmacyEvidenceSection {...sharedProps} customerId="customer-1" />
    );

    await user.click(screen.getByText('Record prescription evidence'));
    await user.type(screen.getByLabelText('Prescription reference'), 'RX-CUSTOMER-1');
    await user.type(screen.getByLabelText('Prescriber name'), 'Dra. Subject');
    await user.type(screen.getByLabelText('Prescriber credential'), 'MED-SUBJECT');
    await user.type(screen.getByLabelText('Buyer document (when required)'), 'CC-PRIVATE');
    await user.click(screen.getByRole('button', { name: 'Record evidence' }));
    expect(screen.getByRole('button', { name: 'Approve and select evidence' })).toBeVisible();

    rerender(<SalePharmacyEvidenceSection {...sharedProps} customerId="customer-2" />);

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Approve and select evidence' })
      ).not.toBeInTheDocument()
    );
    await user.click(screen.getByText('Record prescription evidence'));
    expect(screen.getByLabelText('Prescription reference')).toHaveValue('');
    expect(screen.getByLabelText('Prescriber name')).toHaveValue('');
    expect(screen.getByLabelText('Prescriber credential')).toHaveValue('');
    expect(screen.getByLabelText('Buyer document (when required)')).toHaveValue('');
  });

  it('does not attach an approved prescription after the checkout subject changes', async () => {
    const user = userEvent.setup();
    let releaseRefetch: () => void = () => {};
    const onRefetch = vi.fn(
      () =>
        new Promise<void>(resolve => {
          releaseRefetch = resolve;
        })
    );
    const onEvidenceApproved = vi.fn();
    const sharedProps = {
      enabled: true,
      isLoading: false,
      isUnavailable: false,
      countryCode: 'CO',
      businessDate: '2026-09-02',
      customerValid: true,
      canApproveEvidence: true,
      requirements: [requirement],
      selectedEvidenceIds: [],
      ready: false,
      onToggleEvidence: vi.fn(),
      onEvidenceApproved,
      onRefetch,
    };
    const { rerender } = render(
      <SalePharmacyEvidenceSection {...sharedProps} customerId="customer-1" />
    );

    await user.click(screen.getByText('Record prescription evidence'));
    await user.type(screen.getByLabelText('Prescription reference'), 'RX-OLD-SUBJECT');
    await user.type(screen.getByLabelText('Prescriber name'), 'Dra. Subject');
    await user.type(screen.getByLabelText('Prescriber credential'), 'MED-SUBJECT');
    await user.click(screen.getByRole('button', { name: 'Record evidence' }));
    await user.click(screen.getByRole('button', { name: 'Approve and select evidence' }));
    await waitFor(() => expect(onRefetch).toHaveBeenCalledOnce());

    rerender(<SalePharmacyEvidenceSection {...sharedProps} customerId="customer-2" />);
    releaseRefetch();

    await user.click(screen.getByText('Record prescription evidence'));
    expect(screen.getByLabelText('Medicine')).toBeVisible();
    expect(onEvidenceApproved).not.toHaveBeenCalled();
  });

  it('blocks prescription quantities above the server-supported maximum', async () => {
    const user = userEvent.setup();
    render(
      <SalePharmacyEvidenceSection
        enabled
        isLoading={false}
        isUnavailable={false}
        countryCode="CO"
        businessDate="2026-09-02"
        customerId="customer-1"
        customerValid
        canApproveEvidence
        requirements={[requirement]}
        selectedEvidenceIds={[]}
        ready={false}
        onToggleEvidence={vi.fn()}
        onEvidenceApproved={vi.fn()}
        onRefetch={vi.fn(async () => undefined)}
      />
    );

    await user.click(screen.getByText('Record prescription evidence'));
    await user.type(screen.getByLabelText('Prescription reference'), 'RX-TOO-LARGE');
    await user.type(screen.getByLabelText('Prescriber name'), 'Dra. Laura Pérez');
    await user.type(screen.getByLabelText('Prescriber credential'), 'RETHUS-12345');
    const quantity = screen.getByLabelText('Authorized quantity');
    expect(quantity).toHaveAttribute('max', '1000000000');
    await user.clear(quantity);
    await user.type(quantity, '1000000001');

    expect(screen.getByRole('button', { name: 'Record evidence' })).toBeDisabled();
  });

  it('does not offer evidence recording for a policy-blocked medicine', () => {
    render(
      <SalePharmacyEvidenceSection
        enabled
        isLoading={false}
        isUnavailable={false}
        countryCode="CO"
        businessDate="2026-09-02"
        customerId="customer-1"
        customerValid
        canApproveEvidence
        requirements={[
          {
            ...requirement,
            classification: 'controlled',
            blockedErrorCode: 'PHARMACY_CONTROLLED_NOT_ENABLED',
          },
        ]}
        selectedEvidenceIds={[]}
        ready={false}
        onToggleEvidence={vi.fn()}
        onEvidenceApproved={vi.fn()}
        onRefetch={vi.fn(async () => undefined)}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/Controlled medicines are disabled/i);
    expect(screen.queryByText('Record prescription evidence')).not.toBeInTheDocument();
  });
});
