import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertNoA11yViolations } from '@/test/a11y';
import type { CustomerDisplayProjection } from '../customerDisplayProjection';

const ACCESS_ID = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
  language: 'es' as 'en' | 'es',
  projections: [] as CustomerDisplayProjection[],
  projection: null as CustomerDisplayProjection | null,
  connection: 'waiting' as 'waiting' | 'live' | 'offline',
  reconnect: vi.fn(),
  feedHook: vi.fn(),
}));

const COPY = {
  en: {
    'shell.product': 'Puntovivo Customer Display',
    eyebrow: 'Live checkout',
    'register.label': 'Register',
    'register.none': 'No open registers',
    'actions.reconnect': 'Reconnect',
    'states.live': 'Live',
    'states.offline.title': 'Display offline',
    'states.offline.description': 'Cart details are hidden until the connection returns.',
    'states.noRegister.title': 'Open a register to begin',
    'states.noRegister.description': 'Start a cash session on the sales screen.',
    'states.waiting.title': 'Waiting for {{register}}',
    'states.waiting.description': 'Keep the active sales screen open.',
    'states.idle.title': 'Ready for the next purchase',
    'states.idle.description': 'Items and totals will appear here.',
    'cart.title': 'Your purchase',
    'cart.quantity': '{{quantity}} {{unit}}',
    'cart.discount': '{{discount}}% discount',
    'summary.ariaLabel': 'Purchase totals',
    'summary.items': 'Items',
    'summary.subtotal': 'Subtotal',
    'summary.tax': 'Tax',
    'summary.total': 'Total',
    'summary.checkoutHint': 'The cashier will confirm the final amount.',
    privacy: 'This screen shows products and totals only.',
  },
  es: {
    'shell.product': 'Pantalla cliente de Puntovivo',
    eyebrow: 'Compra en curso',
    'register.label': 'Caja',
    'register.none': 'No hay cajas abiertas',
    'actions.reconnect': 'Reconectar',
    'states.live': 'En vivo',
    'states.offline.title': 'Pantalla sin conexión',
    'states.offline.description': 'Los detalles del carrito se ocultan.',
    'states.noRegister.title': 'Abre una caja para comenzar',
    'states.noRegister.description': 'Inicia una sesión de caja en Ventas.',
    'states.waiting.title': 'Esperando a {{register}}',
    'states.waiting.description': 'Mantén abierta la venta activa.',
    'states.idle.title': 'Todo listo para la próxima compra',
    'states.idle.description': 'Los productos y totales aparecerán aquí.',
    'cart.title': 'Tu compra',
    'cart.quantity': '{{quantity}} {{unit}}',
    'cart.discount': '{{discount}} % de descuento',
    'summary.ariaLabel': 'Totales de la compra',
    'summary.items': 'Artículos',
    'summary.subtotal': 'Subtotal',
    'summary.tax': 'Impuestos',
    'summary.total': 'Total',
    'summary.checkoutHint': 'El cajero confirmará el valor final.',
    privacy: 'Esta pantalla solo muestra productos y totales.',
  },
} as const;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      const dictionary = COPY[mocks.language] as Record<string, string>;
      let result = dictionary[key] ?? key;
      for (const [name, value] of Object.entries(values ?? {})) {
        result = result.replace(`{{${name}}}`, String(value));
      }
      return result;
    },
    i18n: { resolvedLanguage: mocks.language },
  }),
}));

vi.mock('../useCustomerDisplayFeed', () => ({
  useCustomerDisplayFeed: (accessId: string | null, requestedSessionId: string | null) => {
    mocks.feedHook(accessId, requestedSessionId);
    const selectedSessionId = mocks.projections.some(
      projection => projection.cashSessionId === requestedSessionId
    )
      ? requestedSessionId
      : (mocks.projections[0]?.cashSessionId ?? null);
    const selectedProjection =
      mocks.projection?.cashSessionId === selectedSessionId ? mocks.projection : null;
    return {
      projections: mocks.projections,
      selectedSessionId,
      projection: selectedProjection,
      connection: mocks.connection,
      reconnect: mocks.reconnect,
    };
  },
}));

import { CustomerDisplayHome } from '../CustomerDisplayHome';

function displayProjection(
  cashSessionId = 'session-1',
  registerName = 'Caja 1'
): CustomerDisplayProjection {
  return {
    schemaVersion: 1,
    accessId: ACCESS_ID,
    tenantId: 'tenant-1',
    siteId: 'site-1',
    cashSessionId,
    revision: 1,
    publishedAt: '2026-09-04T18:00:00.000Z',
    registerName,
    currency: 'COP',
    items: [
      {
        name: 'Café molido',
        unitName: 'Bolsa',
        quantity: 2,
        unitPrice: 10_000,
        discountPercent: 5,
        total: 19_000,
      },
    ],
    summary: { itemCount: 2, subtotal: 19_000, taxAmount: 3_610, total: 22_610 },
  };
}

function renderHome(path = `/customer-display?access=${ACCESS_ID}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CustomerDisplayHome />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.language = 'es';
  mocks.projections = [displayProjection()];
  mocks.projection = null;
  mocks.connection = 'waiting';
});

describe('CustomerDisplayHome', () => {
  it('fails closed without a valid pairing capability or active publisher', () => {
    mocks.projections = [];
    renderHome('/customer-display?access=invalid');

    expect(mocks.feedHook).toHaveBeenCalledWith(null, null);
    expect(screen.getByTestId('customer-display-no-register')).toBeInTheDocument();
    expect(screen.queryByTestId('customer-display-items')).not.toBeInTheDocument();
  });

  it('shows a fresh minimal cart in Spanish without cashier or session PII', async () => {
    mocks.projection = displayProjection();
    mocks.connection = 'live';
    renderHome();

    expect(await screen.findByText('Tu compra')).toBeInTheDocument();
    expect(screen.getByText('Café molido')).toBeInTheDocument();
    expect(screen.getByText('5 % de descuento')).toBeInTheDocument();
    expect(screen.getByTestId('customer-display-total')).toHaveTextContent('22.610');
    expect(document.body.textContent).not.toContain('tenant-1');
    expect(document.body.textContent).not.toContain('session-1');
  });

  it('renders the same live workflow in English', async () => {
    mocks.language = 'en';
    mocks.projection = displayProjection();
    mocks.connection = 'live';
    renderHome();

    expect(await screen.findByText('Your purchase')).toBeInTheDocument();
    expect(screen.getByText('5% discount')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Purchase totals' })).toBeInTheDocument();
  });

  it('changes between paired registers and supports explicit reconnection', async () => {
    mocks.projections = [displayProjection(), displayProjection('session-2', 'Caja 2')];
    renderHome();
    const selector = await screen.findByTestId('customer-display-register');
    expect(selector).toHaveValue('session-1');

    fireEvent.change(selector, { target: { value: 'session-2' } });
    await waitFor(() => expect(mocks.feedHook).toHaveBeenLastCalledWith(ACCESS_ID, 'session-2'));

    fireEvent.click(screen.getByTestId('customer-display-reconnect'));
    expect(mocks.reconnect).toHaveBeenCalledOnce();
  });

  it('hides every previous line and total while offline', () => {
    mocks.projection = displayProjection();
    mocks.connection = 'offline';
    renderHome();

    expect(screen.getByTestId('customer-display-offline')).toBeInTheDocument();
    expect(screen.queryByText('Café molido')).not.toBeInTheDocument();
    expect(screen.queryByTestId('customer-display-total')).not.toBeInTheDocument();
  });

  it('has no serious WCAG violations in the live touch layout', async () => {
    mocks.projection = displayProjection();
    mocks.connection = 'live';
    const { container } = renderHome();
    await screen.findByText('Tu compra');
    await assertNoA11yViolations(container);
  });
});
