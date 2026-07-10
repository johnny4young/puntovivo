import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { CashSessionCloseModal } from './CashSessionCloseModal';

// ENG-194 — the modal role-gates the live over/short semaphore; default to
// cashier so the pre-existing blind-close assertions exercise the strict
// (no-feedback) path.
let mockRole = 'cashier';
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: mockRole } }),
}));

// ENG-194b — tenant-level blind-close policy; default true mirrors the
// server default so the strict path stays the baseline.
let mockBlindClose = true;
vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({
    tenantSettings: { cashClose: { blindClose: mockBlindClose } },
  }),
}));

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
    mockRole = 'cashier';
    mockBlindClose = true;
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
    expect(screen.queryByTestId('close-session-suspended-warning')).not.toBeInTheDocument();
  });

  // ENG-194 — live over/short semaphore, role-gated.
  it('never shows the live delta to a cashier, even while counting', async () => {
    mockRole = 'cashier';
    const user = userEvent.setup();
    render(
      <CashSessionCloseModal
        cashSession={activeCashSession}
        isOpen
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    const fiftyCountInput = screen.getByLabelText('Count for denomination $50.00');
    await user.clear(fiftyCountInput);
    await user.type(fiftyCountInput, '2');
    expect(screen.queryByTestId('close-session-live-delta')).not.toBeInTheDocument();
  });

  it.each([
    // expectedBalance is 150: 3×$50 = 150 → balanced.
    ['balanced', '3', /Balanced/, '$0.00'],
    // 4×$50 = 200 → over by 50.
    ['over', '4', /Over/, '$50.00'],
    // 2×$50 = 100 → short by 50.
    ['short', '2', /Short/, '-$50.00'],
  ])(
    'shows the manager a live %s semaphore with the exact delta',
    async (_label, fifties, message, delta) => {
      mockRole = 'manager';
      const user = userEvent.setup();
      render(
        <CashSessionCloseModal
          cashSession={{ ...activeCashSession, expectedBalance: 150 }}
          isOpen
          isSaving={false}
          error={null}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />
      );
      const fiftyCountInput = screen.getByLabelText('Count for denomination $50.00');
      await user.clear(fiftyCountInput);
      await user.type(fiftyCountInput, fifties);

      const strip = screen.getByTestId('close-session-live-delta');
      expect(strip).toHaveAttribute('role', 'status');
      expect(screen.getAllByText('Supervised close').length).toBeGreaterThan(0);
      expect(strip.textContent).toMatch(message);
      expect(strip.textContent).toContain(delta);
    }
  );

  it('shows a manager the full shortfall when the valid count is zero', () => {
    mockRole = 'manager';
    render(
      <CashSessionCloseModal
        cashSession={{ ...activeCashSession, expectedBalance: 150 }}
        isOpen
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const strip = screen.getByTestId('close-session-live-delta');
    expect(strip).toHaveTextContent('Short');
    expect(strip).toHaveTextContent('-$150.00');
  });

  it('shows the supervised live delta to an administrator', () => {
    mockRole = 'admin';
    render(
      <CashSessionCloseModal
        cashSession={{ ...activeCashSession, expectedBalance: 150 }}
        isOpen
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByTestId('close-session-live-delta')).toHaveTextContent('Short');
    expect(screen.getAllByText('Supervised close').length).toBeGreaterThan(0);
  });

  it('hides the manager delta while a denomination input is not numeric', async () => {
    mockRole = 'manager';
    const user = userEvent.setup();
    render(
      <CashSessionCloseModal
        cashSession={{ ...activeCashSession, expectedBalance: 150 }}
        isOpen
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const fiftyCountInput = screen.getByLabelText('Count for denomination $50.00');
    await user.type(fiftyCountInput, '3');
    expect(screen.getByTestId('close-session-live-delta')).toHaveTextContent('Balanced');

    await user.clear(fiftyCountInput);
    expect(screen.queryByTestId('close-session-live-delta')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  // ENG-194b — tenant opt-out of blind close shows the semaphore to cashiers.
  it('shows the live delta to a cashier when the tenant disabled blind close', async () => {
    mockRole = 'cashier';
    mockBlindClose = false;
    const user = userEvent.setup();
    render(
      <CashSessionCloseModal
        cashSession={{ ...activeCashSession, expectedBalance: 150 }}
        isOpen
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    const fiftyCountInput = screen.getByLabelText('Count for denomination $50.00');
    await user.clear(fiftyCountInput);
    await user.type(fiftyCountInput, '4');

    const strip = screen.getByTestId('close-session-live-delta');
    expect(strip.textContent).toMatch(/Over/);
    expect(strip.textContent).toContain('$50.00');
  });
});
