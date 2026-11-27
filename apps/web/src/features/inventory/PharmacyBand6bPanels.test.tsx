import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { PharmacyAlternatives } from '@/features/sales/PharmacyAlternatives';
import { PharmacyTicketNotices } from '@/features/sales/PharmacyTicketNotices';
import { pharmacyLineHint } from '@/features/sales/pharmacyRegister';
import { buildProductPharmacyPayload } from '@/features/products/productPharmacyPayload';
import { PharmacyEnvironmentalPanel } from './PharmacyEnvironmentalPanel';
import { PharmacyFnePanel } from './PharmacyFnePanel';
import { PharmacyFractionationPanel } from './PharmacyFractionationPanel';
import { PharmacyInvimaPanel } from './PharmacyInvimaPanel';

const mockMutate = vi.fn();

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({
    currentSite: { id: 'site-1', name: 'Sede Norte' },
    sites: [{ id: 'site-1', name: 'Sede Norte' }],
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      inventoryLots: { list: { invalidate: vi.fn() } },
      inventory: {
        listStock: { invalidate: vi.fn() },
        listBalancesBySite: { invalidate: vi.fn() },
        listMovements: { invalidate: vi.fn() },
      },
      pharmacy: {
        listFractionations: { invalidate: vi.fn() },
        getFneMonthlyReport: { invalidate: vi.fn() },
        listEnvironmentalLogs: { invalidate: vi.fn() },
        getEnvironmentalReport: { invalidate: vi.fn() },
        searchInvimaCatalog: { invalidate: vi.fn() },
        listFneAuthorizations: { invalidate: vi.fn() },
        context: { invalidate: vi.fn() },
        listCustomerAllergies: { invalidate: vi.fn() },
      },
      products: { list: { invalidate: vi.fn() } },
    }),
    products: {
      list: {
        useQuery: () => ({
          data: {
            items: [
              {
                id: 'p-box',
                name: 'Loratadina Caja x 30',
                sku: 'LOR-30',
                tracksLots: true,
                tracksStock: true,
                isActive: true,
                pharmacy: { classification: 'otc' },
              },
            ],
          },
        }),
      },
    },
    inventoryLots: {
      list: { useQuery: () => ({ data: { items: [] } }) },
    },
    users: {
      list: { useQuery: () => ({ data: [{ id: 'u-qf', name: 'Dra. Gómez', isActive: true }] }) },
    },
    customers: {
      list: {
        useQuery: () => ({ data: { items: [{ id: 'c-1', name: 'María', taxId: '1020' }] } }),
      },
    },
    pharmacy: {
      listFractionations: {
        useQuery: () => ({
          data: {
            items: [
              {
                id: 'frac-1',
                sourceQuantity: 1,
                sourceProductName: 'Loratadina Caja x 30',
                targetQuantity: 3,
                targetProductName: 'Loratadina Blíster x 10',
                lotNumber: 'L-2026-01',
                expiresAt: '2028-12-31',
                sanitaryRegistration: 'INVIMA 2025M-001',
                actorName: 'QF Sede',
              },
            ],
            total: 1,
          },
        }),
      },
      listEnvironmentalLogs: {
        useQuery: () => ({
          data: {
            items: [
              {
                id: 'env-1',
                businessDate: '2026-11-27',
                period: 'afternoon',
                zone: 'refrigerator',
                temperatureC: 10.2,
                humidityPercent: null,
                isOutOfRange: true,
                correctiveAction: 'Traslado a nevera respaldo',
                recordedByName: 'QF Sede',
              },
            ],
            total: 1,
          },
        }),
      },
      getEnvironmentalReport: {
        useQuery: () => ({
          data: {
            standard: 'Resolución 1403 de 2007 (Colombia)',
            fromDate: '2026-11-01',
            toDate: '2026-11-27',
            siteName: 'Sede Norte',
            companyName: 'Droguería Ejemplo',
            companyTaxId: '900123456-1',
            totalReadings: 1,
            deviationCount: 1,
            ambient: {
              count: 0,
              deviations: 0,
              minTempC: null,
              maxTempC: null,
              maxHumidityPercent: null,
            },
            refrigerator: {
              count: 1,
              deviations: 1,
              minTempC: 10.2,
              maxTempC: 10.2,
              maxHumidityPercent: null,
            },
            readings: [],
          },
        }),
      },
      importInvimaCatalog: {
        useMutation: () => ({ mutate: mockMutate, isPending: false }),
      },
      searchInvimaCatalog: {
        useQuery: () => ({
          data: {
            items: [
              {
                id: 'inv-1',
                cumCode: '19991001-01',
                productName: 'ACETAMINOFEN 500 MG',
                activeIngredient: 'ACETAMINOFEN',
                concentration: '500 mg',
                presentation: 'CAJA X 30',
                sanitaryRegistration: 'INVIMA 2024M-001',
                registrationExpiresAt: '2029-12-31',
                registrationStatus: 'vigente',
                classification: 'otc',
              },
            ],
            total: 1,
          },
        }),
      },
      listFneAuthorizations: {
        useQuery: () => ({
          data: {
            items: [
              {
                id: 'fne-1',
                resolutionNumber: 'RES-FNE-2026-09',
                responsibleUserName: 'Dra. Gómez',
                validFrom: '2026-01-01',
                validUntil: null,
                status: 'active',
              },
            ],
          },
        }),
      },
      getFneMonthlyReport: {
        useQuery: () => ({
          data: {
            month: '2026-11',
            siteName: 'Sede Norte',
            activeAuthorization: { resolutionNumber: 'RES-FNE-2026-09' },
            summary: [
              {
                productId: 'p-ctrl',
                name: 'Clonazepam 2 mg',
                sku: 'CLO-2',
                sanitaryRegistration: 'INVIMA 2023M-99',
                openingBalance: 2,
                receipts: 5,
                supplierReturns: 0.1,
                dispensations: 1,
                returns: 0.3,
                fractionationsNet: -1,
                destructions: 0,
                closingBalance: 6,
              },
            ],
            entries: [],
          },
        }),
      },
      listCustomerAllergies: { useQuery: () => ({ data: { items: [] } }) },
      addCustomerAllergy: { useMutation: () => ({ mutate: mockMutate, isPending: false }) },
      removeCustomerAllergy: { useMutation: () => ({ mutate: mockMutate, isPending: false }) },
    },
  },
}));

describe('Band 6B — Pharmacy panels, register hints, and payload guards', () => {
  it('renders cost-per-dose comparison badge on cross-presentation generic alternatives', () => {
    const onChoose = vi.fn();
    render(
      <PharmacyAlternatives
        alternatives={[
          {
            productId: 'gen-blister',
            name: 'Loratadina Genfar Blíster x 10',
            sku: 'LOR-10',
            price: 6000,
            savings: 4000,
            dosesPerPack: 10,
            pricePerDose: 600,
            sourcePricePerDose: 1000,
            savingsPerDose: 400,
            comparisonMode: 'per_dose',
          },
        ]}
        onChoose={onChoose}
      />
    );

    expect(screen.getByTestId('product-generic-dose-LOR-10')).toBeInTheDocument();
  });

  it('surfaces customer allergy (without clinical notes) and duplicity alerts in PharmacyTicketNotices', () => {
    render(
      <PharmacyTicketNotices
        customerNote={null}
        hasControlled={false}
        safetyAlerts={[
          {
            kind: 'customer_allergy',
            severity: 'severe',
            activeIngredient: 'Ibuprofeno',
            productId: 'prod-ibu',
            productName: 'Advil 400 mg',
          },
          {
            kind: 'duplicate_active_ingredient',
            severity: 'warning',
            activeIngredient: 'Acetaminofén',
            productIds: ['prod-1', 'prod-2'],
            productNames: ['Dolex Forte', 'Winasorb'],
          },
        ]}
      />
    );

    expect(screen.getByTestId('pharmacy-allergy-alert')).toHaveTextContent(/Ibuprofeno/i);
    expect(screen.getByTestId('pharmacy-duplicity-alert')).toHaveTextContent(/Dolex Forte/i);
  });

  it('mounts Fractionation, Environmental 1403, INVIMA/CUM, and FNE panels with real rows', () => {
    const { unmount: u1 } = render(<PharmacyFractionationPanel />);
    expect(screen.getByTestId('pharmacy-fractionation-panel')).toBeInTheDocument();
    expect(screen.getByTestId('pharmacy-frac-history-row')).toHaveTextContent('L-2026-01');
    u1();

    const { unmount: u2 } = render(<PharmacyEnvironmentalPanel businessDate="2026-11-27" />);
    expect(screen.getByTestId('pharmacy-environmental-panel')).toBeInTheDocument();
    expect(screen.getByTestId('pharmacy-env-deviation-count')).toHaveTextContent('1');
    u2();

    const { unmount: u3 } = render(<PharmacyInvimaPanel />);
    expect(screen.getByTestId('pharmacy-invima-panel')).toBeInTheDocument();
    expect(screen.getByTestId('pharmacy-invima-row')).toHaveTextContent('19991001-01');
    u3();

    const { unmount: u4 } = render(
      <PharmacyFnePanel
        businessDate="2026-11-27"
        countryCode="CO"
        fneEnabled={true}
        fneResolutionNumber="RES-FNE-2026-09"
        isAdmin={true}
      />
    );
    expect(screen.getByTestId('pharmacy-fne-panel')).toBeInTheDocument();
    expect(screen.getByText('Clonazepam 2 mg')).toBeInTheDocument();
    expect(screen.getByText('0.2')).toBeInTheDocument();
    u4();
  });

  it('reports missing/ready line status for FNE-enabled controlled lines and rejects malformed dosesPerPack', () => {
    const fneMissingHint = pharmacyLineHint({
      productId: 'p-ctrl',
      productName: 'Clonazepam 2 mg',
      classification: 'controlled',
      policyVersion: 'CO-2026-06',
      evidenceRequired: true,
      customerRequired: true,
      professionalApprovalRequired: true,
      requestedQuantity: 1,
      blockedErrorCode: null,
      nextLot: null,
      eligibleEvidence: [],
    });
    expect(fneMissingHint.status).toEqual({ kind: 'missing' });

    expect(
      buildProductPharmacyPayload({
        activeIngredient: 'Loratadina',
        genericName: 'Loratadina',
        concentration: '10 mg',
        dosageForm: 'Tableta',
        administrationRoute: 'Oral',
        presentation: 'Caja x 30',
        dosesPerPack: '10.5',
        cumCode: '19991-01',
        manufacturer: 'Lab',
        authorizationHolder: 'Lab',
        sanitaryRegistration: 'INVIMA 2025M-01',
        registrationExpiresAt: '2029-12-31',
        classification: 'otc',
        storageConditions: '',
        requiresColdChain: false,
      }).dosesPerPack
    ).toBeNull();
  });
});
