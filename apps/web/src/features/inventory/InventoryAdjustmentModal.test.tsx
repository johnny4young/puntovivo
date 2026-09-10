/**
 * The adjustment modal's submit path must agree with its confirm button.
 *
 * `Modal` renders `footer` as a sibling of `children`, so the confirm button
 * is OUTSIDE the form and its `disabled` expression never reaches the submit
 * path. That expression carries two separate rules here: the write is in
 * flight, and the product is lot- or serial-tracked (those balances are owned
 * by the lot ledger, not by a stock number typed into this box — the field is
 * even rendered `readOnly` for them, which does not block submission).
 *
 * A submit event dispatched at the form bypassed both. jsdom implements no
 * implicit form submission, so the event is dispatched directly; on a real
 * keyboard Enter dispatches it, since the form has no submit button and a
 * single implicit-submission-blocking field.
 *
 * @module features/inventory/InventoryAdjustmentModal.test
 */

import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18next from '@/i18n';
import { render } from '@/test/utils';
import {
  InventoryAdjustmentModal,
  type InventoryAdjustmentFormValues,
  type InventoryAdjustmentProduct,
} from './InventoryAdjustmentModal';

const plainProduct: InventoryAdjustmentProduct = {
  id: 'product-1',
  name: 'Rice 1kg',
  sku: 'RICE-1',
  stock: 12,
  minStock: 3,
  tracksLots: false,
  tracksSerials: false,
};

function renderModal(
  overrides: Partial<React.ComponentProps<typeof InventoryAdjustmentModal>> = {}
) {
  const props = {
    isOpen: true,
    product: plainProduct,
    siteName: 'Main site',
    isSaving: false,
    error: null,
    onClose: vi.fn(),
    onSubmit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<InventoryAdjustmentModal {...props} />);
  return props;
}

/** The modal portals into document.body. */
function adjustmentForm(): HTMLFormElement {
  const form = document.querySelector('form');
  if (!form) throw new Error('adjustment form not rendered');
  return form;
}

describe('InventoryAdjustmentModal submit guard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18next.changeLanguage('en');
  });

  it('writes one adjustment however many submit events the form receives', async () => {
    let releaseWrite!: () => void;
    const onSubmit = vi.fn<(values: InventoryAdjustmentFormValues) => Promise<void>>(
      () =>
        new Promise<void>(resolve => {
          releaseWrite = () => resolve();
        })
    );
    renderModal({ onSubmit });

    fireEvent.change(screen.getByLabelText('Stock After'), { target: { value: '20' } });
    // One act() around all three, so they land the way a key repeat does:
    // before React has re-rendered anything the first one caused.
    await act(async () => {
      fireEvent.submit(adjustmentForm());
      fireEvent.submit(adjustmentForm());
      fireEvent.submit(adjustmentForm());
    });

    // Non-vacuous in both directions: the first dispatch DID reach the
    // handler, and the repeats did not.
    expect(onSubmit).toHaveBeenCalledOnce();
    // react-hook-form passes the submit event as a second argument, before
    // and after the guard alike; assert on the payload only.
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ newStock: 20, notes: '' });

    await act(async () => {
      releaseWrite();
    });
  });

  it('refuses a submit event while the parent reports the write in flight', async () => {
    const props = renderModal({ isSaving: true });
    await act(async () => {
      fireEvent.submit(adjustmentForm());
    });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a submit event for a lot-tracked product, as the button does', async () => {
    const props = renderModal({ product: { ...plainProduct, tracksLots: true } });
    await act(async () => {
      fireEvent.submit(adjustmentForm());
    });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a submit event for a serial-tracked product, as the button does', async () => {
    const props = renderModal({ product: { ...plainProduct, tracksSerials: true } });
    await act(async () => {
      fireEvent.submit(adjustmentForm());
    });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
