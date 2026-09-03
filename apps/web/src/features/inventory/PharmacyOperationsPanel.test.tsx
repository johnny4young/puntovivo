import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor, within } from '@/test/utils';
import { PharmacyAuthorizationPanel } from './PharmacyAuthorizationPanel';
import { PharmacyEvidencePanel } from './PharmacyEvidencePanel';
import { PharmacyLotSafetyPanel } from './PharmacyLotSafetyPanel';
import { PharmacyOperationsPanel } from './PharmacyOperationsPanel';
import { PharmacyRecallPanel } from './PharmacyRecallPanel';

const testState = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'manager',
  criticalCalls: [] as Array<{ path: string; input: unknown }>,
  usersQueryEnabled: null as boolean | null,
  productListInputs: [] as unknown[],
  productSearchInputs: [] as unknown[],
  providerListInputs: [] as unknown[],
  evidenceInputs: [] as unknown[],
  recallInputs: [] as unknown[],
  authorizationInputs: [] as unknown[],
  approvalCapabilityErrorCode: null as
    'PHARMACY_AUTHORIZATION_INVALID' | 'PHARMACY_EVIDENCE_KEY_UNAVAILABLE' | null,
  productSearchHasMatch: true,
  evidenceTotal: 1,
  recallTotal: 1,
  authorizationTotal: 1,
  authorizationUserIsActive: true,
  lotStatus: 'active' as 'active' | 'depleted' | 'expired' | 'quarantined' | 'recalled',
  activeRecallCount: 0,
  evidenceStatus: 'pending' as 'pending' | 'approved' | 'consumed' | 'revoked',
  evidenceApprovalErrorCode: null as
    'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE' | 'PHARMACY_AUTHORIZATION_INVALID' | null,
  evidencePolicyMismatch: false,
  evidenceValidFrom: '2026-09-02',
  evidenceExpiresAt: '2026-10-02',
}));

const queryBase = {
  isLoading: false,
  isFetching: false,
  isError: false,
  error: null,
  refetch: vi.fn(async () => undefined),
};

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'admin-1', role: testState.role } }),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({
    currentSite: { id: 'site-1', name: 'Main Pharmacy' },
    sites: [
      { id: 'site-1', name: 'Main Pharmacy' },
      { id: 'site-2', name: 'North Pharmacy' },
    ],
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (
    path: string,
    options?: { onSuccess?: (data: Record<string, unknown>) => unknown }
  ) => ({
    mutate: (input: unknown) => {
      testState.criticalCalls.push({ path, input });
      const outputs: Record<string, Record<string, unknown>> = {
        'pharmacy.transitionLot': { id: 'lot-1', status: 'quarantined' },
        'pharmacy.destroyLot': { lotId: 'lot-1', onHand: 3 },
        'pharmacy.createRecall': { id: 'recall-1', status: 'active', lotCount: 1 },
        'pharmacy.closeRecall': { id: 'recall-1', status: 'closed' },
        'pharmacy.approveEvidence': { id: 'evidence-1', status: 'approved' },
        'pharmacy.revokeEvidence': { id: 'evidence-1', status: 'revoked' },
        'pharmacy.createAuthorization': { id: 'authorization-new', status: 'active' },
        'pharmacy.revokeAuthorization': { id: 'authorization-1', status: 'revoked' },
      };
      void options?.onSuccess?.(outputs[path] ?? {});
    },
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock('@/lib/trpc', () => {
  const invalidator = () => ({ invalidate: vi.fn(async () => undefined) });
  return {
    trpc: {
      useUtils: () => ({
        pharmacy: {
          listRecalls: invalidator(),
          getRecall: invalidator(),
          affectedSales: invalidator(),
          listEvidence: invalidator(),
          checkoutRequirements: invalidator(),
          listAuthorizations: invalidator(),
          context: invalidator(),
        },
        inventoryLots: { list: invalidator(), expiring: invalidator() },
        inventory: {
          listMovements: invalidator(),
          listStock: invalidator(),
          listBalancesBySite: invalidator(),
        },
        products: { list: invalidator(), search: invalidator() },
      }),
      products: {
        list: {
          useQuery: (input: unknown) => {
            testState.productListInputs.push(input);
            return {
              ...queryBase,
              data: {
                items: [
                  {
                    id: 'medicine-1',
                    name: 'Acetaminophen 500 mg',
                    sku: 'MED-001',
                    tracksStock: true,
                    tracksLots: true,
                    isActive: false,
                    pharmacy: { classification: 'prescription' },
                  },
                ],
              },
            };
          },
        },
        search: {
          useQuery: (input: unknown) => {
            testState.productSearchInputs.push(input);
            return {
              ...queryBase,
              data: {
                items: testState.productSearchHasMatch
                  ? [
                      {
                        id: 'medicine-1',
                        name: 'Acetaminophen 500 mg',
                        sku: 'MED-001',
                        tracksStock: true,
                        tracksLots: true,
                        isActive: false,
                        pharmacy: { classification: 'prescription' },
                      },
                    ]
                  : [],
              },
            };
          },
        },
      },
      providers: {
        list: {
          useQuery: (input: unknown) => {
            testState.providerListInputs.push(input);
            return {
              ...queryBase,
              data: { items: [{ id: 'provider-1', name: 'Trusted Lab', isActive: false }] },
            };
          },
        },
      },
      users: {
        list: {
          useQuery: (_input: unknown, options: { enabled?: boolean }) => {
            testState.usersQueryEnabled = options.enabled ?? true;
            return {
              ...queryBase,
              data: { items: [{ id: 'admin-1', name: 'Ana Manager', role: 'admin' }] },
            };
          },
        },
      },
      inventoryLots: {
        list: {
          useQuery: () => ({
            ...queryBase,
            data: {
              items: [
                {
                  id: 'lot-1',
                  lotNumber: 'LOT-2026-A',
                  expiresAt: '2027-01-20',
                  onHand: 5,
                  status: testState.lotStatus,
                  activeRecallCount: testState.activeRecallCount,
                },
              ],
            },
          }),
        },
      },
      pharmacy: {
        context: {
          useQuery: () => ({
            ...queryBase,
            data: {
              countryCode: 'CO',
              businessDate: '2026-09-02',
              canApproveEvidence: false,
              approvalCapabilityErrorCode: testState.approvalCapabilityErrorCode,
              hasOperationalData: true,
            },
          }),
        },
        listRecalls: {
          useQuery: (input: unknown) => {
            testState.recallInputs.push(input);
            return {
              ...queryBase,
              data: {
                items: [
                  {
                    id: 'recall-1',
                    scopeType: 'product',
                    productId: 'medicine-1',
                    productName: 'Acetaminophen 500 mg',
                    reason: 'Manufacturer quality withdrawal',
                    status: 'active',
                    initiatedAt: '2026-09-02T10:00:00.000Z',
                    lotCount: 1,
                  },
                ],
                total: testState.recallTotal,
                page: 1,
                perPage: 25,
              },
            };
          },
        },
        getRecall: {
          useQuery: (_input: unknown, options: { enabled?: boolean }) => ({
            ...queryBase,
            data: options.enabled
              ? {
                  id: 'recall-1',
                  scopeType: 'product',
                  productId: 'medicine-1',
                  productName: 'Acetaminophen 500 mg',
                  reason: 'Manufacturer quality withdrawal',
                  status: 'active',
                  initiatedAt: '2026-09-02T10:00:00.000Z',
                  lots: [
                    {
                      lotId: 'lot-1',
                      productName: 'Acetaminophen 500 mg',
                      lotNumber: 'LOT-2026-A',
                      expiresAt: '2027-01-20',
                      onHand: 5,
                      status: 'recalled',
                    },
                  ],
                  lotsTotal: 1,
                  lotsPage: 1,
                  lotsPerPage: 25,
                }
              : undefined,
          }),
        },
        affectedSales: {
          useQuery: (_input: unknown, options: { enabled?: boolean }) => ({
            ...queryBase,
            data: options.enabled
              ? {
                  items: [
                    {
                      saleItemId: 'sale-item-1',
                      lotId: 'lot-1',
                      saleNumber: 'VTA-100',
                      soldAt: '2026-09-01T15:00:00.000Z',
                      customerName: testState.role === 'admin' ? 'Customer One' : null,
                      customerEmail:
                        testState.role === 'admin' ? 'customer.one@example.test' : null,
                      customerPhone: testState.role === 'admin' ? '+57 300 555 0101' : null,
                      customerIdentityRestricted: testState.role !== 'admin',
                      lotNumber: 'LOT-2026-A',
                      quantity: 1,
                    },
                  ],
                  total: 1,
                  page: 1,
                  perPage: 25,
                }
              : undefined,
          }),
        },
        listEvidence: {
          useQuery: (input: unknown) => {
            testState.evidenceInputs.push(input);
            return {
              ...queryBase,
              data: {
                items: [
                  {
                    id: 'evidence-1',
                    productName: 'Acetaminophen 500 mg',
                    customerName: 'Customer One',
                    countryCode: 'CO',
                    authorizedQuantity: 2,
                    dispensedQuantity: 0,
                    validFrom: testState.evidenceValidFrom,
                    expiresAt: testState.evidenceExpiresAt,
                    status: testState.evidenceStatus,
                    policyMismatch: testState.evidencePolicyMismatch,
                    approvalErrorCode: testState.evidenceApprovalErrorCode,
                    createdAt: '2026-09-02T11:00:00.000Z',
                  },
                ],
                total: testState.evidenceTotal,
                page: 1,
                perPage: 25,
              },
            };
          },
        },
        listAuthorizations: {
          useQuery: (input: unknown) => {
            testState.authorizationInputs.push(input);
            return {
              ...queryBase,
              data: {
                items: [
                  {
                    id: 'authorization-1',
                    userName: 'Ana Manager',
                    userIsActive: testState.authorizationUserIsActive,
                    siteName: 'Main Pharmacy',
                    countryCode: 'CO',
                    credentialType: 'pharmacist-license',
                    validFrom: '2026-01-01',
                    validUntil: '2027-01-01',
                    status: 'active',
                    createdAt: '2026-01-01T10:00:00.000Z',
                  },
                ],
                total: testState.authorizationTotal,
                page: 1,
                perPage: 25,
              },
            };
          },
        },
      },
    },
  };
});

describe('pharmacy operations self-management', () => {
  beforeEach(() => {
    testState.role = 'admin';
    testState.criticalCalls = [];
    testState.usersQueryEnabled = null;
    testState.productListInputs = [];
    testState.productSearchInputs = [];
    testState.providerListInputs = [];
    testState.evidenceInputs = [];
    testState.recallInputs = [];
    testState.authorizationInputs = [];
    testState.approvalCapabilityErrorCode = null;
    testState.productSearchHasMatch = true;
    testState.evidenceTotal = 1;
    testState.recallTotal = 1;
    testState.authorizationTotal = 1;
    testState.authorizationUserIsActive = true;
    testState.lotStatus = 'active';
    testState.activeRecallCount = 0;
    testState.evidenceStatus = 'pending';
    testState.evidenceApprovalErrorCode = null;
    testState.evidencePolicyMismatch = false;
    testState.evidenceValidFrom = '2026-09-02';
    testState.evidenceExpiresAt = '2026-10-02';
  });

  it('uses the authoritative tenant policy context and exposes all operational areas', async () => {
    const user = userEvent.setup();
    render(<PharmacyOperationsPanel />);

    expect(screen.getByRole('heading', { name: 'Pharmacy safety operations' })).toBeVisible();
    expect(screen.getByText('Policy country · CO')).toBeVisible();
    expect(screen.getByText('Business date · 2026-09-02')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'Recalls' }));
    expect(await screen.findByRole('heading', { name: 'Start a recall' })).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Prescription evidence' }));
    expect(
      await screen.findByRole('heading', { name: 'Prescription evidence review' })
    ).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Professional authorizations' }));
    expect(
      await screen.findByRole('heading', { name: 'Register a professional authorization' })
    ).toBeVisible();
  });

  it('keeps custody and authorization recovery reachable when approval integrity fails', async () => {
    testState.approvalCapabilityErrorCode = 'PHARMACY_AUTHORIZATION_INVALID';
    const user = userEvent.setup();
    render(<PharmacyOperationsPanel />);

    expect(screen.getByTestId('pharmacy-approval-integrity-warning')).toHaveTextContent(
      /professional credential could not be verified/i
    );
    expect(screen.getByTestId('pharmacy-approval-integrity-warning')).toHaveTextContent(
      /revoke and recreate the affected authorization/i
    );
    expect(screen.getByRole('heading', { name: 'Physical lot' })).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'Professional authorizations' }));
    expect(
      await screen.findByRole('heading', { name: 'Register a professional authorization' })
    ).toBeVisible();
  });

  it('does not recommend revoking valid authorizations when the evidence key is unavailable', () => {
    testState.approvalCapabilityErrorCode = 'PHARMACY_EVIDENCE_KEY_UNAVAILABLE';
    render(<PharmacyOperationsPanel />);

    const warning = screen.getByTestId('pharmacy-approval-integrity-warning');
    expect(warning).toHaveTextContent(/do not revoke valid authorizations/i);
    expect(warning).toHaveTextContent(/restore the pharmacy evidence key/i);
    expect(warning).not.toHaveTextContent(/revoke and recreate the affected authorization/i);
  });

  it('records exact lot safety transitions and destruction with an auditable reason', async () => {
    const user = userEvent.setup();
    render(<PharmacyLotSafetyPanel />);

    await user.selectOptions(screen.getByLabelText('Medicine'), 'medicine-1');
    await user.selectOptions(screen.getByLabelText('Lot'), 'lot-1');
    expect(screen.getByText('Jan 20, 2027')).toBeVisible();
    expect(screen.queryByText('Jan 19, 2027')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Auditable reason'), 'Cold room inspection failed');
    await user.click(screen.getByRole('button', { name: 'Quarantine' }));

    expect(testState.criticalCalls).toContainEqual({
      path: 'pharmacy.transitionLot',
      input: {
        lotId: 'lot-1',
        action: 'quarantine',
        reason: 'Cold room inspection failed',
      },
    });

    await user.clear(screen.getByLabelText('Auditable reason'));
    await user.type(screen.getByLabelText('Auditable reason'), 'Verified physical destruction');
    await user.type(screen.getByLabelText('Exact quantity to destroy'), '2');
    await user.click(screen.getByRole('button', { name: 'Record destruction' }));

    expect(testState.criticalCalls).toContainEqual({
      path: 'pharmacy.destroyLot',
      input: {
        lotId: 'lot-1',
        quantity: 2,
        reason: 'Verified physical destruction',
      },
    });
  });

  it('clears an auditable reason when the custody target changes', async () => {
    const user = userEvent.setup();
    render(<PharmacyLotSafetyPanel />);

    await user.selectOptions(screen.getByLabelText('Medicine'), 'medicine-1');
    await user.selectOptions(screen.getByLabelText('Lot'), 'lot-1');
    await user.type(screen.getByLabelText('Auditable reason'), 'Reason bound to the first target');

    await user.selectOptions(screen.getByLabelText('Lot'), '');
    expect(screen.getByLabelText('Auditable reason')).toHaveValue('');

    await user.selectOptions(screen.getByLabelText('Lot'), 'lot-1');
    await user.type(screen.getByLabelText('Auditable reason'), 'Reason bound to this lot');
    await user.selectOptions(screen.getByLabelText('Medicine'), '');
    expect(screen.getByLabelText('Auditable reason')).toHaveValue('');
  });

  it('does not offer a doomed lot release while an active recall still covers it', async () => {
    testState.lotStatus = 'recalled';
    testState.activeRecallCount = 1;
    const user = userEvent.setup();
    render(<PharmacyLotSafetyPanel />);

    await user.selectOptions(screen.getByLabelText('Medicine'), 'medicine-1');
    await user.selectOptions(screen.getByLabelText('Lot'), 'lot-1');
    await user.type(screen.getByLabelText('Auditable reason'), 'Recall review completed');

    expect(screen.getByRole('button', { name: 'Release after review' })).toBeDisabled();
    expect(screen.getByText(/Close every active recall/)).toBeVisible();
  });

  it('uses indexed pharmacy search and preserves an already selected medicine', async () => {
    testState.productSearchHasMatch = false;
    const user = userEvent.setup();
    render(<PharmacyLotSafetyPanel />);

    const medicine = screen.getByLabelText('Medicine');
    await user.selectOptions(medicine, 'medicine-1');
    await user.type(screen.getByLabelText('Search medicines'), 'ibuprofen');

    await waitFor(() =>
      expect(testState.productSearchInputs).toContainEqual({
        q: 'ibuprofen',
        limit: 50,
        tracksStock: true,
        pharmacyOnly: true,
      })
    );
    expect(testState.productListInputs).toContainEqual(
      expect.objectContaining({ pharmacyOnly: true })
    );
    expect(medicine).toHaveValue('medicine-1');
    expect(
      within(medicine).getByRole('option', { name: /Acetaminophen 500 mg.*Inactive/ })
    ).toBeVisible();
  });

  it('keeps inactive suppliers available for historical safety recalls', async () => {
    const user = userEvent.setup();
    render(<PharmacyRecallPanel />);

    await user.selectOptions(screen.getByLabelText('Recall scope'), 'provider');
    await waitFor(() =>
      expect(testState.providerListInputs).toContainEqual({
        page: 1,
        perPage: 50,
        search: undefined,
      })
    );
    expect(
      within(screen.getByLabelText('Provider')).getByRole('option', {
        name: /Trusted Lab.*Inactive/,
      })
    ).toBeVisible();
  });

  it('clamps the one-year authorization default at the end of a leap February', () => {
    render(<PharmacyAuthorizationPanel isAdmin countryCode="CO" businessDate="2028-02-29" />);

    expect(screen.getByLabelText('Valid from')).toHaveValue('2028-02-29');
    expect(screen.getByLabelText('Valid until')).toHaveValue('2029-02-28');
  });

  it('pages evidence, recalls and authorization registers instead of truncating at 50 rows', async () => {
    const user = userEvent.setup();
    testState.evidenceTotal = 26;
    const evidenceView = render(
      <PharmacyEvidencePanel businessDate="2026-09-02" countryCode="CO" />
    );
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(testState.evidenceInputs).toContainEqual({
        page: 2,
        perPage: 25,
        status: 'pending',
      })
    );
    evidenceView.unmount();

    testState.recallTotal = 26;
    const recallView = render(<PharmacyRecallPanel />);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(testState.recallInputs).toContainEqual({
        page: 2,
        perPage: 25,
        status: 'active',
      })
    );
    recallView.unmount();

    testState.authorizationTotal = 26;
    render(<PharmacyAuthorizationPanel isAdmin countryCode="CO" businessDate="2026-09-02" />);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(testState.authorizationInputs).toContainEqual({
        page: 2,
        perPage: 25,
        activeOnly: false,
      })
    );
  });

  it('starts a recall and exposes exact affected lots and completed sales before closing', async () => {
    const user = userEvent.setup();
    render(<PharmacyRecallPanel />);

    await user.selectOptions(screen.getByLabelText('Medicine'), 'medicine-1');
    await user.type(screen.getByLabelText('Auditable reason'), 'Reason for the wrong target');
    await user.selectOptions(screen.getByLabelText('Medicine'), '');
    expect(screen.getByLabelText('Auditable reason')).toHaveValue('');
    await user.selectOptions(screen.getByLabelText('Medicine'), 'medicine-1');
    await user.type(screen.getByLabelText('Auditable reason'), 'Manufacturer quality withdrawal');
    await user.click(screen.getByRole('button', { name: 'Start recall and block lots' }));

    expect(testState.criticalCalls).toContainEqual({
      path: 'pharmacy.createRecall',
      input: {
        scopeType: 'product',
        productId: 'medicine-1',
        reason: 'Manufacturer quality withdrawal',
      },
    });

    const detailHeading = await screen.findByRole('heading', { name: 'Recall detail' });
    const detailSection = detailHeading.closest('section');
    expect(detailSection).not.toBeNull();
    expect(within(detailSection!).getAllByText('Acetaminophen 500 mg')).toHaveLength(2);
    expect(within(detailSection!).getAllByText('LOT-2026-A')).toHaveLength(2);
    expect(within(detailSection!).getByText('VTA-100')).toBeVisible();
    expect(within(detailSection!).getByText('Customer One')).toBeVisible();
    expect(within(detailSection!).getByText('customer.one@example.test')).toBeVisible();
    expect(within(detailSection!).getByText('+57 300 555 0101')).toBeVisible();
    await user.type(
      screen.getByLabelText('Reason for closing the recall'),
      'Official close notice received'
    );
    await user.click(screen.getByRole('button', { name: 'Close recall' }));

    expect(testState.criticalCalls).toContainEqual({
      path: 'pharmacy.closeRecall',
      input: { id: 'recall-1', reason: 'Official close notice received' },
    });
  });

  it('redacts recall customer identity from managers while retaining an operational marker', async () => {
    testState.role = 'manager';
    const user = userEvent.setup();
    render(<PharmacyRecallPanel />);

    await user.click(screen.getByText('Manufacturer quality withdrawal'));
    expect(await screen.findByText('Identity restricted · customer ID retained')).toBeVisible();
    expect(screen.queryByText('Customer One')).not.toBeInTheDocument();
    expect(screen.queryByText('customer.one@example.test')).not.toBeInTheDocument();
    expect(screen.queryByText('+57 300 555 0101')).not.toBeInTheDocument();
    expect(screen.getByText(/Customer identity is redacted for managers/)).toBeVisible();
  });

  it('approves and revokes only the minimal, non-secret evidence projection', async () => {
    const user = userEvent.setup();
    render(<PharmacyEvidencePanel businessDate="2026-09-02" countryCode="CO" canApproveEvidence />);

    expect(screen.getByText(/intentionally omits prescription references/)).toBeVisible();
    expect(screen.queryByText(/prescriber credential value/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(testState.criticalCalls).toContainEqual({
      path: 'pharmacy.approveEvidence',
      input: { id: 'evidence-1' },
    });

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.type(screen.getByLabelText('Auditable reason'), 'Evidence withdrawn by reviewer');
    await user.click(screen.getByRole('button', { name: 'Confirm revocation' }));
    expect(testState.criticalCalls).toContainEqual({
      path: 'pharmacy.revokeEvidence',
      input: { id: 'evidence-1', reason: 'Evidence withdrawn by reviewer' },
    });
  });

  it('shows and repairs an approved prescription whose professional authorization expired', async () => {
    testState.evidenceStatus = 'approved';
    testState.evidenceApprovalErrorCode = 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE';
    const user = userEvent.setup();
    render(<PharmacyEvidencePanel businessDate="2026-09-02" countryCode="CO" canApproveEvidence />);

    expect(screen.getByText('Re-approval required')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Re-approve' }));
    expect(testState.criticalCalls).toContainEqual({
      path: 'pharmacy.approveEvidence',
      input: { id: 'evidence-1' },
    });
  });

  it('marks evidence frozen under another effective policy without offering re-approval', () => {
    testState.evidenceStatus = 'approved';
    testState.evidencePolicyMismatch = true;
    testState.evidenceApprovalErrorCode = 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE';

    render(<PharmacyEvidencePanel businessDate="2026-09-02" countryCode="CO" canApproveEvidence />);

    expect(screen.getByText('Current policy does not match')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Re-approve' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeVisible();
  });

  it('lets an administrator register and revoke a sealed professional credential', async () => {
    const user = userEvent.setup();
    render(<PharmacyAuthorizationPanel isAdmin countryCode="CO" businessDate="2026-09-02" />);

    await user.selectOptions(screen.getByLabelText('Authorized employee'), 'admin-1');
    const credential = screen.getByLabelText('Verified credential');
    expect(credential).toHaveAttribute('autocomplete', 'new-password');
    expect(credential).toHaveAttribute('spellcheck', 'false');
    await user.type(credential, 'RETHUS-VERIFIED-1');
    await user.click(screen.getByRole('button', { name: 'Register authorization' }));
    expect(testState.criticalCalls).toContainEqual({
      path: 'pharmacy.createAuthorization',
      input: expect.objectContaining({
        userId: 'admin-1',
        siteId: 'site-1',
        countryCode: 'CO',
        credential: 'RETHUS-VERIFIED-1',
        validFrom: '2026-09-02',
      }),
    });

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.type(screen.getByLabelText('Auditable reason'), 'Authorization no longer effective');
    await user.click(screen.getByRole('button', { name: 'Confirm revocation' }));
    expect(testState.criticalCalls).toContainEqual({
      path: 'pharmacy.revokeAuthorization',
      input: { id: 'authorization-1', reason: 'Authorization no longer effective' },
    });
  });

  it('clears a sealed credential when its authorization subject changes', async () => {
    const user = userEvent.setup();
    const view = render(
      <PharmacyAuthorizationPanel isAdmin countryCode="CO" businessDate="2026-09-02" />
    );

    await user.selectOptions(screen.getByLabelText('Authorized employee'), 'admin-1');
    await user.type(screen.getByLabelText('Verified credential'), 'RETHUS-SUBJECT-BOUND');
    await user.selectOptions(screen.getByLabelText('Site scope'), 'site-2');
    expect(screen.getByLabelText('Verified credential')).toHaveValue('');

    await user.type(screen.getByLabelText('Verified credential'), 'RETHUS-ROLE-BOUND');
    view.rerender(
      <PharmacyAuthorizationPanel isAdmin={false} countryCode="CO" businessDate="2026-09-02" />
    );
    view.rerender(
      <PharmacyAuthorizationPanel isAdmin countryCode="CO" businessDate="2026-09-02" />
    );
    expect(screen.getByLabelText('Verified credential')).toHaveValue('');
  });

  it('keeps credential mutations admin-only while managers can inspect status', async () => {
    testState.role = 'manager';
    render(
      <PharmacyAuthorizationPanel isAdmin={false} countryCode="CO" businessDate="2026-09-02" />
    );

    expect(screen.getByText(/Managers can review authorization status/)).toBeVisible();
    expect(screen.getByText('Ana Manager')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Register authorization' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    await waitFor(() => expect(testState.usersQueryEnabled).toBe(false));
  });

  it('closes a pending authorization revocation when administrator access is lost', async () => {
    const user = userEvent.setup();
    const view = render(
      <PharmacyAuthorizationPanel isAdmin countryCode="CO" businessDate="2026-09-02" />
    );

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(screen.getByText("Revoke Ana Manager's authorization")).toBeVisible();

    testState.role = 'manager';
    view.rerender(
      <PharmacyAuthorizationPanel isAdmin={false} countryCode="CO" businessDate="2026-09-02" />
    );

    expect(screen.queryByText("Revoke Ana Manager's authorization")).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm revocation' })).not.toBeInTheDocument();
  });

  it('shows when an otherwise active authorization belongs to an inactive employee', () => {
    testState.authorizationUserIsActive = false;
    render(<PharmacyAuthorizationPanel isAdmin countryCode="CO" businessDate="2026-09-02" />);

    expect(screen.getByText('Employee inactive')).toBeVisible();
  });

  it('shows calendar-effective authorization status instead of the stored lifecycle state', () => {
    const expiredView = render(
      <PharmacyAuthorizationPanel isAdmin countryCode="CO" businessDate="2028-01-02" />
    );
    expect(screen.getByText('Expired')).toBeVisible();
    expiredView.unmount();

    render(<PharmacyAuthorizationPanel isAdmin countryCode="CO" businessDate="2025-12-31" />);
    expect(screen.getByText('Not yet effective')).toBeVisible();
  });

  it('shows calendar-effective evidence status and does not offer impossible approval', () => {
    testState.evidenceStatus = 'approved';
    testState.evidenceExpiresAt = '2026-09-01';
    const expiredView = render(
      <PharmacyEvidencePanel businessDate="2026-09-02" countryCode="CO" />
    );
    expect(screen.getByText('Expired')).toBeVisible();
    expiredView.unmount();

    testState.evidenceStatus = 'pending';
    testState.evidenceValidFrom = '2026-09-03';
    testState.evidenceExpiresAt = '2026-10-02';
    render(<PharmacyEvidencePanel businessDate="2026-09-02" countryCode="CO" />);
    expect(screen.getByText('Not yet effective')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeVisible();
  });

  it('keeps effective pending evidence read-only for approval without a professional authorization', () => {
    render(
      <PharmacyEvidencePanel
        businessDate="2026-09-02"
        countryCode="CO"
        canApproveEvidence={false}
      />
    );

    expect(screen.getByTestId('pharmacy-evidence-approval-unavailable')).toHaveTextContent(
      /does not have an effective professional authorization/i
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeVisible();
  });
});
