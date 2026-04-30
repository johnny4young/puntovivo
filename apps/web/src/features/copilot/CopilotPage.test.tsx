import { act, render, screen } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import type { ChatTransport, UIMessage } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';
import { CopilotPage } from './CopilotPage';
import type { CopilotChatResult } from './copilotTransport';

const mocks = vi.hoisted(() => ({
  useChatMock: vi.fn(),
  mutateMock: vi.fn(),
}));

vi.mock('@ai-sdk/react', () => ({
  useChat: (args: unknown) => mocks.useChatMock(args),
}));

vi.mock('@/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks')>('@/hooks');
  return {
    ...actual,
    useTenantSettings: () => ({
      formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
    }),
  };
});

vi.mock('@/lib/trpc', () => ({
  vanillaClient: {
    ai: {
      copilot: {
        chat: {
          mutate: mocks.mutateMock,
        },
      },
    },
  },
}));

function baseChatState(overrides?: Record<string, unknown>) {
  return {
    messages: [],
    sendMessage: vi.fn().mockResolvedValue(undefined),
    status: 'ready',
    error: undefined,
    ...overrides,
  };
}

const result: CopilotChatResult = {
  answer: 'You sold $120.00 yesterday in Sur.',
  sql: "SELECT site_name, SUM(total) AS revenue FROM sales_summary WHERE sale_date = date('now', '-1 day') GROUP BY site_name",
  columns: ['site_name', 'revenue'],
  rows: [{ site_name: 'Sur', revenue: 120 }],
  rowCount: 1,
  truncated: false,
  chart: { type: 'bar', labelKey: 'site_name', valueKey: 'revenue' },
  window: {
    from: '2026-04-28T00:00:00.000Z',
    to: '2026-04-29T00:00:00.000Z',
    defaulted: false,
  },
  costUsd: 0.00042,
  durationMs: 100,
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  auditLogId: 'audit-1',
};

describe('CopilotPage', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    vi.clearAllMocks();
    mocks.mutateMock.mockResolvedValue(result);
    mocks.useChatMock.mockReturnValue(baseChatState());
  });

  it('renders the empty state and submits a question through useChat', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    mocks.useChatMock.mockReturnValue(baseChatState({ sendMessage }));
    render(<CopilotPage />);

    expect(screen.getByText('No analysis yet')).toBeInTheDocument();

    await userEvent.type(
      screen.getByLabelText('Analytics question'),
      'How much did I sell yesterday in Sur?'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send question' }));

    expect(sendMessage).toHaveBeenCalledWith({
      text: 'How much did I sell yesterday in Sur?',
    });
  });

  it('localizes server errors from the co-pilot call', () => {
    mocks.useChatMock.mockReturnValue(
      baseChatState({
        status: 'error',
        error: { data: { errorCode: 'AI_DISABLED' } },
      })
    );

    render(<CopilotPage />);

    expect(
      screen.getByText(/AI features are turned off for this organization/i)
    ).toBeInTheDocument();
  });

  it('renders SQL, rows, and chart metadata returned by the transport', async () => {
    let capturedTransport: ChatTransport<UIMessage> | null = null;
    mocks.useChatMock.mockImplementation((args: { transport: ChatTransport<UIMessage> }) => {
      capturedTransport = args.transport;
      return baseChatState({
        messages: [
          {
            id: 'm1',
            role: 'user',
            parts: [{ type: 'text', text: 'How much did I sell yesterday in Sur?' }],
          },
        ],
      });
    });

    render(<CopilotPage />);

    await act(async () => {
      await capturedTransport?.sendMessages({
        trigger: 'submit-message',
        chatId: 'chat-1',
        messageId: undefined,
        messages: [
          {
            id: 'm1',
            role: 'user',
            parts: [{ type: 'text', text: 'How much did I sell yesterday in Sur?' }],
          } as UIMessage,
        ],
        abortSignal: undefined,
      });
    });

    expect(screen.getAllByText('Sur').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$120.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Executed SQL')).toBeInTheDocument();
    expect(screen.getByText(/claude-haiku-4-5/)).toBeInTheDocument();
  });
});
