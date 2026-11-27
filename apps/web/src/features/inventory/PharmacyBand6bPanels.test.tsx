import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { PharmacyAlternatives } from '@/features/sales/PharmacyAlternatives';
import { PharmacyTicketNotices } from '@/features/sales/PharmacyTicketNotices';

describe('Band 6B — Pharmacy register enhancements', () => {
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

  it('surfaces customer allergy and active-ingredient duplicity alerts in PharmacyTicketNotices', () => {
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
            notes: 'Anafilaxia reportada',
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
});
