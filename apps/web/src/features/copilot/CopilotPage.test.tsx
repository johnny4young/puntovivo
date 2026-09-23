import { act, render, screen } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';
import { CopilotPage } from './CopilotPage';
import type { CopilotChatResult } from './copilotTransport';

const mocks = vi.hoisted(() => ({
  useChatMock: vi.fn(),
  mutateMock: vi.fn(),
  settingsQueryMock: vi.fn(),
  setModeMutateMock: vi.fn(),
  setModeUseMutationMock: vi.fn(),
  invalidateSettingsMock: vi.fn(),
  useAuthMock: vi.fn(),
  useTenantMock: vi.fn(),
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

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => mocks.useAuthMock(),
}));

vi.mock('@/features/tenant/TenantContext', () => ({
  useTenant: () => mocks.useTenantMock(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      ai: { settings: { get: { invalidate: mocks.invalidateSettingsMock } } },
    }),
    ai: {
      settings: { get: { useQuery: mocks.settingsQueryMock } },
      copilot: { setResponseMode: { useMutation: mocks.setModeUseMutationMock } },
    },
  },
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
    setMessages: vi.fn(),
    clearError: vi.fn(),
    stop: vi.fn(),
    status: 'ready',
    error: undefined,
    ...overrides,
  };
}

const result: CopilotChatResult = {
  answer: '',
  queries: [
    {
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
    },
  ],
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
  responseMode: 'guided',
};

describe('CopilotPage', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    vi.clearAllMocks();
    mocks.mutateMock.mockResolvedValue(result);
    mocks.useChatMock.mockReturnValue(baseChatState());
    mocks.useAuthMock.mockReturnValue({ user: { role: 'admin' } });
    mocks.useTenantMock.mockReturnValue({
      currentSite: { id: 'site-north', name: 'North' },
      isLoadingSites: false,
    });
    mocks.settingsQueryMock.mockReturnValue({
      data: { features: { copilot: { enabled: true, responseMode: 'guided' } } },
      isLoading: false,
      error: null,
    });
    mocks.setModeUseMutationMock.mockReturnValue({
      mutate: mocks.setModeMutateMock,
      isPending: false,
      error: null,
    });
    mocks.invalidateSettingsMock.mockResolvedValue(undefined);
  });

  it('renders the empty state and submits a question through useChat', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    mocks.useChatMock.mockReturnValue(baseChatState({ sendMessage }));
    render(<CopilotPage />);

    expect(screen.getByText('No analysis yet')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Guided query review' })).toBeInTheDocument();

    await userEvent.type(
      screen.getByLabelText('Analytics question'),
      'How much did I sell yesterday in Sur?'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send question' }));

    expect(sendMessage).toHaveBeenCalledWith({
      text: 'How much did I sell yesterday in Sur?',
    });
    expect(screen.getByLabelText('Data scope')).toHaveValue('all');
  });

  it('sends the selected call-time site scope and clears prior conversation on change', async () => {
    let capturedTransport: ChatTransport<UIMessage> | null = null;
    const setMessages = vi.fn();
    const clearError = vi.fn();
    mocks.useChatMock.mockImplementation((args: { transport: ChatTransport<UIMessage> }) => {
      capturedTransport = args.transport;
      return baseChatState({ setMessages, clearError });
    });
    const { rerender } = render(<CopilotPage />);
    const request = {
      trigger: 'submit-message' as const,
      chatId: 'scope-test',
      messageId: undefined,
      messages: [
        {
          id: 'scope-user',
          role: 'user',
          parts: [{ type: 'text', text: 'Show sales' }],
        } as UIMessage,
      ],
      abortSignal: undefined,
    };

    await act(async () => {
      await capturedTransport?.sendMessages(request);
    });
    expect(mocks.mutateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ context: { siteId: null } })
    );

    await userEvent.selectOptions(screen.getByLabelText('Data scope'), 'current');
    expect(setMessages).toHaveBeenCalledWith([]);
    expect(clearError).toHaveBeenCalledOnce();
    await act(async () => {
      await capturedTransport?.sendMessages(request);
    });
    expect(mocks.mutateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ context: { siteId: 'site-north' } })
    );

    mocks.useTenantMock.mockReturnValue({
      currentSite: { id: 'site-south', name: 'South' },
      isLoadingSites: false,
    });
    rerender(<CopilotPage />);
    await act(async () => {
      await capturedTransport?.sendMessages(request);
    });
    expect(mocks.mutateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ context: { siteId: 'site-south' } })
    );
    expect(setMessages).toHaveBeenCalledTimes(2);
    expect(clearError).toHaveBeenCalledTimes(2);
  });

  it('blocks current-site questions while the selected site is no longer confirmed', async () => {
    const { rerender } = render(<CopilotPage />);
    await userEvent.selectOptions(screen.getByLabelText('Data scope'), 'current');
    mocks.useTenantMock.mockReturnValue({ currentSite: null, isLoadingSites: true });
    rerender(<CopilotPage />);
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled();
    expect(screen.getByLabelText('Analytics question')).toBeDisabled();
    expect(screen.getByText('Wait until the current site is confirmed.')).toBeInTheDocument();
  });

  it('discards a late result after switching site ownership', async () => {
    let capturedTransport: ChatTransport<UIMessage> | null = null;
    const stop = vi.fn();
    mocks.useChatMock.mockImplementation((args: { transport: ChatTransport<UIMessage> }) => {
      capturedTransport = args.transport;
      return baseChatState({ stop });
    });
    let resolveRequest: (value: CopilotChatResult) => void = () => undefined;
    mocks.mutateMock.mockReturnValue(
      new Promise<CopilotChatResult>(resolve => {
        resolveRequest = resolve;
      })
    );
    const { rerender } = render(<CopilotPage />);
    const transport = capturedTransport as ChatTransport<UIMessage> | null;
    const pending = transport?.sendMessages({
      trigger: 'submit-message',
      chatId: 'late-result',
      messageId: undefined,
      messages: [
        {
          id: 'late-user',
          role: 'user',
          parts: [{ type: 'text', text: 'Show sales' }],
        } as UIMessage,
      ],
      abortSignal: undefined,
    });
    mocks.useTenantMock.mockReturnValue({
      currentSite: { id: 'site-south', name: 'South' },
      isLoadingSites: false,
    });
    rerender(<CopilotPage />);
    expect(stop).toHaveBeenCalledOnce();
    await act(async () => {
      resolveRequest(result);
      await pending;
    });
    expect(screen.queryByText('Executed SQL')).not.toBeInTheDocument();
  });

  it('lets an admin switch the tenant to results-only mode', async () => {
    render(<CopilotPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Results only' }));

    expect(mocks.setModeMutateMock).toHaveBeenCalledWith({ responseMode: 'verified' });
  });

  it('does not claim a response mode is active while settings are loading', () => {
    mocks.settingsQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    render(<CopilotPage />);

    expect(
      screen.getByRole('heading', { name: 'Loading the active response mode' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Active now')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guided query review' })).not.toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Results only' })).not.toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('shows managers the active contract without response-mode controls', () => {
    mocks.useAuthMock.mockReturnValue({ user: { role: 'manager' } });
    mocks.settingsQueryMock.mockReturnValue({
      data: { features: { copilot: { enabled: true, responseMode: 'verified' } } },
      isLoading: false,
      error: null,
    });

    render(<CopilotPage />);

    expect(screen.getByText('Results only')).toBeInTheDocument();
    expect(
      screen.getByText('An administrator sets this response style for the whole business.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Results only' })).not.toBeInTheDocument();
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

  it('renders verified rows without emitting a generated text chunk', async () => {
    mocks.mutateMock.mockResolvedValue({ ...result, answer: '', responseMode: 'verified' });
    let capturedTransport: ChatTransport<UIMessage> | null = null;
    mocks.useChatMock.mockImplementation((args: { transport: ChatTransport<UIMessage> }) => {
      capturedTransport = args.transport;
      return baseChatState();
    });

    render(<CopilotPage />);

    let stream: ReadableStream<UIMessageChunk> | null = null;
    await act(async () => {
      stream =
        (await capturedTransport?.sendMessages({
          trigger: 'submit-message',
          chatId: 'chat-verified',
          messageId: undefined,
          messages: [
            {
              id: 'verified-user',
              role: 'user',
              parts: [{ type: 'text', text: 'Show sales yesterday' }],
            } as UIMessage,
          ],
          abortSignal: undefined,
        })) ?? null;
    });
    const chunks: Array<{ type: string }> = [];
    const readableStream = stream as ReadableStream<UIMessageChunk> | null;
    if (readableStream) {
      const reader = readableStream.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(next.value);
      }
    }

    expect(chunks.some(chunk => chunk.type === 'text-delta')).toBe(false);
    expect(
      screen.getByText('Verified-results response: no generated narrative was added.')
    ).toBeInTheDocument();
    expect(screen.getByText('Executed SQL')).toBeInTheDocument();
  });

  it('shows deterministic guided query guidance without a model text chunk', async () => {
    mocks.mutateMock.mockResolvedValue({ ...result, answer: '' });
    let capturedTransport: ChatTransport<UIMessage> | null = null;
    mocks.useChatMock.mockImplementation((args: { transport: ChatTransport<UIMessage> }) => {
      capturedTransport = args.transport;
      return baseChatState();
    });

    render(<CopilotPage />);
    let stream: ReadableStream<UIMessageChunk> | null = null;
    await act(async () => {
      stream =
        (await capturedTransport?.sendMessages({
          trigger: 'submit-message',
          chatId: 'chat-evidence',
          messageId: undefined,
          messages: [
            {
              id: 'evidence-user',
              role: 'user',
              parts: [{ type: 'text', text: 'How many sales?' }],
            } as UIMessage,
          ],
          abortSignal: undefined,
        })) ?? null;
    });
    const chunks: UIMessageChunk[] = [];
    const readableStream = stream as ReadableStream<UIMessageChunk> | null;
    if (readableStream) {
      const reader = readableStream.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(next.value);
      }
    }
    expect(chunks.some(chunk => chunk.type === 'text-delta')).toBe(false);
    expect(screen.getByText(/Review the executed SQL and displayed rows/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Results for your latest question/ })).toHaveAttribute(
      'href',
      '#copilot-results'
    );
    expect(screen.getByText('Executed SQL')).toBeInTheDocument();
  });

  it('shows every SQL result when a guided request used multiple queries', async () => {
    mocks.mutateMock.mockResolvedValue({
      ...result,
      queries: [
        result.queries[0]!,
        {
          ...result.queries[0]!,
          sql: 'SELECT COUNT(*) AS sale_count FROM sales_summary',
          columns: ['sale_count'],
          rows: [{ sale_count: 20 }],
          chart: null,
        },
      ],
    });
    let capturedTransport: ChatTransport<UIMessage> | null = null;
    mocks.useChatMock.mockImplementation((args: { transport: ChatTransport<UIMessage> }) => {
      capturedTransport = args.transport;
      return baseChatState();
    });
    render(<CopilotPage />);
    await act(async () => {
      await capturedTransport?.sendMessages({
        trigger: 'submit-message',
        chatId: 'chat-multi',
        messageId: undefined,
        messages: [
          {
            id: 'multi-user',
            role: 'user',
            parts: [{ type: 'text', text: 'Compare sites' }],
          } as UIMessage,
        ],
        abortSignal: undefined,
      });
    });
    expect(screen.getByRole('heading', { name: 'Query 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Query 2' })).toBeInTheDocument();
    expect(screen.getAllByText('Executed SQL')).toHaveLength(2);
    expect(
      screen.getByText('SELECT COUNT(*) AS sale_count FROM sales_summary')
    ).toBeInTheDocument();
  });
});
