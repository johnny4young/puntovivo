import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { formatCurrency } from '@/lib/utils';
import { CashSessionMovementTimeline } from './CashSessionMovementTimeline';

describe('CashSessionMovementTimeline', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  it('renders movement entries with localized labels and signed amounts', () => {
    render(
      <CashSessionMovementTimeline
        isLoading={false}
        movements={[
          {
            id: 'movement-1',
            tenantId: 'tenant-1',
            sessionId: 'session-1',
            type: 'sale',
            amount: 23.8,
            note: 'Venta VTA-000123 · Main Site',
            createdBy: 'cashier-1',
            createdByName: 'Admin',
            createdAt: new Date('2026-04-15T10:00:00.000Z').toISOString(),
          },
          {
            id: 'movement-2',
            tenantId: 'tenant-1',
            sessionId: 'session-1',
            type: 'skim',
            amount: 50,
            note: 'Retiro parcial a caja fuerte',
            createdBy: 'cashier-1',
            createdByName: 'Admin',
            createdAt: new Date('2026-04-15T10:05:00.000Z').toISOString(),
          },
        ]}
      />
    );

    expect(screen.getByText('Línea de tiempo de movimientos')).toBeInTheDocument();
    expect(screen.getByText('Venta VTA-000123 · Main Site')).toBeInTheDocument();
    expect(screen.getByText('Retiro parcial a caja fuerte')).toBeInTheDocument();
    expect(
      screen.getByText(content => content.replace(/\s+/g, ' ') === `+${formatCurrency(23.8).replace(/\s+/g, ' ')}`)
    ).toBeInTheDocument();
    expect(
      screen.getByText(content => content.replace(/\s+/g, ' ') === `-${formatCurrency(50).replace(/\s+/g, ' ')}`)
    ).toBeInTheDocument();
    expect(screen.getByText(/Venta en efectivo/)).toBeInTheDocument();
    expect(screen.getByText(/Retiro a caja fuerte/)).toBeInTheDocument();
  });
});
