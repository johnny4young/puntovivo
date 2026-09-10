import { useState } from 'react';
import { fireEvent, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/test/utils';
import i18n from '@/i18n';
import { RestaurantModifierEditor } from '../RestaurantModifierEditor';
import {
  DEFAULT_LINE_DETAILS,
  getRestaurantModifierPriceDelta,
  hasDuplicateRestaurantModifiers,
  restaurantModifierSnapshot,
  type RestaurantModifierDraft,
} from '../restaurantDraft';

function Editor({
  initial = DEFAULT_LINE_DETAILS.modifiers,
  disabled = false,
}: {
  initial?: RestaurantModifierDraft[];
  disabled?: boolean;
}) {
  const [modifiers, setModifiers] = useState(initial);
  return (
    <RestaurantModifierEditor
      canManage
      modifiers={modifiers}
      onChange={setModifiers}
      disabled={disabled}
    />
  );
}

describe('RestaurantModifierEditor', () => {
  it('keeps cashier instructions free and catalog name/price locked with a bounded quantity', () => {
    const changed = vi.fn();
    const draft = {
      id: 'catalog-row',
      catalogId: 'approved',
      catalogVersion: 7,
      maxQuantity: 2,
      name: 'Cheese',
      quantity: 1,
      unitPriceDelta: 1500,
    };
    render(
      <RestaurantModifierEditor
        canManage={false}
        modifiers={[draft]}
        onChange={changed}
        disabled={false}
      />
    );
    expect(screen.getByTestId('voice-ordering-modifier-name')).toHaveAttribute('readonly');
    expect(screen.getByTestId('voice-ordering-modifier-price')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByTestId('voice-ordering-modifier-quantity'), {
      target: { value: '20' },
    });
    expect(changed).toHaveBeenCalledWith([{ ...draft, quantity: 2 }]);
    expect(restaurantModifierSnapshot([draft])).toEqual([
      {
        catalogId: 'approved',
        catalogVersion: 7,
        name: 'Cheese',
        quantity: 1,
        unitPriceDelta: 1500,
      },
    ]);
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('adds via keyboard, focuses new rows and preserves values when an earlier row is removed', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    expect(screen.getByRole('button', { name: 'Add modifier' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Modifier (optional)' }), 'Cheese');
    const add = screen.getByRole('button', { name: 'Add modifier' });
    add.focus();
    await user.keyboard('{Enter}');
    const names = screen.getAllByRole('textbox', { name: 'Modifier (optional)' });
    expect(names[1]).toHaveFocus();
    await user.keyboard('Bacon');
    const second = screen.getAllByTestId('restaurant-modifier-row')[1]!;
    fireEvent.change(within(second).getByRole('spinbutton', { name: 'Quantity' }), {
      target: { value: '2' },
    });
    fireEvent.change(within(second).getByRole('spinbutton', { name: 'Price add-on' }), {
      target: { value: '1500' },
    });
    await user.click(screen.getByRole('button', { name: 'Remove modifier Cheese' }));
    expect(screen.getByRole('textbox')).toHaveValue('Bacon');
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(screen.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue(2);
    expect(screen.getByRole('spinbutton', { name: 'Price add-on' })).toHaveValue(1500);
    await user.click(screen.getByRole('button', { name: 'Remove modifier Bacon' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(add).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('surfaces duplicates in EN and ES without silently merging or dropping a row', async () => {
    render(
      <Editor
        initial={[
          { id: 'a', name: '  QUESO ', quantity: 1, unitPriceDelta: 100 },
          { id: 'b', name: 'queso', quantity: 2, unitPriceDelta: 200 },
        ]}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Each modifier needs a different name.');
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Add modifier' })).toBeDisabled();
    await act(async () => {
      await i18n.changeLanguage('es');
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Cada modificador necesita un nombre distinto.'
    );
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'Tocineta' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar modificador' })).toBeEnabled();
  });

  it('caps the list at twenty while keeping removal available', () => {
    render(
      <Editor
        initial={Array.from({ length: 20 }, (_, index) => ({
          id: String(index),
          name: `Extra ${index}`,
          quantity: 1,
          unitPriceDelta: 0,
        }))}
      />
    );
    expect(screen.getAllByRole('textbox')).toHaveLength(20);
    expect(screen.getByRole('button', { name: 'Add modifier' })).toBeDisabled();
    expect(screen.getByText('Maximum 20 modifiers per line.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove modifier Extra 5' }));
    expect(screen.getByRole('button', { name: 'Add modifier' })).toBeEnabled();
  });

  it('disables every action and editor while an order is being saved', () => {
    render(
      <Editor disabled initial={[{ id: 'a', name: 'Cheese', quantity: 1, unitPriceDelta: 0 }]} />
    );
    for (const role of ['button', 'spinbutton', 'textbox']) {
      for (const control of screen.getAllByRole(role)) expect(control).toBeDisabled();
    }
  });

  it('bounds integer modifier quantities and ignores blank optional rows in monetary snapshots', () => {
    render(<Editor initial={[{ id: 'a', name: 'Cheese', quantity: 1, unitPriceDelta: 0 }]} />);
    const quantity = screen.getByRole('spinbutton', { name: 'Quantity' });
    for (const [raw, expected] of [
      ['0', 1],
      ['21', 20],
      ['2.5', 2],
      ['', 1],
    ] as const) {
      fireEvent.change(quantity, { target: { value: raw } });
      expect(quantity).toHaveValue(expected);
    }
    const modifiers = [
      { id: 'a', name: ' Cheese ', quantity: 3, unitPriceDelta: 0.005 },
      { id: 'b', name: 'Salt', quantity: 2, unitPriceDelta: 0.335 },
      { id: 'c', name: '  ', quantity: 20, unitPriceDelta: 999 },
    ];
    expect(restaurantModifierSnapshot(modifiers)).toEqual([
      { name: 'Cheese', quantity: 3, unitPriceDelta: 0.01 },
      { name: 'Salt', quantity: 2, unitPriceDelta: 0.34 },
    ]);
    expect(getRestaurantModifierPriceDelta(modifiers)).toBe(0.71);
    expect(
      hasDuplicateRestaurantModifiers([
        ...modifiers,
        { id: 'd', name: '', quantity: 1, unitPriceDelta: 0 },
      ])
    ).toBe(false);
  });
});
