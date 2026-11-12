/** Dashboard notice for DIAN numbering ranges that need attention. */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

let role: 'admin' | 'manager' | 'cashier' = 'admin';
let usage: unknown[] = [];

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role } }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    tenantLocale: { get: { useQuery: () => ({ data: { countryCode: 'CO' } }) } },
    fiscalNumbering: {
      usage: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => ({
          data: options.enabled ? usage : undefined,
        }),
      },
    },
  },
}));

import { NumberingAlertBanner } from './NumberingAlertBanner';

const EXPIRING = {
  rangeId: 'r-1',
  siteId: 's-1',
  siteName: 'Sede Norte',
  kind: 'DEE',
  remaining: 900,
  remainingRatio: 0.9,
  daysUntilExpiry: 12,
  dailyAverage: 3,
  daysOfStockLeft: 300,
  hasScheduledSuccessor: false,
  alert: { level: 'critical', reason: 'expiry' },
};

function renderBanner() {
  return render(
    <MemoryRouter>
      <NumberingAlertBanner />
    </MemoryRouter>
  );
}

describe('NumberingAlertBanner', () => {
  beforeEach(async () => {
    role = 'admin';
    usage = [EXPIRING, { ...EXPIRING, rangeId: 'r-2', alert: null }];
    await i18n.changeLanguage('es');
  });

  it('names each range that needs attention and links admins to the ranges', () => {
    renderBanner();
    const banner = screen.getByTestId('numbering-alert-banner');
    expect(banner).toHaveTextContent('Un rango de numeración DIAN necesita atención');
    expect(banner).toHaveTextContent(
      'Sede Norte · Documento POS electrónico: Vence en 12 días y no hay otro rango en espera'
    );
    expect(screen.getByRole('link', { name: 'Ver rangos' })).toHaveAttribute(
      'href',
      '/company?tab=fiscal'
    );
  });

  it('shows managers the notice without the admin-only link', () => {
    role = 'manager';
    renderBanner();
    expect(screen.getByTestId('numbering-alert-banner')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('stays hidden for cashiers and when nothing needs attention', () => {
    role = 'cashier';
    const { unmount } = renderBanner();
    expect(screen.queryByTestId('numbering-alert-banner')).not.toBeInTheDocument();
    unmount();
    role = 'admin';
    usage = [{ ...EXPIRING, alert: null }];
    renderBanner();
    expect(screen.queryByTestId('numbering-alert-banner')).not.toBeInTheDocument();
  });
});
