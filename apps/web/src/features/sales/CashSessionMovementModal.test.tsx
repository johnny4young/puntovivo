import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import {
  CashSessionMovementModal,
  type CashSessionMovementValues,
} from './CashSessionMovementModal';

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
  /**
   * The confirm button lives in the modal FOOTER, which `Modal` renders as a
   * sibling of the form. `disabled={isSaving}` therefore guards the click and
   * nothing else: a submit event dispatched at the form itself — what a
   * browser does on Enter, and what `requestSubmit()` does — never sees it.
   * jsdom implements no implicit submission, so the event is dispatched
   * directly; on a real keyboard a held Enter dispatches it once per repeat.
   */
  async function fillValidMovement(user: ReturnType<typeof userEvent.setup>) {
    await user.selectOptions(
      screen.getByLabelText('Tipo de movimiento'),
      screen.getByRole('option', { name: 'Retiro a caja fuerte' })
    );
    await user.clear(screen.getByLabelText('Monto'));
    await user.type(screen.getByLabelText('Monto'), '25');
    await user.type(screen.getByLabelText('Nota'), 'Retiro parcial por seguridad');
  }

  function movementForm(): HTMLFormElement {
    // The modal portals into document.body, so the form is not under the
    // render container.
    const form = document.querySelector('form');
    if (!form) throw new Error('movement form not rendered');
    return form;
  }

  it('writes one movement however many submit events the form receives', async () => {
    const user = userEvent.setup();
    let releaseWrite!: () => void;
    const onSubmit = vi.fn<(values: CashSessionMovementValues) => Promise<void>>(
      () =>
        new Promise<void>(resolve => {
          releaseWrite = () => resolve();
        })
    );

    render(
      <CashSessionMovementModal
        isOpen
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    await fillValidMovement(user);

    // One act() around all three, so they land the way a key repeat does:
    // before React has re-rendered anything the first one caused.
    await act(async () => {
      fireEvent.submit(movementForm());
      fireEvent.submit(movementForm());
      fireEvent.submit(movementForm());
    });

    // Non-vacuous in both directions: the first dispatch DID reach the
    // handler, and the repeats did not.
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      type: 'skim',
      amount: 25,
      note: 'Retiro parcial por seguridad',
    });
    // Let the write settle inside act, so react-hook-form's own
    // isSubmitting update does not land after the test has finished.
    await act(async () => {
      releaseWrite();
    });
  });

  it('refuses a submit event while the parent reports the write in flight', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <CashSessionMovementModal
        isOpen
        isSaving
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    await fillValidMovement(user);
    await act(async () => {
      fireEvent.submit(movementForm());
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
