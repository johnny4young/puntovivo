import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, act, fireEvent } from '@/test/utils';
import { calendarDateAt, startOfWeek } from './scheduleDate';
import i18next from '@/i18n';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  failure: null as unknown,
  toastError: vi.fn(),
  pending: false,
  errors: new Map<string, (error: unknown) => void>(),
  update: vi.fn(),
  cancel: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  exportRefetch: vi.fn(),
  exportUseQuery: vi.fn(),
  context: {
    data: undefined as
      | undefined
      | {
          employees: { id: string; name: string; role: 'manager' | 'cashier' | 'viewer' }[];
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
      isReconciled: boolean;
    }>,
    isPending: false,
    isFetching: false,
    error: null as Error | null,
  },
  attendance: {
    data: {
      timeZone: 'America/Bogota',
      generatedAt: '2026-07-14T22:00:00.000Z',
      page: 1,
      perPage: 10,
      total: 0,
      rows: [],
    },
    isPending: false,
    isFetching: false,
    error: null as Error | null,
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      employeeShifts: { schedule: { list: { invalidate: mocks.invalidate } } },
      workforce: { shiftSwaps: { invalidate: mocks.invalidate } },
      auditLogs: { invalidate: mocks.invalidate },
    }),
    employeeShifts: {
      schedule: {
        context: { useQuery: () => mocks.context },
        list: { useQuery: () => ({ ...mocks.list, refetch: mocks.refetch }) },
      },
      attendance: {
        list: { useQuery: () => ({ ...mocks.attendance, refetch: mocks.refetch }) },
        export: {
          useQuery: (...args: unknown[]) => {
            mocks.exportUseQuery(...args);
            return { data: undefined, isFetching: false, refetch: mocks.exportRefetch };
          },
        },
      },
    },
    workforce: {
      shiftSwaps: {
        managerInbox: {
          useQuery: () => ({
            data: { items: [], nextCursor: null },
            isPending: false,
            isFetching: false,
            error: null,
            refetch: mocks.refetch,
          }),
        },
        events: {
          useQuery: () => ({
            data: { items: [], nextBeforeVersion: null },
            isPending: false,
            isFetching: false,
            error: null,
            refetch: mocks.refetch,
          }),
        },
      },
    },
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'manager-1', tenantId: 'tenant-1', role: 'manager' } }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string, options?: { onError?: (error: unknown) => void }) => {
    if (options?.onError) mocks.errors.set(path, options.onError);
    return {
      mutate: (input: unknown) => {
        const record =
          path === 'employeeShifts.schedule.create'
            ? mocks.create
            : path === 'employeeShifts.schedule.update'
              ? mocks.update
              : mocks.cancel;
        record(input);
        if (mocks.failure) options?.onError?.(mocks.failure);
      },
      isPending: mocks.pending,
    };
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: mocks.toastError }),
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
    isReconciled: false,
  };
}

beforeEach(async () => {
  await i18next.changeLanguage('en');
  mocks.create.mockReset();
  mocks.failure = null;
  mocks.pending = false;
  mocks.errors.clear();
  mocks.toastError.mockReset();
  mocks.update.mockReset();
  mocks.cancel.mockReset();
  mocks.invalidate.mockReset();
  mocks.refetch.mockReset();
  mocks.exportRefetch.mockReset();
  mocks.exportUseQuery.mockReset();
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

describe('TeamSchedulePage', () => {
  it.each(['create', 'update', 'cancel'] as const)(
    'keeps a pending %s decision mounted until its own delayed failure arrives',
    async action => {
      const user = userEvent.setup();
      const view = render(<TeamSchedulePage />);
      const newDecision = screen.getByRole('button', { name: 'Add shift' });
      await user.click(
        action === 'create'
          ? newDecision
          : screen.getByRole('button', {
              name: action === 'update' ? /Edit Ana Torres/ : /Cancel Ana Torres/,
            })
      );
      const dialog = screen.getByRole('dialog');
      if (action !== 'cancel') {
        await user.clear(within(dialog).getByLabelText('Notes'));
        await user.type(within(dialog).getByLabelText('Notes'), 'Decision A');
      }
      await user.click(
        within(dialog).getByRole('button', {
          name: action === 'cancel' ? 'Cancel shift' : 'Save shift',
        })
      );
      mocks.pending = true;
      view.rerender(<TeamSchedulePage />);
      expect(within(dialog).queryByRole('button', { name: 'Close modal' })).not.toBeInTheDocument();
      expect(
        within(dialog).getByRole('button', {
          name: action === 'cancel' ? 'Keep shift' : 'Close',
        })
      ).toBeDisabled();
      await user.keyboard('{Escape}');
      fireEvent.click(dialog.firstElementChild!);
      fireEvent.click(newDecision);
      if (action !== 'cancel') fireEvent.submit(dialog.querySelector('form')!);
      expect(screen.getByRole('dialog')).toBe(dialog);
      expect(
        action === 'create' ? mocks.create : action === 'update' ? mocks.update : mocks.cancel
      ).toHaveBeenCalledTimes(1);
      await act(async () => {
        mocks.pending = false;
        mocks.errors.get(`employeeShifts.schedule.${action}`)!({
          data: { errorCode: 'SCHEDULE_TEMPORARILY_UNAVAILABLE' },
        });
      });
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        i18next.t('workforceErrors:server.SCHEDULE_TEMPORARILY_UNAVAILABLE')
      );
      if (action !== 'cancel')
        expect(within(dialog).getByLabelText('Notes')).toHaveValue('Decision A');
      await user.click(within(dialog).getByRole('button', { name: 'Close modal' }));
      await user.click(newDecision);
      expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument();
    }
  );

  it.each(['en', 'es'] as const)(
    'keeps create, edit and cancel failures inside their dialog without stale copy (%s)',
    async language => {
      await i18next.changeLanguage(language);
      mocks.failure = {
        data: { errorCode: 'SCHEDULE_TEMPORARILY_UNAVAILABLE' },
        message: 'SQLITE_CONSTRAINT: private evidence',
      };
      const user = userEvent.setup();
      render(<TeamSchedulePage />);
      for (const action of ['create', 'edit', 'cancel'] as const) {
        if (action === 'create')
          await user.click(screen.getByRole('button', { name: /^(Add shift|Agregar turno)$/ }));
        else
          await user.click(
            screen.getByRole('button', {
              name:
                action === 'edit'
                  ? /Edit Ana Torres|Editar turno de Ana/
                  : /Cancel Ana Torres|Cancelar turno de Ana/,
            })
          );
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
        if (action !== 'cancel') {
          await user.clear(within(dialog).getByLabelText(/Notes|Notas/));
          await user.type(within(dialog).getByLabelText(/Notes|Notas/), 'Preserve this decision');
        }
        await user.click(
          within(dialog).getByRole('button', {
            name:
              action === 'cancel'
                ? /^(Cancel shift|Cancelar turno)$/
                : /^(Save shift|Guardar turno)$/,
          })
        );
        const alert = within(dialog).getByRole('alert');
        expect(alert).toHaveTextContent(
          i18next.t('workforceErrors:server.SCHEDULE_TEMPORARILY_UNAVAILABLE')
        );
        expect(alert).not.toHaveTextContent(/SQLITE|SCHEDULE_|workforceErrors:/);
        expect(mocks.toastError).not.toHaveBeenCalled();
        if (action !== 'cancel')
          expect(within(dialog).getByLabelText(/Notes|Notas/)).toHaveValue(
            'Preserve this decision'
          );
        await user.click(within(dialog).getByLabelText(/Close modal|Cerrar modal/));
      }
      await user.click(screen.getByRole('button', { name: /^(Add shift|Agregar turno)$/ }));
      expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument();
    }
  );

  it('renders a responsive weekly schedule with tenant timezone and KPIs', async () => {
    render(<TeamSchedulePage />);

    expect(screen.getByTestId('team-schedule-page')).toHaveTextContent(/Team schedule|Horario/);
    const activeView = screen.getByRole('button', {
      name: /Schedule and attendance|Horarios y asistencia/,
    });
    expect(activeView).toHaveAttribute('aria-pressed', 'true');
    expect(activeView).toHaveClass('btn-primary');
    expect(screen.getByTestId('schedule-week-grid').children).toHaveLength(7);
    expect(screen.getByTestId('scheduled-shift-schedule-1')).toHaveTextContent('Ana Torres');
    expect(screen.getByTestId('scheduled-shift-schedule-1')).toHaveTextContent('Sede Centro');
    expect(screen.getByTestId('team-schedule-page')).toHaveTextContent(/8/);
    expect(await screen.findByTestId('team-attendance-panel')).toBeInTheDocument();
    expect(screen.getAllByText(/America\/Bogota/)).toHaveLength(2);
    expect(mocks.exportUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({ fromDate: currentWeekStart() }),
      expect.objectContaining({ enabled: false })
    );
  });

  it('lazy-loads the independent shift exchange inbox from the workforce views', async () => {
    const user = userEvent.setup();
    render(<TeamSchedulePage />);
    await user.click(screen.getByRole('button', { name: 'Shift exchanges' }));
    expect(await screen.findByTestId('shift-swap-manager-panel')).toHaveTextContent(
      'Shift exchange approvals'
    );
  });

  it('schedules an eligible viewer worker without changing the employee role', async () => {
    mocks.context.data!.employees.push({ id: 'viewer-1', name: 'Worker Viewer', role: 'viewer' });
    const user = userEvent.setup();
    render(<TeamSchedulePage />);
    await user.click(screen.getAllByRole('button', { name: /Add shift|Agregar turno/ })[0]!);
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('option', { name: /Worker Viewer · (Viewer|Consulta)/ })
    ).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText(/Employee|Empleado/), 'viewer-1');
    await user.click(within(dialog).getByRole('button', { name: /Save shift|Guardar turno/ }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'viewer-1' }));
    expect(mocks.context.data!.employees.at(-1)?.role).toBe('viewer');
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

  it('labels reconciled shifts as historical evidence without offering destructive actions', () => {
    mocks.list.data = [{ ...shiftFixture(), isReconciled: true }];
    render(<TeamSchedulePage />);

    const card = screen.getByTestId('scheduled-shift-schedule-1');
    expect(card).toHaveTextContent('Reconciled · historical evidence');
    expect(within(card).queryByRole('button', { name: /Edit Ana Torres/ })).not.toBeInTheDocument();
    expect(
      within(card).queryByRole('button', { name: /Cancel Ana Torres/ })
    ).not.toBeInTheDocument();
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
