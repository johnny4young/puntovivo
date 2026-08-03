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
  ShieldCheck,
  Sparkles,
  Table2,
} from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { useTenantSettings } from '@/hooks';
import { cn } from '@/lib/utils';
import { createCopilotTransport, type CopilotChatResult } from './copilotTransport';

type CopilotRow = CopilotChatResult['rows'][number];
type CopilotResponseMode = CopilotChatResult['responseMode'];

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
    return isCurrencyLike(key) ? formatCurrency(value) : new Intl.NumberFormat().format(value);
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
  return columns.map(column => `${column}:${String(row[column] ?? '')}`).join('|');
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

function ResponseModePanel({
  responseMode,
  isAdmin,
  isLoading,
  isUpdating,
  errorMessage,
  onChange,
}: {
  responseMode: CopilotResponseMode;
  isAdmin: boolean;
  isLoading: boolean;
  isUpdating: boolean;
  errorMessage: string | null;
  onChange: (responseMode: CopilotResponseMode) => void;
}) {
  const { t } = useTranslation('copilot');
  const verified = responseMode === 'verified';
  const modeResolved = !isLoading;

  return (
    <section
      className={cn(
        'card overflow-hidden border-l-4 p-5',
        modeResolved && verified ? 'border-l-primary-600' : 'border-l-secondary-400'
      )}
      aria-busy={isLoading || isUpdating}
      data-testid="copilot-response-mode"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div
            className={cn(
              'glyph-tile h-11 w-11 shrink-0',
              modeResolved && verified
                ? 'glyph-tile-primary'
                : 'bg-secondary-100 text-secondary-700 dark:bg-secondary-800 dark:text-secondary-200'
            )}
          >
            {modeResolved && verified ? (
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            ) : (
              <MessageSquareText className="h-5 w-5" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <p className="page-kicker">{t('mode.kicker')}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl text-secondary-950">
                {t(
                  isLoading
                    ? 'mode.loadingTitle'
                    : verified
                      ? 'mode.verifiedTitle'
                      : 'mode.guidedTitle'
                )}
              </h2>
              {modeResolved && (
                <Badge variant={verified ? 'primary' : 'neutral'} marker="dot">
                  {t('mode.active')}
                </Badge>
              )}
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-600">
              {t(
                isLoading
                  ? 'mode.loadingDescription'
                  : verified
                    ? 'mode.verifiedDescription'
                    : 'mode.guidedDescription'
              )}
            </p>
            {modeResolved && verified && (
              <p className="mt-2 max-w-3xl text-xs leading-5 text-secondary-500">
                {t('mode.verifiedCaveat')}
              </p>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="grid w-full gap-2 sm:w-auto sm:min-w-[18rem] sm:grid-cols-2">
            <Button
              variant={modeResolved && !verified ? 'primary' : 'outline'}
              size="compact"
              disabled={isLoading || isUpdating || !verified}
              aria-pressed={modeResolved && !verified}
              onClick={() => onChange('guided')}
            >
              {t('mode.guidedTitle')}
            </Button>
            <Button
              variant={modeResolved && verified ? 'primary' : 'outline'}
              size="compact"
              disabled={isLoading || isUpdating || verified}
              aria-pressed={modeResolved && verified}
              onClick={() => onChange('verified')}
            >
              {t('mode.verifiedTitle')}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-line/70 pt-3 text-xs leading-5 text-secondary-500">
        {isLoading
          ? t('mode.loading')
          : isUpdating
            ? t('mode.updating')
            : t(isAdmin ? 'mode.adminHint' : 'mode.managedHint')}
      </div>
      {errorMessage && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-danger-500/25 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}
    </section>
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
        <h2 className="text-sm font-semibold text-secondary-950">{chart.valueKey}</h2>
      </div>
      <div className="space-y-3">
        {values.slice(0, 12).map(point => {
          const width = `${Math.max((point.value / max) * 100, 4)}%`;
          return (
            <div key={point.label} className="grid gap-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-medium text-secondary-700">{point.label}</span>
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
    return <div className="card p-5 text-sm text-secondary-600">{t('results.noRows')}</div>;
  }
  const rowKeys = buildRowKeys(result.rows, result.columns);

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line/70 px-5 py-4">
        <Table2 className="h-4 w-4 text-primary-700" />
        <h2 className="text-sm font-semibold text-secondary-950">{t('results.tableTitle')}</h2>
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
                  <td key={column} className="whitespace-nowrap px-4 py-3 text-secondary-700">
                    {/* Under `noUncheckedIndexedAccess`, `row[column]` is
                        `CopilotCellValue | undefined`; the server contract
                        guarantees a value for every declared column but the
                        `?? null` keeps `formatValue` honest if a row ever
                        drops a key. */}
                    {formatValue(column, row[column] ?? null, formatCurrency)}
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
  const { t } = useTranslation(['copilot', 'aiShared']);

  if (!result) {
    return (
      <section className="card p-6">
        <div className="flex h-56 flex-col items-center justify-center gap-3 text-center">
          <div className="glyph-tile glyph-tile-primary h-12 w-12">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="page-kicker">
              {t('copilot:results.emptyKicker', { defaultValue: 'Resultado' })}
            </p>
            <h2 className="mt-1 font-display text-lg text-secondary-950">
              {t('states.emptyTitle')}
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-secondary-600">
              {t('states.emptyDescription')}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {result.responseMode === 'verified' && (
        <div className="flex items-center gap-2 rounded-2xl border border-primary-500/25 bg-primary-50 px-4 py-3 text-sm font-medium text-primary-800">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('copilot:mode.resultVerified')}
        </div>
      )}
      <ResultChart result={result} formatCurrency={formatCurrency} />
      <ResultTable result={result} formatCurrency={formatCurrency} />
      {result.sql && (
        <section className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line/70 px-5 py-3">
            <Database className="h-4 w-4 text-primary-700" aria-hidden="true" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary-700">
              {t('results.sqlDisclosure')}
            </p>
          </div>
          <pre className="overflow-x-auto bg-secondary-950 px-5 py-4 text-xs leading-6 text-secondary-50">
            <code>{result.sql}</code>
          </pre>
        </section>
      )}
      <section className="card relative overflow-hidden p-4">
        <div className="grid gap-3 text-[11px] uppercase tracking-[0.18em] text-secondary-500 sm:grid-cols-[1fr_auto_auto_auto]">
          <div>
            <p className="text-[9.5px] font-semibold tracking-[0.22em] text-secondary-500">
              {t('results.metaProviderLabel', { defaultValue: 'Proveedor' })}
            </p>
            <p className="mt-1 truncate font-mono text-[12px] tracking-normal text-secondary-900 normal-case">
              {result.provider} · {result.model}
            </p>
          </div>
          <div>
            <p className="text-[9.5px] font-semibold tracking-[0.22em] text-secondary-500">
              {t('results.metaCostLabel', { defaultValue: 'Costo' })}
            </p>
            <p className="mt-1 font-mono text-[12px] tabular-nums tracking-normal text-secondary-900 normal-case">
              {formatUsd(result.costUsd)}
            </p>
          </div>
          <div>
            <p className="text-[9.5px] font-semibold tracking-[0.22em] text-secondary-500">
              {t('results.metaRowsLabel', { defaultValue: 'Filas' })}
            </p>
            <p className="mt-1 font-mono text-[12px] tabular-nums tracking-normal text-secondary-900 normal-case">
              {result.rowCount}
            </p>
          </div>
          {result.truncated && (
            <div>
              <p className="text-[9.5px] font-semibold tracking-[0.22em] text-warning-700">
                {t('results.metaTruncatedLabel', { defaultValue: 'Truncado' })}
              </p>
              <p className="mt-1 text-[12px] tracking-normal text-warning-700 normal-case">
                {t('results.truncated')}
              </p>
            </div>
          )}
        </div>
        <p className="mt-3 border-t border-line/70 pt-3 text-[11px] leading-5 text-secondary-500">
          {t('aiShared:disclaimer.copilot')}
        </p>
      </section>
    </div>
  );
}

export function CopilotPage() {
  const { t } = useTranslation(['copilot', 'errors']);
  const { user } = useAuth();
  const { formatCurrency } = useTenantSettings();
  const utils = trpc.useUtils();
  const settingsQuery = trpc.ai.settings.get.useQuery();
  const [input, setInput] = useState('');
  const [latestResult, setLatestResult] = useState<CopilotChatResult | null>(null);
  const responseMode = settingsQuery.data?.features?.copilot.responseMode ?? 'guided';
  const responseModeMutation = trpc.ai.copilot.setResponseMode.useMutation({
    onSuccess: async () => {
      setLatestResult(null);
      await utils.ai.settings.get.invalidate();
    },
  });
  const transport = useMemo(() => createCopilotTransport({ onResult: setLatestResult }), []);
  const { messages, sendMessage, status, error } = useChat({ transport });
  const isBusy = status === 'submitted' || status === 'streaming';
  const errorMessage = error ? translateServerError(error, t, t('errors:server.unknown')) : null;
  const responseModeError = responseModeMutation.error
    ? translateServerError(responseModeMutation.error, t, t('copilot:mode.updateError'))
    : settingsQuery.error
      ? translateServerError(settingsQuery.error, t, t('copilot:mode.updateError'))
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
      <header className="card relative overflow-hidden p-6 sm:p-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 88% 0%, color-mix(in oklch, var(--primary) 10%, transparent), transparent 55%)',
          }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <p className="page-kicker">
              {t('copilot:page.kicker', { defaultValue: 'Inteligencia · Co-pilot' })}
            </p>
            <h1 className="mt-1 font-display text-3xl tracking-[-0.02em] text-secondary-950">
              {t('copilot:page.title')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-secondary-600">
              {t('copilot:page.subtitle', {
                defaultValue:
                  'Pregúntale a tus datos. El SQL siempre se muestra abajo del resultado, auditado y descargable.',
              })}
            </p>
          </div>
        </div>
      </header>

      <ResponseModePanel
        responseMode={responseMode}
        isAdmin={user?.role === 'admin'}
        isLoading={settingsQuery.isLoading}
        isUpdating={responseModeMutation.isPending}
        errorMessage={responseModeError}
        onChange={nextMode => responseModeMutation.mutate({ responseMode: nextMode })}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="card flex min-h-[35rem] flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line/70 px-5 py-4">
            <MessageSquareText className="h-4 w-4 text-primary-700" />
            <h2 className="text-sm font-semibold text-secondary-950">{t('copilot:chat.title')}</h2>
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
