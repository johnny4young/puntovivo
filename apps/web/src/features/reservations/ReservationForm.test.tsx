import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@/test/utils';
import i18n from '@/i18n';
import { ReservationForm } from './ReservationForm';
import { ReservationChoice } from './ReservationChoice';
import { fromLocalReservationTime, toLocalReservationTime } from './reservationTime';
const h = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), tableError: false }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    restaurantTables: {
      list: {
        useQuery: () => ({
          data: { items: [{ id: 'table', name: 'Patio', seatCount: 4 }] },
          isLoading: false,
          error: h.tableError ? new Error('internal') : null,
        }),
      },
    },
  },
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => ({
    mutateAsync: path === 'reservations.create' ? h.create : h.update,
    isPending: false,
  }),
}));
describe('Reservation inputs and explicit seating', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    h.tableError = false;
    h.create.mockResolvedValue({ id: 'reservation' });
    await i18n.changeLanguage('en');
  });
  it('sends the selected site/table and normalized UTC window with no sale or payment fields', async () => {
    const saved = vi.fn();
    render(<ReservationForm siteId="site" onSaved={saved} onCancel={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Guest name'), 'Party');
    await user.selectOptions(screen.getByLabelText('Table'), 'table');
    fireEvent.change(screen.getByLabelText('Starts at'), { target: { value: '2030-05-01T12:00' } });
    fireEvent.change(screen.getByLabelText('Ends at'), { target: { value: '2030-05-01T13:00' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.create).toHaveBeenCalledWith({
      siteId: 'site',
      tableId: 'table',
      guestName: 'Party',
      phone: '',
      notes: '',
      partySize: 2,
      startsAt: new Date('2030-05-01T12:00').toISOString(),
      endsAt: new Date('2030-05-01T13:00').toISOString(),
    });
    expect(saved).toHaveBeenCalledOnce();
    expect(saved).toHaveBeenCalledWith(new Date('2030-05-01T12:00').toISOString());
  });
  it('rejects reverse windows and blocks duplicate submits while the response is pending', async () => {
    let resolve!: () => void;
    h.create.mockImplementation(
      () =>
        new Promise<void>(done => {
          resolve = done;
        })
    );
    render(<ReservationForm siteId="site" onSaved={vi.fn()} onCancel={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Guest name'), 'Party');
    fireEvent.change(screen.getByLabelText('Starts at'), { target: { value: '2030-05-01T13:00' } });
    fireEvent.change(screen.getByLabelText('Ends at'), { target: { value: '2030-05-01T12:00' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.create).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('duration of at most 24 hours');
    fireEvent.change(screen.getByLabelText('Ends at'), { target: { value: '2030-05-01T14:00' } });
    await user.dblClick(screen.getByRole('button', { name: 'Save' }));
    expect(h.create).toHaveBeenCalledOnce();
    resolve();
  });
  it('never submits a missing table catalog or exposes internal errors', async () => {
    h.tableError = true;
    render(<ReservationForm siteId="site" onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.queryByText('internal')).not.toBeInTheDocument();
  });
  it('translates the domain error and keeps the form editable after a rejection', async () => {
    h.create.mockRejectedValue({
      data: { errorCode: 'RESERVATION_SLOT_CONFLICT' },
      message: 'SQLITE private path',
    });
    render(<ReservationForm siteId="site" onSaved={vi.fn()} onCancel={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Guest name'), 'Party');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('overlapping reservation')
    );
    expect(screen.queryByText(/SQLITE/)).not.toBeInTheDocument();
  });
  it('requires explicit party consent without default-checking arrival', async () => {
    const change = vi.fn();
    render(
      <ReservationChoice
        row={{ id: 'r', version: 2, guestName: 'Ada', partySize: 2 }}
        checked={false}
        disabled={false}
        onChange={change}
      />
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Seat reservation for Ada (2 guests)' });
    expect(checkbox).not.toBeChecked();
    await userEvent.click(checkbox);
    expect(change).toHaveBeenCalledWith(true);
  });
  it('rejects invalid local dates and round-trips ordinary instants', () => {
    expect(fromLocalReservationTime('not a date')).toBeNull();
    expect(fromLocalReservationTime('2030-02-31T12:00')).toBeNull();
    const instant = '2030-05-01T12:00:00.000Z';
    expect(fromLocalReservationTime(toLocalReservationTime(instant))).toBe(instant);
  });
});
