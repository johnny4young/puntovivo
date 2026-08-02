import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';

const createSubscription = vi.fn();
const acknowledgeAlert = vi.fn();
const retryDelivery = vi.fn();
let createOnSuccess: ((result: { signingSecret: string }) => Promise<void> | void) | undefined;
let overviewLoading = false;
let overviewError = false;

let overview = {
  provisioned: false,
  retention: { attemptDays: 90, historyDays: 365 },
  subscriptions: [] as Array<{
    id: string;
    name: string;
    enabled: boolean;
    revokedAt: string | null;
  }>,
  alerts: [] as Array<{
    id: string;
    area: 'sync' | 'fiscal' | 'device' | 'payments';
    severity: 'warning' | 'danger';
    status: 'open' | 'acknowledged' | 'resolved';
    count: number;
  }>,
  deliveries: [] as Array<{
    id: string;
    alertId: string;
    subscriptionId: string;
    subscriptionName: string;
    transition: 'opened' | 'escalated' | 'acknowledged' | 'resolved';
    status: 'queued' | 'submitting' | 'delivered' | 'retrying' | 'dead_letter';
    attempts: number;
    responseStatus: number | null;
    lastErrorCode: string | null;
    deliveredAt: string | null;
    updatedAt: string;
  }>,
  attempts: [],
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      operations: {
        alertsOverview: { invalidate: vi.fn().mockResolvedValue(undefined) },
        needsAttention: { invalidate: vi.fn().mockResolvedValue(undefined) },
      },
    }),
    operations: {
      alertsOverview: {
        useQuery: () => ({
          data: overview,
          isLoading: overviewLoading,
          isError: overviewError,
          refetch: vi.fn(),
        }),
      },
      acknowledgeAlert: {
        useMutation: () => ({ isPending: false, mutate: acknowledgeAlert }),
      },
      retryAlertDelivery: {
        useMutation: () => ({ isPending: false, mutate: retryDelivery }),
      },
    },
    events: {
      createSubscription: {
        useMutation: (options: {
          onSuccess?: (result: { signingSecret: string }) => Promise<void> | void;
        }) => {
          createOnSuccess = options.onSuccess;
          return { isPending: false, isError: false, mutate: createSubscription };
        },
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

import { ExternalAlertsPanel } from './ExternalAlertsPanel';

describe('ExternalAlertsPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    await i18n.loadNamespaces('operationalAlerts');
    createSubscription.mockClear();
    acknowledgeAlert.mockClear();
    retryDelivery.mockClear();
    createOnSuccess = undefined;
    overviewLoading = false;
    overviewError = false;
    overview = {
      provisioned: false,
      retention: { attemptDays: 90, historyDays: 365 },
      subscriptions: [],
      alerts: [],
      deliveries: [],
      attempts: [],
    };
  });

  it('states the honest boundary and provisions all operational transitions', () => {
    render(<ExternalAlertsPanel />);

    expect(screen.getByText(/not a staffed monitoring service/i)).toBeInTheDocument();
    expect(screen.getByText(/Not configured/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Receiver name/i), {
      target: { value: 'Store monitoring' },
    });
    fireEvent.change(screen.getByLabelText(/HTTPS destination/i), {
      target: { value: 'https://alerts.example.test/puntovivo' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Connect receiver/i }));

    expect(createSubscription).toHaveBeenCalledWith({
      name: 'Store monitoring',
      destinationUrl: 'https://alerts.example.test/puntovivo',
      eventTypes: [
        'operational_alert.opened',
        'operational_alert.escalated',
        'operational_alert.acknowledged',
        'operational_alert.resolved',
      ],
    });
  });

  it('keeps acknowledgement separate from delivery recovery', () => {
    overview = {
      ...overview,
      provisioned: true,
      subscriptions: [{ id: 'sub-1', name: 'Monitoring', enabled: true, revokedAt: null }],
      alerts: [{ id: 'alert-1', area: 'payments', severity: 'danger', status: 'open', count: 2 }],
      deliveries: [
        {
          id: 'delivery-1',
          alertId: 'alert-1',
          subscriptionId: 'sub-1',
          subscriptionName: 'Monitoring',
          transition: 'opened',
          status: 'dead_letter',
          attempts: 1,
          responseStatus: 400,
          lastErrorCode: 'OPERATIONAL_ALERT_HTTP_400',
          deliveredAt: null,
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    };
    render(<ExternalAlertsPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Mark as seen/i }));
    fireEvent.click(screen.getByRole('button', { name: /Retry delivery/i }));
    expect(acknowledgeAlert).toHaveBeenCalledWith({ alertId: 'alert-1' });
    expect(retryDelivery).toHaveBeenCalledWith({ deliveryId: 'delivery-1' });
    expect(screen.getByText(/OPERATIONAL_ALERT_HTTP_400/)).toBeInTheDocument();
  });

  it('renders loading and query failure states without claiming delivery readiness', () => {
    overviewLoading = true;
    const { rerender } = render(<ExternalAlertsPanel />);
    expect(screen.getByTestId('external-alerts-loading')).toBeInTheDocument();
    expect(screen.getByText(/Not configured/i)).toBeInTheDocument();

    overviewLoading = false;
    overviewError = true;
    rerender(<ExternalAlertsPanel />);
    expect(
      screen.getAllByText(/external alert status could not be loaded/i).length
    ).toBeGreaterThan(0);
  });

  it('shows the signing secret once and handles denied clipboard access safely', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<ExternalAlertsPanel />);

    await act(async () => {
      await createOnSuccess?.({ signingSecret: 'pvwhsec_test_once' });
    });
    expect(screen.getByText('pvwhsec_test_once')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Copy secret/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('pvwhsec_test_once'));
    expect(screen.getByRole('button', { name: /Copy secret/i })).toBeInTheDocument();
  });

  it('renders the operator boundary in neutral Spanish', async () => {
    await i18n.changeLanguage('es');
    render(<ExternalAlertsPanel />);

    expect(screen.getByText(/No incluye monitoreo atendido por personas/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Conectar receptor/i })).toBeInTheDocument();
  });
});
