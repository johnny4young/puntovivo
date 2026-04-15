import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import i18n from '@/i18n';
import { CashSessionOpenModal } from './CashSessionOpenModal';

describe('CashSessionOpenModal', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('disables submit until the opening float matches the denomination count', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <CashSessionOpenModal
        isOpen
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    const openingFloatInput = screen.getByLabelText('Opening float');
    await user.clear(openingFloatInput);
    await user.type(openingFloatInput, '100');

    const submitButton = screen.getByRole('button', { name: 'Open session' });
    expect(submitButton).toBeDisabled();
    expect(
      screen.getByText('The opening float must match the denomination count total.')
    ).toBeInTheDocument();

    const fiftyCountInput = screen.getByLabelText('Count for denomination $50.00');
    await user.clear(fiftyCountInput);
    await user.type(fiftyCountInput, '2');

    expect(submitButton).toBeEnabled();
    await user.click(submitButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        openingFloat: 100,
        denominations: expect.arrayContaining([{ value: 50, count: 2 }]),
      })
    );
  });
});
