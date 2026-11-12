import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { FiscalReadinessStrip } from './FiscalReadinessStrip';

const h = vi.hoisted(() => ({
  country: 'CO' as string | null,
  fiscal: null as Record<string, unknown> | null,
  totals: {} as Record<string, number>,
  loading: false,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useQueries: (
      build: (t: {
        reports: { fiscal: { list: (input: { status: string }) => unknown } };
      }) => Array<{ status: string }>
    ) =>
      build({ reports: { fiscal: { list: input => input } } }).map(input => ({
        data: h.loading ? undefined : { total: h.totals[input.status] ?? 0 },
      })),
    tenantLocale: { get: { useQuery: () => ({ data: { countryCode: h.country } }) } },
    fiscalSettings: {
      getByCountry: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => ({
          data: options.enabled ? h.fiscal : undefined,
        }),
      },
    },
  },
}));

describe('FiscalReadinessStrip', () => {
  beforeEach(() => {
    h.country = 'CO';
    h.totals = { pending: 40, sent: 6 };
    h.loading = false;
    h.fiscal = {
      countryCode: 'CO',
      settings: { environment: 'habilitacion' },
      validation: { issues: [{ code: 'MISSING_NIT' }] },
    };
  });

  it('points each missing step to where it is fixed', () => {
    render(<FiscalReadinessStrip />);

    expect(screen.getByRole('link', { name: 'Complete profile' })).toHaveAttribute(
      'href',
      '/company?tab=fiscal'
    );
    expect(screen.queryByTestId('fiscal-readiness-numbering')).not.toBeInTheDocument();
    expect(screen.getByTestId('fiscal-readiness-environment')).toHaveTextContent('Testing');
    expect(screen.getByTestId('fiscal-readiness-pending')).toHaveTextContent('46');
    expect(screen.getByRole('link', { name: 'View queue' })).toHaveAttribute(
      'href',
      '/fiscal-documents'
    );
  });

  it('shows production once it is set', () => {
    h.fiscal = {
      countryCode: 'CO',
      settings: { environment: 'produccion' },
      validation: { issues: [] },
    };
    render(<FiscalReadinessStrip />);

    expect(screen.getByTestId('fiscal-readiness-environment')).toHaveTextContent('Production');
  });

  it('leaves out the Colombian resolution for other countries', () => {
    h.country = 'MX';
    h.fiscal = {
      countryCode: 'MX',
      settings: { environment: 'sandbox' },
      validation: { issues: [] },
    };
    render(<FiscalReadinessStrip />);

    expect(screen.queryByTestId('fiscal-readiness-numbering')).not.toBeInTheDocument();
    expect(screen.getByTestId('fiscal-readiness-profile')).toHaveTextContent('Mexico');
  });

  it('counts rejected and contingency documents as needing attention', () => {
    h.totals = { rejected: 2, contingency: 1 };
    render(<FiscalReadinessStrip />);

    expect(screen.getByTestId('fiscal-readiness-pending')).toHaveTextContent('3');
  });

  it('never shows a clean zero before the counts arrive', () => {
    h.loading = true;
    h.totals = {};
    render(<FiscalReadinessStrip />);

    expect(screen.getByTestId('fiscal-readiness-pending')).toHaveTextContent('—');
  });

  it('renders nothing for a country without a fiscal pack', () => {
    h.country = 'PE';
    render(<FiscalReadinessStrip />);

    expect(screen.queryByTestId('fiscal-readiness-strip')).not.toBeInTheDocument();
  });
});
