import { createRef } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { Button } from './Button';
import { buttonVariants } from './Button.variants';

describe('Button', () => {
  it('uses the commit action as its safe default without submitting forms', () => {
    render(<Button>Confirmar</Button>);

    const button = screen.getByRole('button', { name: 'Confirmar' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('btn-primary');
  });

  it('maps typed variants and sizes to the shared Operator Deck grammar', () => {
    render(
      <Button variant="danger" size="iconCompact" aria-label="Anular">
        ×
      </Button>
    );

    expect(screen.getByRole('button', { name: 'Anular' })).toHaveClass(
      'btn-danger',
      'btn-icon',
      'h-8',
      'w-8'
    );
    expect(buttonVariants({ variant: 'outline' })).toContain('btn-outline');
    expect(buttonVariants({ size: 'icon' })).toContain('h-11 min-h-11 w-11');
  });

  it('forwards native props, events, and refs', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();

    render(
      <Button ref={ref} variant="secondary" onClick={onClick}>
        Imprimir
      </Button>
    );

    await user.click(screen.getByRole('button', { name: 'Imprimir' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
