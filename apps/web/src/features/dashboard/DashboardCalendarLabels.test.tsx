import { afterEach, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { render, screen } from '@/test/utils';
import { formatCurrency, formatDateTime, setActiveTenantLocale } from '@/lib/utils';
import { RecentSalesCard, RevenueTrendCard } from './DashboardPanels';

afterEach(() => setActiveTenantLocale(null));

describe('dashboard calendar labels', () => {
  for (const timezone of ['America/Bogota', 'America/New_York']) {
    for (const language of ['en', 'es']) {
      it(`preserves chart days through both DST boundaries in ${timezone} / ${language}`, async () => {
        await i18next.changeLanguage(language);
        setActiveTenantLocale({
          locale: language === 'es' ? 'es-CO' : 'en-US',
          currency: 'USD',
          displayDecimals: 2,
          timezone,
          dateFormatShort: language === 'es' ? 'dd/MM/yyyy' : 'MM/dd/yyyy',
        });
        const { container } = render(
          <RevenueTrendCard
            points={[
              { date: '2026-03-08', revenue: 10, orders: 1 },
              { date: '2026-11-01', revenue: 20, orders: 2 },
            ]}
            formatCurrency={formatCurrency}
          />
        );
        const firstDay = language === 'es' ? '08/03/2026' : '03/08/2026';
        const lastDay = language === 'es' ? '01/11/2026' : '11/01/2026';
        expect(container.querySelector('.dashboard-chart-axis')?.textContent).toBe(
          firstDay + lastDay
        );
        const titles = Array.from(
          container.querySelectorAll('circle title'),
          node => node.textContent
        );
        expect(titles[0]).toMatch(new RegExp(`^${firstDay} · `));
        expect(titles[1]).toMatch(new RegExp(`^${lastDay} · `));
        const bestLabel = screen.getByText(language === 'es' ? 'Mejor día' : 'Best day');
        expect(bestLabel.nextElementSibling).toHaveTextContent(lastDay);
        const totalLabel = screen.getByText(
          language === 'es' ? 'Total del periodo' : 'Period total'
        );
        expect(totalLabel.nextElementSibling?.textContent).toBe(formatCurrency(30));
      });
    }
  }

  it('keeps empty dates empty rather than manufacturing a calendar day', async () => {
    await i18next.changeLanguage('en');
    const { container } = render(<RevenueTrendCard points={[]} formatCurrency={formatCurrency} />);
    expect(screen.getByText('There is no revenue to chart yet.')).toBeVisible();
    expect(container.querySelector('.dashboard-chart-axis')?.textContent).toBe('');
    expect(screen.getByText('Best day').nextElementSibling).toHaveTextContent('—');
  });

  it('still renders actual sale timestamps in the tenant timezone', async () => {
    await i18next.changeLanguage('en');
    setActiveTenantLocale({
      locale: 'en-US',
      currency: 'USD',
      displayDecimals: 2,
      timezone: 'America/Bogota',
      dateFormatShort: 'MM/dd/yyyy',
    });
    render(
      <RecentSalesCard
        sales={[
          {
            id: 'sale-1',
            saleNumber: 'SALE-1',
            customerName: 'Sample',
            customerEmail: 'sample@local.test',
            total: 10,
            createdAt: '2026-03-08T00:00:00.000Z',
          },
        ]}
        formatCurrency={formatCurrency}
        formatDateTime={formatDateTime}
      />
    );
    expect(screen.getByText(/sample@local.test/)).toHaveTextContent('03/07/2026');
  });
});
