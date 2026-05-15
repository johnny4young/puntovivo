import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Overlay } from '../Overlay';

describe('Overlay', () => {
  it('renders the kicker + title + description trio when open', () => {
    render(
      <Overlay
        isOpen
        onClose={vi.fn()}
        kicker="APERTURA DE CAJA"
        title="Activación del turno"
        description="Cuenta el efectivo inicial por denominación."
      >
        <div>body</div>
      </Overlay>
    );

    expect(screen.getByText('APERTURA DE CAJA')).toBeInTheDocument();
    expect(screen.getByText('Activación del turno')).toBeInTheDocument();
    expect(screen.getByText('Cuenta el efectivo inicial por denominación.')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(
      <Overlay isOpen={false} onClose={vi.fn()} title="Title">
        <div>body</div>
      </Overlay>
    );

    expect(screen.queryByText('Title')).not.toBeInTheDocument();
    expect(screen.queryByText('body')).not.toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Overlay isOpen onClose={onClose} title="Title">
        <div>body</div>
      </Overlay>
    );

    const closeButton = screen.getByRole('button', { name: /close|cerrar/i });
    await user.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('omits the kicker block when none is provided', () => {
    render(
      <Overlay isOpen onClose={vi.fn()} title="Title">
        <div>body</div>
      </Overlay>
    );

    expect(screen.queryByText(/APERTURA DE CAJA/)).not.toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
  });

  it('renders an optional headerAside slot next to the close button', () => {
    render(
      <Overlay
        isOpen
        onClose={vi.fn()}
        title="Title"
        headerAside={<span data-testid="aside-pill">Paso 1 de 3</span>}
      >
        <div>body</div>
      </Overlay>
    );

    expect(screen.getByTestId('aside-pill')).toHaveTextContent('Paso 1 de 3');
  });
});
