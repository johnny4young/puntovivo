import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { render, screen } from '@/test/utils';
import { ReservationsPage } from './ReservationsPage';
import { toLocalReservationTime } from './reservationTime';

const h = vi.hoisted(() => ({ list: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: { id: 'site-owned' } }),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    reservations: { list: { useQuery: h.list } },
    restaurantTables: { list: { useQuery: () => ({ data: { items: [] } }) } },
    useUtils: () => ({
      reservations: { invalidate: h.invalidate },
      restaurantServices: { invalidate: h.invalidate },
      restaurantTables: { invalidate: h.invalidate },
    }),
  },
}));
vi.mock('./ReservationForm', () => ({
  ReservationForm: ({ onSaved }: { onSaved: (startsAt: string) => void }) => (
    <button onClick={() => onSaved('2030-05-02T04:30:00.000Z')}>Save booking fixture</button>
  ),
}));

describe('reservation save visibility', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    h.list.mockReturnValue({ data: { rows: [], hasMore: false }, isLoading: false });
    await i18n.changeLanguage('en');
  });

  it('selects the saved local day and clears an incompatible status filter', async () => {
    render(<ReservationsPage />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Status'), 'cancelled');
    await user.click(screen.getByRole('button', { name: 'New reservation' }));
    await user.click(screen.getByRole('button', { name: 'Save booking fixture' }));
    const day = toLocalReservationTime('2030-05-02T04:30:00.000Z').slice(0, 10);
    expect(screen.getByLabelText('Day')).toHaveValue(day);
    expect(screen.getByLabelText('Status')).toHaveValue('');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(h.list.mock.lastCall?.[0]).toEqual({
      siteId: 'site-owned',
      from: new Date(`${day}T00:00`).toISOString(),
      to: new Date(
        new Date(`${day}T00:00`).setDate(new Date(`${day}T00:00`).getDate() + 1)
      ).toISOString(),
    });
    expect(h.invalidate).toHaveBeenCalledTimes(3);
  });
});
