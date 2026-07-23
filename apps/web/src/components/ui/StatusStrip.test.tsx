import { render, screen } from '@testing-library/react';
import { AlertTriangle, Wifi } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { StatusStrip } from './StatusStrip';

describe('StatusStrip', () => {
  it('renders the semantic tone, message, metadata, and action contract', () => {
    render(
      <StatusStrip
        tone="success"
        icon={Wifi}
        title="Caja sincronizada."
        meta={<span>18 movimientos</span>}
        action={<button type="button">Ver detalle</button>}
      >
        La copia local está respaldada.
      </StatusStrip>
    );

    const strip = screen.getByText('Caja sincronizada.').closest('.pv-strip');
    expect(strip).toHaveClass('success');
    expect(screen.getByText('La copia local está respaldada.')).toBeInTheDocument();
    expect(screen.getByText('18 movimientos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver detalle' })).toBeInTheDocument();
    expect(strip?.querySelector('.ic')).toHaveAttribute('aria-hidden', 'true');
    expect(strip?.querySelector('.detail')).toBeInTheDocument();
  });

  it('forwards accessibility roles and product-specific classes', () => {
    render(
      <StatusStrip
        tone="danger"
        icon={AlertTriangle}
        title="Conexión interrumpida."
        role="alert"
        className="mt-4"
      />
    );

    expect(screen.getByRole('alert')).toHaveClass('pv-strip', 'danger', 'mt-4');
  });
});
