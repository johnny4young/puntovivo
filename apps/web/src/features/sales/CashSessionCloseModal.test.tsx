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
    // V6 reskin (ENG-083) now renders "Blind close" both as a header
    // badge and as an inline label inside the form, so use the
    // multi-match query to verify the term surfaces at least once.
    expect(screen.getAllByText('Blind close').length).toBeGreaterThan(0);

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

  it('surfaces an ENG-018b warning when suspended drafts remain in flight', () => {
    render(
      <CashSessionCloseModal
        cashSession={activeCashSession}
        isOpen
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        suspendedDraftsCount={3}
      />
    );
    const warning = screen.getByTestId('close-session-suspended-warning');
    expect(warning).toBeInTheDocument();
    expect(warning.textContent).toContain('3');
  });

  it('does not render the suspended-drafts warning when the count is zero', () => {
    render(
      <CashSessionCloseModal
        cashSession={activeCashSession}
        isOpen
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        suspendedDraftsCount={0}
      />
    );
    expect(
      screen.queryByTestId('close-session-suspended-warning')
    ).not.toBeInTheDocument();
  });
});
