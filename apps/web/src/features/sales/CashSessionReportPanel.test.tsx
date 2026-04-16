import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { formatCurrency } from '@/lib/utils';
import { CashSessionReportPanel } from './CashSessionReportPanel';

describe('CashSessionReportPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  it('renders cash management metrics, alerts, and recent closures', () => {
    render(
      <CashSessionReportPanel
        isLoading={false}
        report={{
          summary: {
            activeSessionCount: 2,
            activeRegisterCount: 2,
            recentClosureCount: 2,
            reviewCount: 1,
            netOverShort: -5,
            largestDiscrepancy: 5,
          },
          activeSessions: [
            {
              id: 'session-open-1',
              tenantId: 'tenant-1',
              siteId: 'site-1',
              cashierId: 'cashier-1',
              cashierName: 'Caja Norte',
              registerName: 'North register',
              openingFloat: 120,
              openingCountDenominations: [{ value: 20, count: 6 }],
              expectedBalance: 145,
              status: 'open',
              openedAt: new Date('2026-04-15T09:00:00.000Z').toISOString(),
              createdAt: new Date('2026-04-15T09:00:00.000Z').toISOString(),
              updatedAt: new Date('2026-04-15T09:00:00.000Z').toISOString(),
            },
          ],
          recentClosures: [
            {
              id: 'session-closed-1',
              tenantId: 'tenant-1',
              siteId: 'site-1',
              cashierId: 'cashier-2',
              cashierName: 'Caja Sur',
              registerName: 'South register',
              openingFloat: 80,
              openingCountDenominations: [{ value: 20, count: 4 }],
              expectedBalance: 95,
              actualCount: 90,
              actualCountDenominations: [{ value: 20, count: 4 }, { value: 10, count: 1 }],
              overShort: -5,
              status: 'closed',
              openedAt: new Date('2026-04-15T08:00:00.000Z').toISOString(),
              closedAt: new Date('2026-04-15T12:00:00.000Z').toISOString(),
              createdAt: new Date('2026-04-15T08:00:00.000Z').toISOString(),
              updatedAt: new Date('2026-04-15T12:00:00.000Z').toISOString(),
            },
          ],
        }}
      />
    );

    expect(screen.getByText('Control de caja')).toBeInTheDocument();
    expect(screen.getByText('Alertas por revisar')).toBeInTheDocument();
    expect(screen.getByText('1 cierres recientes requieren seguimiento.')).toBeInTheDocument();
    expect(screen.getByText('North register')).toBeInTheDocument();
    expect(screen.getByText('South register')).toBeInTheDocument();
    expect(screen.getByText('Faltante')).toBeInTheDocument();
    expect(
      screen.getAllByText(
        content => content.replace(/\s+/g, ' ') === `-${formatCurrency(5).replace(/\s+/g, ' ')}`
      )
    ).toHaveLength(2);
  });

  it('renders loading and empty states without alerts', () => {
    const { rerender } = render(<CashSessionReportPanel isLoading report={null} />);

    expect(screen.getByText('Cargando reporte de caja...')).toBeInTheDocument();

    rerender(
      <CashSessionReportPanel
        isLoading={false}
        report={{
          summary: {
            activeSessionCount: 0,
            activeRegisterCount: 0,
            recentClosureCount: 0,
            reviewCount: 0,
            netOverShort: 0,
            largestDiscrepancy: 0,
          },
          activeSessions: [],
          recentClosures: [],
        }}
      />
    );

    expect(screen.getByText('No hay alertas de diferencia en los cierres recientes.')).toBeInTheDocument();
    expect(screen.getByText('No hay sesiones activas abiertas para este sitio.')).toBeInTheDocument();
    expect(screen.getByText('Todavía no hay cierres recientes disponibles.')).toBeInTheDocument();
  });
});
