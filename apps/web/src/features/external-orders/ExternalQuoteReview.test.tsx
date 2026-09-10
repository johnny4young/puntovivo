import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, fireEvent } from '@testing-library/react';
import { render, screen } from '@/test/utils';
import i18n from '@/i18n';
import { ExternalQuoteReview } from './ExternalQuoteReview';
import type { ExternalQuote } from './types';
const h = vi.hoisted(() => ({ accept: vi.fn() }));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ mutateAsync: h.accept, isPending: false }),
}));
const quote = {
  id: 'order',
  expectedVersion: 1,
  fingerprint: 'a'.repeat(64),
  currencyCode: 'COP',
  items: [{ productId: 'product', name: 'Local product', quantity: 1.001, unitPrice: 100 }],
  total: 100.1,
  quotedTotal: 80,
  amountDiffers: true,
} as ExternalQuote;
const props = () => ({
  siteId: 'site',
  quote,
  disabled: false,
  onAccepted: vi.fn(),
  onRefresh: vi.fn(),
  onPendingChange: vi.fn(),
});
beforeEach(async () => {
  vi.clearAllMocks();
  h.accept.mockResolvedValue({ id: 'draft' });
  await i18n.changeLanguage('en');
});
describe('External local-price consent', () => {
  it('requires explicit consent and never submits source amounts as authority', async () => {
    const p = props();
    render(<ExternalQuoteReview {...p} />);
    expect(screen.getByText(/does not collect payment/)).toBeVisible();
    expect(screen.getByText(/differs from the source quote/)).toBeVisible();
    const button = screen.getByRole('button', { name: 'Accept and create draft' });
    expect(button).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox'));
    await user.click(button);
    expect(h.accept).toHaveBeenCalledWith({
      siteId: 'site',
      id: 'order',
      expectedVersion: 1,
      fingerprint: quote.fingerprint,
      confirmedLocalPricing: true,
    });
    expect(p.onPendingChange.mock.calls).toEqual([[true], [false]]);
    expect(p.onAccepted).toHaveBeenCalledOnce();
  });
  it('invalidates consent on changed fingerprint and blocks stale or fetching quotes', async () => {
    const p = props();
    const { rerender } = render(<ExternalQuoteReview key={quote.fingerprint} {...p} />);
    await userEvent.setup().click(screen.getByRole('checkbox'));
    rerender(
      <ExternalQuoteReview key="changed" {...p} quote={{ ...quote, fingerprint: 'b'.repeat(64) }} />
    );
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await userEvent.setup().click(screen.getByRole('checkbox'));
    rerender(
      <ExternalQuoteReview
        key="changed"
        {...p}
        quote={{ ...quote, fingerprint: 'b'.repeat(64) }}
        disabled
      />
    );
    expect(screen.getByRole('button', { name: 'Accept and create draft' })).toBeDisabled();
    expect(h.accept).not.toHaveBeenCalled();
  });
  it('blocks double clicks while pending and requires review after rejection', async () => {
    let reject!: (error: unknown) => void;
    h.accept.mockImplementation(
      () =>
        new Promise((_resolve, r) => {
          reject = r;
        })
    );
    const p = props();
    render(<ExternalQuoteReview {...p} />);
    await userEvent.setup().click(screen.getByRole('checkbox'));
    const button = screen.getByRole('button', { name: 'Accept and create draft' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(h.accept).toHaveBeenCalledOnce();
    expect(p.onPendingChange).toHaveBeenCalledWith(true);
    await act(async () =>
      reject({ data: { code: 'CONFLICT', errorCode: 'EXTERNAL_ORDER_STATE_INVALID' } })
    );
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(button).toBeDisabled();
    expect(p.onRefresh).toHaveBeenCalledOnce();
    expect(p.onAccepted).not.toHaveBeenCalled();
  });
});
