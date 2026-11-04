import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { FiscalReadinessStrip } from './FiscalReadinessStrip';

const h = vi.hoisted(() => ({
  country: 'CO' as string | null,
  fiscal: null as Record<string, unknown> | null,
  totals: { pending: 0, sent: 0 } as Record<string, number>,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    tenantLocale: { get: { useQuery: () => ({ data: { countryCode: h.country } }) } },
    fiscalSettings: {
      getByCountry: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => ({
          data: options.enabled ? h.fiscal : undefined,
        }),
      },
    },
    reports: {
      fiscal: {
        list: {
          useQuery: (input: { status: string }) => ({ data: { total: h.totals[input.status] } }),
        },
      },
    },
  },
}));

describe('FiscalReadinessStrip', () => {
  beforeEach(() => {
    h.country = 'CO';
    h.totals = { pending: 40, sent: 6 };
    h.fiscal = {
      countryCode: 'CO',
      settings: { environment: 'habilitacion', dianResolutionNumber: null },
      validation: { issues: [{ code: 'MISSING_RESOLUTION' }] },
    };
  });

  it('points each missing step to where it is fixed', () => {
    render(<FiscalReadinessStrip />);

    expect(screen.getByTestId('fiscal-readiness-numbering')).toHaveTextContent('Missing');
    expect(screen.getByRole('link', { name: 'Add resolution' })).toHaveAttribute(
      'href',
      '/company?tab=fiscal'
    );
    expect(screen.getByTestId('fiscal-readiness-environment')).toHaveTextContent('Testing');
    expect(screen.getByTestId('fiscal-readiness-pending')).toHaveTextContent('46');
    expect(screen.getByRole('link', { name: 'View queue' })).toHaveAttribute(
      'href',
      '/fiscal-documents'
    );
  });

  it('shows the resolution and production once they are set', () => {
    h.fiscal = {
      countryCode: 'CO',
      settings: { environment: 'produccion', dianResolutionNumber: '18760000001' },
      validation: { issues: [] },
    };
    render(<FiscalReadinessStrip />);

    expect(screen.getByTestId('fiscal-readiness-numbering')).toHaveTextContent('18760000001');
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

  it('renders nothing for a country without a fiscal pack', () => {
    h.country = 'PE';
    render(<FiscalReadinessStrip />);

    expect(screen.queryByTestId('fiscal-readiness-strip')).not.toBeInTheDocument();
  });
});
