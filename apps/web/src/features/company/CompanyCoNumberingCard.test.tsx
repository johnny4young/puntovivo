/** Tests for the DIAN numbering ranges card. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const createMutate = vi.fn();
const activateMutate = vi.fn();
const retireMutate = vi.fn();
const removeMutate = vi.fn();
const invalidate = vi.fn(async () => undefined);

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const ACTIVE = {
  id: 'r-active',
  siteId: 's-1',
  siteName: 'Sede Norte',
  kind: 'DEE' as const,
  resolutionNumber: '18764000001',
  resolutionDate: '2026-10-01T05:00:00.000Z',
  prefix: 'SETP',
  fromNumber: 1,
  toNumber: 100,
  currentNumber: 96,
  nextNumber: 97,
  remaining: 4,
  environment: 'habilitacion' as const,
  validFrom: '2026-10-01T05:00:00.000Z',
  validUntil: '2027-09-30T04:59:59.999Z',
  status: 'active' as const,
  technicalKeyHint: null,
  issuedCount: 96,
  createdAt: '2026-10-01T05:00:00.000Z',
  retiredAt: null,
  retireReason: null,
};
const WAITING = {
  ...ACTIVE,
  id: 'r-waiting',
  prefix: 'SETQ',
  currentNumber: 0,
  nextNumber: 1,
  remaining: 100,
  status: 'scheduled' as const,
  issuedCount: 0,
};

let ranges: Array<typeof ACTIVE | typeof WAITING> = [];
let usage: unknown[] = [];

function mutation(spy: () => (...args: unknown[]) => unknown) {
  return () => ({ mutate: (...args: unknown[]) => spy()(...args), isPending: false });
}

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      fiscalNumbering: { list: { invalidate }, usage: { invalidate } },
      setupReadiness: { get: { invalidate }, checkout: { invalidate } },
    }),
    fiscalNumbering: {
      list: { useQuery: () => ({ data: ranges, isSuccess: true }) },
      usage: { useQuery: () => ({ data: usage, isSuccess: true }) },
      create: { useMutation: mutation(() => createMutate) },
      activate: { useMutation: mutation(() => activateMutate) },
      retire: { useMutation: mutation(() => retireMutate) },
      remove: { useMutation: mutation(() => removeMutate) },
    },
    sites: {
      list: { useQuery: () => ({ data: { items: [{ id: 's-1', name: 'Sede Norte' }] } }) },
    },
    fiscalSettings: {
      getByCountry: {
        useQuery: () => ({
          data: { countryCode: 'CO', settings: { environment: 'habilitacion' }, maturity: 'mock' },
        }),
      },
    },
  },
}));

import { CompanyCoNumberingCard } from './CompanyCoNumberingCard';

describe('CompanyCoNumberingCard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ranges = [];
    usage = [];
    await i18n.changeLanguage('es');
  });

  it('shows a single register action when no site has ranges, and the mock label', () => {
    render(<CompanyCoNumberingCard />);
    const empty = screen.getByTestId('fiscal-co-numbering-empty');
    expect(within(empty).getAllByRole('button')).toHaveLength(1);
    expect(screen.getByTestId('fiscal-maturity-badge')).toBeInTheDocument();
  });

  it('lists ranges per site with consumption, status and the near-exhaustion alert', () => {
    ranges = [ACTIVE, WAITING];
    usage = [
      {
        rangeId: ACTIVE.id,
        siteId: 's-1',
        siteName: 'Sede Norte',
        kind: 'DEE',
        remaining: 4,
        remainingRatio: 0.04,
        daysUntilExpiry: 300,
        dailyAverage: 2,
        daysOfStockLeft: 2,
        hasScheduledSuccessor: true,
        alert: { level: 'critical', reason: 'consumption' },
      },
    ];
    render(<CompanyCoNumberingCard />);
    expect(screen.getByRole('heading', { name: 'Sede Norte' })).toBeInTheDocument();
    const active = screen.getByTestId('numbering-row-r-active');
    expect(active).toHaveTextContent('Quedan 4 números');
    expect(active).toHaveTextContent('Activo');
    expect(screen.getByTestId('numbering-alert-r-active')).toHaveTextContent('Quedan 4 números');
    const waiting = screen.getByTestId('numbering-row-r-waiting');
    expect(waiting).toHaveTextContent('En espera');

    fireEvent.click(within(waiting).getByRole('button', { name: 'Activar ahora' }));
    expect(activateMutate).toHaveBeenCalledWith({ id: 'r-waiting' });
    // An unused range is deleted, a used one only retired.
    expect(within(waiting).getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();
    expect(within(active).queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
  });

  it('asks for a reason before retiring', () => {
    ranges = [ACTIVE];
    render(<CompanyCoNumberingCard />);
    fireEvent.click(
      within(screen.getByTestId('numbering-row-r-active')).getByRole('button', {
        name: 'Retirar',
      })
    );
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Retirar' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Motivo'), {
      target: { value: 'Resolución anulada' },
    });
    fireEvent.click(confirm);
    expect(retireMutate).toHaveBeenCalledWith({ id: 'r-active', reason: 'Resolución anulada' });
  });

  it('confirms the first number and immutability before registering', () => {
    render(<CompanyCoNumberingCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar rango' }));
    const form = screen.getByTestId('numbering-form');
    const fill = (label: string, value: string) =>
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    fill('Número de resolución', '18764000001');
    fill('Fecha de resolución', '2026-10-01');
    fill('Prefijo', 'sede');
    fill('Desde', '1');
    fill('Hasta', '5000');
    fill('Vigente desde', '2026-10-01');
    fill('Vigente hasta', '2027-09-30');
    expect(within(form).queryByLabelText('Clave técnica')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));
    const confirm = screen.getByTestId('numbering-confirm');
    expect(confirm).toHaveTextContent('SEDE0000000001');
    expect(confirm).toHaveTextContent('no se puede editar');
    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(createMutate).toHaveBeenCalledWith({
      siteId: 's-1',
      kind: 'DEE',
      resolutionNumber: '18764000001',
      resolutionDate: '2026-10-01',
      prefix: 'SEDE',
      fromNumber: 1,
      toNumber: 5000,
      validFrom: '2026-10-01',
      validUntil: '2027-09-30',
      environment: 'habilitacion',
    });
  });

  it('requires the technical key for an electronic invoice range', () => {
    render(<CompanyCoNumberingCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar rango' }));
    const form = screen.getByTestId('numbering-form');
    fireEvent.change(within(form).getByLabelText('Tipo de documento'), {
      target: { value: 'FEV' },
    });
    expect(within(form).getByLabelText('Clave técnica')).toBeInTheDocument();
  });
});
