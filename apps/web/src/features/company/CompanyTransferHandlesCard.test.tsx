import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act } from '@testing-library/react';
import { render, screen } from '@/test/utils';
import i18n from '@/i18n';

interface HandlesData {
  handles: Array<{ kind: string; value: string }>;
  qrPayload: string | null;
  qrSource: string | null;
}

const mocks = vi.hoisted(() => ({
  data: undefined as HandlesData | undefined,
  isLoading: false,
  mutate: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  toastSuccess: vi.fn(),
  onSuccess: undefined as (() => Promise<void> | void) | undefined,
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      paymentSettings: { transferHandles: { invalidate: mocks.invalidate } },
    }),
    paymentSettings: {
      transferHandles: {
        useQuery: () => ({ data: mocks.data, isLoading: mocks.isLoading }),
      },
      updateTransferHandles: {
        useMutation: (options: { onSuccess?: () => Promise<void> | void }) => {
          mocks.onSuccess = options.onSuccess;
          return { mutate: mocks.mutate, isPending: false };
        },
      },
    },
  },
}));

import { CompanyTransferHandlesCard } from './CompanyTransferHandlesCard';

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.isLoading = false;
  mocks.data = { handles: [], qrPayload: null, qrSource: null };
  await i18n.changeLanguage('en');
});

describe('CompanyTransferHandlesCard', () => {
  it('shows the stored handles and keeps Save off until something changes', () => {
    mocks.data = {
      handles: [{ kind: 'nequi', value: '3000000000' }],
      qrPayload: null,
      qrSource: '3000000000',
    };
    render(<CompanyTransferHandlesCard />);

    expect(screen.getByLabelText('Type of entry 1')).toHaveValue('nequi');
    expect(screen.getByLabelText('Key or number 1')).toHaveValue('3000000000');
    expect(screen.getByTestId('transfer-handles-save')).toBeDisabled();
  });

  it('saves a new key trimmed, with the bank QR content', async () => {
    const user = userEvent.setup();
    render(<CompanyTransferHandlesCard />);

    await user.click(screen.getByTestId('transfer-handle-add'));
    expect(screen.getByTestId('transfer-handles-save')).toBeDisabled();
    await user.type(screen.getByLabelText('Key or number 1'), '  @tiendaprueba ');
    await user.selectOptions(screen.getByLabelText('Type of entry 1'), 'breb');
    await user.type(screen.getByLabelText('Bank QR content (optional)'), '00020101021226');
    await user.click(screen.getByTestId('transfer-handles-save'));

    expect(mocks.mutate).toHaveBeenCalledWith({
      handles: [{ kind: 'breb', value: '@tiendaprueba' }],
      qrPayload: '00020101021226',
    });

    await act(async () => {
      await mocks.onSuccess?.();
    });
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(mocks.toastSuccess).toHaveBeenCalledWith({ title: 'Transfer details saved' });
  });

  it('clears the configuration when the last handle is removed', async () => {
    mocks.data = {
      handles: [{ kind: 'daviplata', value: '3000000002' }],
      qrPayload: null,
      qrSource: '3000000002',
    };
    const user = userEvent.setup();
    render(<CompanyTransferHandlesCard />);

    await user.click(screen.getByRole('button', { name: 'Remove entry 1' }));
    await user.click(screen.getByTestId('transfer-handles-save'));

    expect(mocks.mutate).toHaveBeenCalledWith({ handles: [], qrPayload: null });
  });

  it('stops offering more rows at four handles', async () => {
    mocks.data = {
      handles: ['a', 'b', 'c', 'd'].map(value => ({ kind: 'other', value })),
      qrPayload: null,
      qrSource: 'a',
    };
    render(<CompanyTransferHandlesCard />);

    expect(screen.queryByTestId('transfer-handle-add')).not.toBeInTheDocument();
  });

  it('shows a loading state before the first read', () => {
    mocks.isLoading = true;
    mocks.data = undefined;
    render(<CompanyTransferHandlesCard />);

    expect(screen.getByTestId('transfer-handles-loading')).toBeInTheDocument();
  });
});
