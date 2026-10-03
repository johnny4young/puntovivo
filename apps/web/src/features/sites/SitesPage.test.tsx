import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, within, waitFor } from '@/test/utils';
import { SitesPage } from './SitesPage';

const invalidateSites = vi.fn(async () => undefined);
const invalidateReadiness = vi.fn(async () => undefined);
const createSite = vi.fn();
const updateSite = vi.fn();
const deleteSite = vi.fn();
const toastSuccess = vi.fn();
let existingSiteActive = true;

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: 'admin' } }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn() }),
}));

vi.mock('@/lib/trpc', () => {
  const mutation = (write: (input: unknown) => void) => ({
    useMutation: (options: { onSuccess: () => Promise<void> }) => ({
      mutateAsync: async (input: unknown) => {
        write(input);
        await options.onSuccess();
      },
      isPending: false,
      error: null,
      reset: vi.fn(),
    }),
  });
  return {
    trpc: {
      useUtils: () => ({
        sites: { list: { invalidate: invalidateSites } },
        setupReadiness: { get: { invalidate: invalidateReadiness } },
      }),
      companies: { getCurrent: { useQuery: () => ({ data: { id: 'company-1' } }) } },
      locations: { list: { useQuery: () => ({ data: { items: [] } }) } },
      sites: {
        list: {
          useQuery: () => ({
            data: { items: [{ id: 'site-1', name: 'Test Site', isActive: existingSiteActive }] },
            isLoading: false,
            error: null,
          }),
        },
        listLocationAssignments: { useQuery: () => ({ data: undefined }) },
        create: mutation(input => createSite(input)),
        update: mutation(input => updateSite(input)),
        delete: mutation(input => deleteSite(input)),
        replaceLocationAssignments: mutation(vi.fn()),
      },
    },
  };
});

describe('SitesPage readiness refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existingSiteActive = true;
  });

  async function expectFreshReads() {
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledOnce());
    expect(invalidateSites).toHaveBeenCalledOnce();
    expect(invalidateReadiness).toHaveBeenCalledOnce();
  }

  it('refreshes the guide after creating an active site', async () => {
    const user = userEvent.setup();
    render(<SitesPage />);
    await user.click(screen.getByRole('button', { name: 'Add Site' }));
    await user.type(screen.getByRole('textbox', { name: 'Site Name' }), 'New site');
    await user.click(screen.getByRole('button', { name: 'Create Site' }));

    expect(createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New site', isActive: true })
    );
    await expectFreshReads();
  });

  it.each([true, false])('refreshes the guide after saving active=%s', async isActive => {
    const user = userEvent.setup();
    existingSiteActive = !isActive;
    render(<SitesPage />);
    const buttons = within(screen.getByRole('row', { name: /Test Site/ })).getAllByRole('button');
    const edit = buttons[1];
    if (!edit) throw new Error('Missing site edit action');
    await user.click(edit);
    const checkbox = screen.getByRole('checkbox', { name: 'Site is active' });
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(updateSite).toHaveBeenCalledWith(expect.objectContaining({ id: 'site-1', isActive }));
    await expectFreshReads();
  });

  it('refreshes the guide after a permitted site deletion', async () => {
    const user = userEvent.setup();
    render(<SitesPage />);
    const buttons = within(screen.getByRole('row', { name: /Test Site/ })).getAllByRole('button');
    const remove = buttons[2];
    if (!remove) throw new Error('Missing site delete action');
    await user.click(remove);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteSite).toHaveBeenCalledWith({ id: 'site-1' });
    await expectFreshReads();
  });
});
