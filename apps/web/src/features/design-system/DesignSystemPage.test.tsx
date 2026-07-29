import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import { assertNoA11yViolations } from '@/test/a11y';
import i18n from '@/i18n';
import { DesignSystemPage } from './DesignSystemPage';

const initialLanguage = i18n.language;

describe('DesignSystemPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('es');
    await i18n.loadNamespaces('designSystem');
  });

  afterAll(async () => {
    await i18n.changeLanguage(initialLanguage);
  });

  it('renders the shared Operator Deck specimens and dense data state', async () => {
    const { container } = render(<DesignSystemPage />);

    expect(
      screen.getByRole('heading', { name: 'Operator Deck, en una sola superficie.' })
    ).toBeInTheDocument();
    expect(screen.getByText('Controles con peso operativo')).toBeInTheDocument();
    expect(screen.getByText('Caja 04')).toBeInTheDocument();
    expect(screen.getByText('Caja sincronizada.')).toBeInTheDocument();
    expect(screen.getByText('Base 12')).toBeInTheDocument();
    expect(screen.getByText('Primero la tarea, luego la complejidad')).toBeInTheDocument();
    expect(screen.getByText('Confirma los datos del negocio')).toBeInTheDocument();
    expect(screen.getByText('Aún no hay productos')).toBeInTheDocument();
    expect(screen.getByText('Una gramática, en toda la operación')).toBeInTheDocument();
    expect(screen.getAllByText('Adoptado')).toHaveLength(3);
    expect(screen.getByText('La coherencia ahora es verificable.')).toBeInTheDocument();
    expect(screen.getByText('Adaptabilidad para el turno completo')).toBeInTheDocument();
    expect(screen.getByText('Contrato adaptable activo.')).toBeInTheDocument();
    expect(screen.getByText('Escala sin ruido operativo')).toBeInTheDocument();
    expect(screen.getByTestId('design-system-scale-count')).toHaveTextContent(/^1000$/);
    expect(screen.getByText('Ventana acotada, contexto completo.')).toBeInTheDocument();
    expect(screen.getByText('Jornadas críticas, una sola promesa')).toBeInTheDocument();
    expect(screen.getByText('Primera venta')).toBeInTheDocument();
    expect(screen.getByText('Cambio seguro de operador')).toBeInTheDocument();
    expect(screen.getByText('10 jornadas protegidas')).toBeInTheDocument();
    expect(screen.getByText('Rendimiento que protege la continuidad')).toBeInTheDocument();
    expect(screen.getByText('500 filas')).toBeInTheDocument();
    expect(screen.getByText('≤ 16 operaciones')).toBeInTheDocument();
    expect(screen.getByText('Gate local + CI')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Cargando puestos de venta' })).toBeInTheDocument();
    await assertNoA11yViolations(container);
  });

  it('exercises the real switch, modal, and drawer primitives', async () => {
    const user = userEvent.setup();
    render(<DesignSystemPage />);

    const assistance = screen.getByRole('switch', { name: /Asistencia contextual/i });
    expect(assistance).toHaveAttribute('aria-checked', 'true');
    await user.click(assistance);
    expect(assistance).toHaveAttribute('aria-checked', 'false');

    await user.click(screen.getByRole('button', { name: 'Probar modal' }));
    expect(screen.getByRole('dialog', { name: 'Confirmar apertura de caja' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Volver' }));
    expect(
      screen.queryByRole('dialog', { name: 'Confirmar apertura de caja' })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abrir inspector' }));
    expect(screen.getByRole('dialog', { name: 'Inspector de roles' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cerrar inspector' }));
    expect(screen.queryByRole('dialog', { name: 'Inspector de roles' })).not.toBeInTheDocument();
  });

  it('exercises progressive disclosure and task-step selection', async () => {
    const user = userEvent.setup();
    render(<DesignSystemPage />);

    const advanced = screen.getByRole('button', { name: /Herramientas avanzadas/i });
    expect(advanced).toHaveAttribute('aria-expanded', 'false');

    await user.click(advanced);
    expect(advanced).toHaveAttribute('aria-expanded', 'true');

    const advancedDevice = screen.getAllByRole('button', { name: 'Dispositivos' })[0]!;
    await user.click(advancedDevice);
    expect(advancedDevice).toHaveAttribute(
      'aria-current',
      'page'
    );

    await user.click(advanced);
    expect(
      screen.getByRole('button', { name: /Configuración guiada/i })
    ).toHaveAttribute('aria-current', 'page');
  });
});
