import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { CashSessionCloseModal } from './CashSessionCloseModal';

const activeCashSession = {
  id: 'cash-session-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  cashierId: 'cashier-1',
  registerName: 'Front register',
  openingFloat: 100,
  openingCountDenominations: [{ value: 50, count: 2 }],
  expectedBalance: 140,
  status: 'open' as const,
  openedAt: new Date('2026-04-14T21:00:00.000Z').toISOString(),
  createdAt: new Date('2026-04-14T21:00:00.000Z').toISOString(),
  updatedAt: new Date('2026-04-14T21:00:00.000Z').toISOString(),
};

describe('CashSessionCloseModal', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('keeps the expected balance hidden and requires matching close totals', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <CashSessionCloseModal
        cashSession={activeCashSession}
        isOpen
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    expect(screen.queryByText('Expected balance')).not.toBeInTheDocument();
    expect(screen.getByText('Blind close')).toBeInTheDocument();

    const actualCountInput = screen.getByLabelText('Blind closing total');
    await user.clear(actualCountInput);
    await user.type(actualCountInput, '200');

    const submitButton = screen.getByRole('button', { name: 'Close session' });
    expect(submitButton).toBeDisabled();
    expect(
      screen.getByText('The blind closing total must match the denomination count total.')
    ).toBeInTheDocument();

    const fiftyCountInput = screen.getByLabelText('Count for denomination $50.00');
    await user.clear(fiftyCountInput);
    await user.type(fiftyCountInput, '2');

    const hundredCountInput = screen.getByLabelText('Count for denomination $100.00');
    await user.clear(hundredCountInput);
    await user.type(hundredCountInput, '1');

    expect(submitButton).toBeEnabled();
    await user.click(submitButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        actualCount: 200,
        denominations: expect.arrayContaining([
          { value: 50, count: 2 },
          { value: 100, count: 1 },
        ]),
      })
    );
  });
});
