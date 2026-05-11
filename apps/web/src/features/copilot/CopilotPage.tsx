import { FormEvent, useMemo, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  BarChart3,
  Database,
  MessageSquareText,
  SendHorizontal,
  Sparkles,
  Table2,
} from 'lucide-react';
import { translateServerError } from '@/lib/translateServerError';
import { useTenantSettings } from '@/hooks';
import { cn } from '@/lib/utils';
import {
  createCopilotTransport,
  type CopilotChatResult,
} from './copilotTransport';

type CopilotRow = CopilotChatResult['rows'][number];

function messageText(message: UIMessage): string {
  return message.parts
    .map(part => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim();
}

function isCurrencyLike(key: string): boolean {
  return /(total|revenue|amount|cost|price|tax|discount|venta|ventas)/i.test(key);
}

function formatValue(
  key: string,
  value: string | number | null,
  formatCurrency: (amount: number) => string
): string {
  if (value === null) {
    return '-';
  }
  if (typeof value === 'number') {
    return isCurrencyLike(key)
      ? formatCurrency(value)
      : new Intl.NumberFormat().format(value);
  }
  return value;
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(amount);
}

function buildRowIdentity(row: CopilotRow, columns: string[]): string {
  return columns
    .map(column => `${column}:${String(row[column] ?? '')}`)
    .join('|');
}

function buildRowKeys(rows: CopilotRow[], columns: string[]): string[] {
  const counts = new Map<string, number>();
  return rows.map(row => {
    const identity = buildRowIdentity(row, columns);
    const count = counts.get(identity) ?? 0;
    counts.set(identity, count + 1);
    return count === 0 ? identity : `${identity}#${count + 1}`;
  });
}

function ChatMessage({ message }: { message: UIMessage }) {
  const text = messageText(message);
  if (!text) {
    return null;
  }

  const isUser = message.role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'border border-line/70 bg-surface text-secondary-800'
        )}
      >
        {text}
      </div>
    </div>
  );
}

function ResultChart({
  result,
  formatCurrency,
}: {
  result: CopilotChatResult;
  formatCurrency: (amount: number) => string;
}) {
  const chart = result.chart;
  if (!chart) {
    return null;
  }

  const values = result.rows
    .map(row => {
      const value = row[chart.valueKey];
      return {
        label: String(row[chart.labelKey] ?? ''),
        value: typeof value === 'number' ? value : 0,
      };
    })
    .filter(point => point.label.length > 0);

  const max = Math.max(...values.map(point => point.value), 0);
  if (values.length === 0 || max <= 0) {
    return null;
  }

  return (
    <section className="card p-5">
      <div className="mb-4 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary-700" />
        <h2 className="text-sm font-semibold text-secondary-950">
          {chart.valueKey}
        </h2>
      </div>
      <div className="space-y-3">
        {values.slice(0, 12).map(point => {
          const width = `${Math.max((point.value / max) * 100, 4)}%`;
          return (
            <div key={point.label} className="grid gap-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-medium text-secondary-700">
                  {point.label}
                </span>
                <span className="shrink-0 font-semibold text-secondary-950">
                  {formatValue(chart.valueKey, point.value, formatCurrency)}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-secondary-100">
                <div className="h-full rounded-full bg-primary" style={{ width }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ResultTable({
  result,
  formatCurrency,
}: {
  result: CopilotChatResult;
  formatCurrency: (amount: number) => string;
}) {
  const { t } = useTranslation('copilot');
  if (result.columns.length === 0) {
    return (
      <div className="card p-5 text-sm text-secondary-600">
        {t('results.noRows')}
      </div>
    );
  }
  const rowKeys = buildRowKeys(result.rows, result.columns);

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line/70 px-5 py-4">
        <Table2 className="h-4 w-4 text-primary-700" />
        <h2 className="text-sm font-semibold text-secondary-950">
          {t('results.tableTitle')}
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-line/70 text-sm">
          <thead className="bg-secondary-50">
            <tr>
              {result.columns.map(column => (
                <th
                  key={column}
                  scope="col"
                  className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-secondary-500"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60 bg-surface">
            {result.rows.map((row: CopilotRow, index) => (
              <tr key={rowKeys[index]}>
                {result.columns.map(column => (
                  <td
                    key={column}
                    className="whitespace-nowrap px-4 py-3 text-secondary-700"
                  >
                    {formatValue(column, row[column], formatCurrency)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.truncated && (
        <div className="border-t border-line/70 px-5 py-3 text-xs text-secondary-500">
          {t('results.truncated')}
        </div>
      )}
    </section>
  );
}

function ResultsPanel({
  result,
  formatCurrency,
}: {
  result: CopilotChatResult | null;
  formatCurrency: (amount: number) => string;
}) {
  const { t } = useTranslation('copilot');

  if (!result) {
    return (
      <section className="card p-6">
        <div className="flex h-56 flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-700">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-secondary-950">
              {t('states.emptyTitle')}
            </h2>
            <p className="mt-1 max-w-sm text-sm leading-6 text-secondary-600">
              {t('states.emptyDescription')}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <ResultChart result={result} formatCurrency={formatCurrency} />
      <ResultTable result={result} formatCurrency={formatCurrency} />
      {result.sql && (
        <details className="card group overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-semibold text-secondary-950">
            <Database className="h-4 w-4 text-primary-700" />
            {t('results.sqlDisclosure')}
          </summary>
          <pre className="overflow-x-auto border-t border-line/70 bg-secondary-950 px-5 py-4 text-xs leading-6 text-secondary-50">
            <code>{result.sql}</code>
          </pre>
        </details>
      )}
      <div className="card p-4 text-xs text-secondary-500">
        {t('results.meta', {
          provider: result.provider,
          model: result.model,
          cost: formatUsd(result.costUsd),
          rows: result.rowCount,
        })}
      </div>
    </div>
  );
}

export function CopilotPage() {
  const { t } = useTranslation(['copilot', 'errors']);
  const { formatCurrency } = useTenantSettings();
  const [input, setInput] = useState('');
  const [latestResult, setLatestResult] = useState<CopilotChatResult | null>(null);
  const transport = useMemo(
    () => createCopilotTransport({ onResult: setLatestResult }),
    []
  );
  const { messages, sendMessage, status, error } = useChat({ transport });
  const isBusy = status === 'submitted' || status === 'streaming';
  const errorMessage = error
    ? translateServerError(error, t, t('errors:server.unknown'))
    : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isBusy) {
      return;
    }
    setInput('');
    setLatestResult(null);
    void sendMessage({ text });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-secondary-950">
          {t('copilot:page.title')}
        </h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)]">
        <section className="card flex min-h-[35rem] flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line/70 px-5 py-4">
            <MessageSquareText className="h-4 w-4 text-primary-700" />
            <h2 className="text-sm font-semibold text-secondary-950">
              {t('copilot:chat.title')}
            </h2>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
            {messages.length === 0 ? (
              <div className="flex h-full min-h-[18rem] items-center justify-center text-center">
                <p className="max-w-sm text-sm leading-6 text-secondary-600">
                  {t('copilot:chat.starter')}
                </p>
              </div>
            ) : (
              messages.map(message => <ChatMessage key={message.id} message={message} />)
            )}
            {isBusy && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3 text-sm text-secondary-600">
                  {t('copilot:states.loading')}
                </div>
              </div>
            )}
          </div>

          {errorMessage && (
            <div className="mx-5 mb-3 flex items-start gap-2 rounded-2xl border border-danger-500/25 bg-danger-50 px-4 py-3 text-sm text-danger-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form className="border-t border-line/70 p-4" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="copilot-prompt">
              {t('copilot:composer.label')}
            </label>
            <div className="flex items-end gap-3">
              <textarea
                id="copilot-prompt"
                className="input min-h-[4.5rem] resize-none"
                value={input}
                onChange={event => setInput(event.target.value)}
                placeholder={t('copilot:composer.placeholder')}
                disabled={isBusy}
              />
              <button
                type="submit"
                className="btn-primary btn-icon h-12 w-12 shrink-0"
                disabled={!input.trim() || isBusy}
                aria-label={t('copilot:composer.send')}
                title={t('copilot:composer.send')}
              >
                <SendHorizontal className="h-5 w-5" />
              </button>
            </div>
          </form>
        </section>

        <ResultsPanel result={latestResult} formatCurrency={formatCurrency} />
      </div>
    </div>
  );
}
