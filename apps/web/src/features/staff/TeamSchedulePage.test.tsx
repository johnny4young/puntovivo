import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@/test/utils';
import { calendarDateAt, startOfWeek } from './scheduleDate';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  context: {
    data: undefined as
      | undefined
      | {
          employees: { id: string; name: string; role: 'manager' | 'cashier' }[];
          sites: { id: string; name: string }[];
          locale: string;
          timeZone: string;
          firstDayOfWeek: number;
        },
    isPending: false,
    isSuccess: true,
    error: null as Error | null,
  },
  list: {
    data: [] as Array<{
      id: string;
      tenantId: string;
      userId: string;
      userName: string;
      userRole: 'manager' | 'cashier';
      siteId: string;
      siteName: string;
      startsAt: string;
      endsAt: string;
      timeZone: string;
      status: 'scheduled' | 'cancelled';
      notes: string | null;
      version: number;
      createdByUserId: string;
      updatedByUserId: string;
      cancelledAt: string | null;
      cancelledByUserId: string | null;
      createdAt: string;
      updatedAt: string;
    }>,
    isPending: false,
    isFetching: false,
    error: null as Error | null,
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      employeeShifts: { schedule: { list: { invalidate: mocks.invalidate } } },
    }),
    employeeShifts: {
      schedule: {
        context: { useQuery: () => mocks.context },
        list: { useQuery: () => ({ ...mocks.list, refetch: mocks.refetch }) },
      },
    },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => ({
    mutate:
      path === 'employeeShifts.schedule.create'
        ? mocks.create
        : path === 'employeeShifts.schedule.update'
          ? mocks.update
          : mocks.cancel,
    isPending: false,
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { TeamSchedulePage } from './TeamSchedulePage';

function currentWeekStart(): string {
  return startOfWeek(calendarDateAt(new Date(), 'America/Bogota'), 1);
}

function shiftFixture() {
  const day = currentWeekStart();
  return {
    id: 'schedule-1',
    tenantId: 'tenant-1',
    userId: 'cashier-1',
    userName: 'Ana Torres',
    userRole: 'cashier' as const,
    siteId: 'site-1',
    siteName: 'Sede Centro',
    startsAt: `${day}T14:00:00.000Z`,
    endsAt: `${day}T22:00:00.000Z`,
    timeZone: 'America/Bogota',
    status: 'scheduled' as const,
    notes: 'Caja principal',
    version: 2,
    createdByUserId: 'manager-1',
    updatedByUserId: 'manager-1',
    cancelledAt: null,
    cancelledByUserId: null,
    createdAt: `${day}T12:00:00.000Z`,
    updatedAt: `${day}T12:00:00.000Z`,
  };
}

beforeEach(() => {
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.cancel.mockReset();
  mocks.invalidate.mockReset();
  mocks.refetch.mockReset();
  mocks.context.data = {
    employees: [
      { id: 'manager-1', name: 'Mario Ruiz', role: 'manager' },
      { id: 'cashier-1', name: 'Ana Torres', role: 'cashier' },
    ],
    sites: [{ id: 'site-1', name: 'Sede Centro' }],
    locale: 'es-CO',
    timeZone: 'America/Bogota',
    firstDayOfWeek: 1,
  };
  mocks.context.isPending = false;
  mocks.context.isSuccess = true;
  mocks.context.error = null;
  mocks.list.data = [shiftFixture()];
  mocks.list.isPending = false;
  mocks.list.isFetching = false;
  mocks.list.error = null;
});

describe('TeamSchedulePage (ENG-140a)', () => {
  it('renders a responsive weekly schedule with tenant timezone and KPIs', () => {
    render(<TeamSchedulePage />);

    expect(screen.getByTestId('team-schedule-page')).toHaveTextContent(/Team schedule|Horario/);
    expect(screen.getByText(/America\/Bogota/)).toBeInTheDocument();
    expect(screen.getByTestId('schedule-week-grid').children).toHaveLength(7);
    expect(screen.getByTestId('scheduled-shift-schedule-1')).toHaveTextContent('Ana Torres');
    expect(screen.getByTestId('scheduled-shift-schedule-1')).toHaveTextContent('Sede Centro');
    expect(screen.getByTestId('team-schedule-page')).toHaveTextContent(/8/);
  });

  it('creates a shift from a day-specific CTA with stable defaults', async () => {
    const user = userEvent.setup();
    render(<TeamSchedulePage />);
    const firstDay = screen.getByTestId('schedule-week-grid').children[0] as HTMLElement;
    await user.click(within(firstDay).getByRole('button', { name: /Add shift|Agregar turno/ }));

    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Employee|Empleado/), 'cashier-1');
    await user.click(within(dialog).getByRole('button', { name: /Save shift|Guardar turno/ }));

    expect(mocks.create).toHaveBeenCalledWith({
      userId: 'cashier-1',
      siteId: 'site-1',
      startDate: currentWeekStart(),
      startTime: '09:00',
      endDate: currentWeekStart(),
      endTime: '17:00',
      notes: null,
    });
  });

  it('edits with the row version and confirms cancellation without deleting', async () => {
    const user = userEvent.setup();
    render(<TeamSchedulePage />);

    await user.click(screen.getByRole('button', { name: /Edit Ana Torres|Editar turno de Ana/ }));
    const editDialog = screen.getByRole('dialog');
    const startTime = within(editDialog).getByLabelText(/Start time|Hora de inicio/);
    await user.clear(startTime);
    await user.type(startTime, '10:00');
    await user.click(within(editDialog).getByRole('button', { name: /Save shift|Guardar turno/ }));
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'schedule-1', version: 2, startTime: '10:00' })
    );

    await user.click(within(editDialog).getByLabelText(/Close modal|Cerrar modal/));
    await user.click(
      screen.getByRole('button', { name: /Cancel Ana Torres|Cancelar turno de Ana/ })
    );
    const cancelDialog = screen.getByRole('dialog');
    expect(cancelDialog).toHaveTextContent('Ana Torres');
    await user.click(
      within(cancelDialog).getByRole('button', { name: /Cancel shift|Cancelar turno/ })
    );
    expect(mocks.cancel).toHaveBeenCalledWith({ id: 'schedule-1', version: 2 });
  });

  it('does not silently substitute an inactive employee or site while editing', async () => {
    const user = userEvent.setup();
    mocks.context.data = {
      ...mocks.context.data!,
      employees: [{ id: 'manager-1', name: 'Mario Ruiz', role: 'manager' }],
      sites: [{ id: 'site-2', name: 'Sede Nueva' }],
    };
    render(<TeamSchedulePage />);

    await user.click(screen.getByRole('button', { name: /Edit Ana Torres|Editar turno de Ana/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/Employee|Empleado/)).toHaveValue('cashier-1');
    expect(within(dialog).getByLabelText(/Site|Sede/)).toHaveValue('site-1');
    expect(within(dialog).getByText(/Unavailable employee|Empleado no disponible/)).toBeDisabled();
    expect(within(dialog).getByText(/Unavailable site|Sede no disponible/)).toBeDisabled();
  });

  it('shows setup guidance instead of a broken editor when no resources exist', () => {
    mocks.context.data = {
      ...mocks.context.data!,
      employees: [],
      sites: [],
    };
    mocks.list.data = [];
    render(<TeamSchedulePage />);

    expect(screen.getByText(/Schedule setup is incomplete|Falta configurar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add shift|Agregar turno/ })).toBeDisabled();
  });
});
