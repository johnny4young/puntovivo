import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import i18next from '@/i18n';
import { render, screen } from '@/test/utils';
import type { Site } from '@/types';
import { PeripheralsPage } from '../PeripheralsPage';

/**
 * PeripheralsPage smoke tests.
 *
 * The intent is to lock the operator-visible empty state, the row
 * grouping by kind, and the action-trigger surface (Test / Edit /
 * Activate / Remove). The trpc client is fully mocked so the page
 * stays a pure render assertion.
 */

interface PeripheralRow {
  id: string;
  tenantId: string;
  siteId: string;
  kind: 'printer' | 'cash_drawer' | 'scanner' | 'payment_terminal' | 'customer_display';
  driver: string;
  config: Record<string, unknown>;
  displayName: string | null;
  isActive: boolean;
  lastTestedAt: string | null;
  lastTestResult: 'ok' | 'failed' | null;
  lastTestDetails: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

const sites: Site[] = [
  {
    id: 'site-1',
    tenantId: 'tenant-1',
    companyId: 'company-1',
    name: 'Main Site',
    address: null,
    phone: null,
    isActive: true,
    createdAt: new Date('2026-04-17T12:00:00Z').toISOString(),
    updatedAt: new Date('2026-04-17T12:00:00Z').toISOString(),
  },
];

const printerRow: PeripheralRow = {
  id: 'periph-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  kind: 'printer',
  driver: 'system',
  config: {},
  displayName: 'Front register',
  isActive: true,
  lastTestedAt: '2026-05-01T15:00:00Z',
  lastTestResult: 'ok',
  lastTestDetails: null,
  createdAt: new Date('2026-04-17T12:00:00Z').toISOString(),
  updatedAt: new Date('2026-04-17T12:00:00Z').toISOString(),
};

let peripheralRows: PeripheralRow[] = [];

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      tenantId: 'tenant-1',
      role: 'admin',
    },
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      peripherals: {
        list: { invalidate: vi.fn(async () => undefined) },
      },
      setupReadiness: {
        get: { invalidate: vi.fn(async () => undefined) },
        checkout: { invalidate: vi.fn(async () => undefined) },
      },
    }),
    sites: {
      list: {
        useQuery: () => ({
          data: { items: sites },
          isLoading: false,
          error: null,
        }),
      },
    },
    peripherals: {
      list: {
        useQuery: () => ({
          data: peripheralRows,
          isLoading: false,
          error: null,
        }),
      },
      register: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
          error: null,
          reset: vi.fn(),
        }),
      },
      update: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
          error: null,
          reset: vi.fn(),
        }),
      },
      setActive: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
          error: null,
          reset: vi.fn(),
        }),
      },
      test: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
          error: null,
          reset: vi.fn(),
        }),
      },
      remove: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
          error: null,
          reset: vi.fn(),
        }),
      },
    },
  },
}));

describe('PeripheralsPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18next.changeLanguage('en');
    peripheralRows = [];
  });

  it('renders the empty state with the Add peripheral CTA when no rows exist', () => {
    peripheralRows = [];
    render(<PeripheralsPage />);

    expect(screen.getByTestId('peripherals-empty-state')).toBeInTheDocument();
    expect(screen.getByText('No peripherals registered yet')).toBeInTheDocument();
    // The header CTA renders alongside the empty-state CTA — there
    // should be at least two "Add peripheral" affordances.
    const ctas = screen.getAllByText('Add peripheral');
    expect(ctas.length).toBeGreaterThanOrEqual(2);
  });

  it('renders the page title and description', () => {
    render(<PeripheralsPage />);

    expect(screen.getByText('Peripherals')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Configure thermal printer, cash drawer, barcode scanner, and payment terminal per site.'
      )
    ).toBeInTheDocument();
  });

  it('renders a row grouped under its kind when peripherals exist', () => {
    peripheralRows = [printerRow];
    render(<PeripheralsPage />);

    expect(screen.getByTestId('peripherals-section-printer')).toBeInTheDocument();
    expect(screen.getByTestId(`peripherals-row-${printerRow.id}`)).toBeInTheDocument();
    // Driver label is translated from the static `driver.system` key.
    expect(screen.getByText('System (OS print dialog)')).toBeInTheDocument();
    // Display name shows verbatim.
    expect(screen.getByText('Front register')).toBeInTheDocument();
    // OK badge — renders the status copy.
    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it('exposes Test / Edit / Activate / Remove action affordances per row', () => {
    peripheralRows = [printerRow];
    render(<PeripheralsPage />);

    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    // Active row → button label says Deactivate.
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('resets the form state when switching from create to edit', async () => {
    const user = userEvent.setup();
    peripheralRows = [printerRow];
    render(<PeripheralsPage />);

    await user.click(screen.getByTestId('peripherals-add-button'));
    await user.type(screen.getByLabelText('Display name'), 'Scratch printer');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Display name')).toHaveValue('Front register');
  });

  it('renders the Untested status when a peripheral has never been tested', () => {
    peripheralRows = [{ ...printerRow, lastTestedAt: null, lastTestResult: null }];
    render(<PeripheralsPage />);

    expect(screen.getAllByText('Not tested').length).toBeGreaterThanOrEqual(1);
  });

  // the auto-print toggle ships only for the ESC/POS printer
  // driver pair. Other (kind, driver) combinations must not surface it
  // so cashier UI hooks never read a flag from an unrelated peripheral.
  it('hides the  auto-print toggle for the system printer driver', async () => {
    const user = userEvent.setup();
    peripheralRows = [];
    render(<PeripheralsPage />);
    await user.click(screen.getByTestId('peripherals-add-button'));
    // Default new-entry pair is (printer, system) — no toggle.
    expect(screen.queryByTestId('peripheral-auto-print-toggle')).not.toBeInTheDocument();
  });

  it('shows the  auto-print toggle for the ESC/POS printer driver', async () => {
    const user = userEvent.setup();
    peripheralRows = [];
    render(<PeripheralsPage />);
    await user.click(screen.getByTestId('peripherals-add-button'));
    // Switch the driver to escpos — the toggle must appear.
    const driverSelect = screen.getByLabelText('Driver');
    await user.selectOptions(driverSelect, 'escpos');
    expect(screen.getByTestId('peripheral-auto-print-toggle')).toBeInTheDocument();
    // Help copy is rendered alongside.
    expect(screen.getByText('Print automatically when a sale closes')).toBeInTheDocument();
    expect(
      screen.getByText('ESC/POS TCP targets must use private LAN IPs and ports 9100-9103.')
    ).toBeInTheDocument();
    expect((screen.getByLabelText('Configuration (JSON)') as HTMLTextAreaElement).value).toContain(
      '"host": "192.168.1.50"'
    );
  });

  it('writes the auto-print flag into the config JSON when toggled on', async () => {
    const user = userEvent.setup();
    peripheralRows = [];
    render(<PeripheralsPage />);
    await user.click(screen.getByTestId('peripherals-add-button'));
    await user.selectOptions(screen.getByLabelText('Driver'), 'escpos');
    const toggle = screen.getByTestId('peripheral-auto-print-toggle') as HTMLInputElement;
    await user.click(toggle);
    expect(toggle.checked).toBe(true);
    // The textarea now contains the serialized flag.
    const configTextarea = screen.getByLabelText('Configuration (JSON)') as HTMLTextAreaElement;
    expect(configTextarea.value).toContain('"autoPrintOnComplete": true');
  });
});
