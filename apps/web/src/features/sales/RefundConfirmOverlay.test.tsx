import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import i18next from 'i18next';
import { render } from '@/test/utils';
import { RefundConfirmOverlay } from './RefundConfirmOverlay';

describe('RefundConfirmOverlay', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('shows a visibly disabled primary action while an exact approval is missing', () => {
    render(
      <RefundConfirmOverlay
        isOpen
        isPending={false}
        refundTotal={125}
        confirmDisabled
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Confirm return' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm return' })).toHaveClass(
      'disabled:bg-secondary-200',
      'disabled:text-secondary-500'
    );
  });
});
