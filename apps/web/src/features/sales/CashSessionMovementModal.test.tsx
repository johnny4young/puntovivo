import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { CashSessionMovementModal } from './CashSessionMovementModal';

describe('CashSessionMovementModal', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  it('submits a localized manual cash movement', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <CashSessionMovementModal
        isOpen
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText('Registrar movimiento de caja')).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText('Tipo de movimiento'),
      screen.getByRole('option', { name: 'Retiro a caja fuerte' })
    );
    await user.clear(screen.getByLabelText('Monto'));
    await user.type(screen.getByLabelText('Monto'), '25');
    await user.type(screen.getByLabelText('Nota'), 'Retiro parcial por seguridad');
    await user.click(screen.getByRole('button', { name: 'Guardar movimiento' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      type: 'skim',
      amount: 25,
      note: 'Retiro parcial por seguridad',
    });
  });
});
