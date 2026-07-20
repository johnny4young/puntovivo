import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatQuantity } from '@puntovivo/shared/unit-math';
import { Modal } from '@/components/form-controls/Modal';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';

export interface TransferReceiveLine {
  itemId: string;
  receivedQuantity: number;
}

export interface TransferReceiveSubmitPayload {
  /**
   * Per-line received quantities. Omitted by the caller when every entry
   * matches the shipped quantity so the wire stays on the legacy one-click
   * shape (`{ transferId }`).
   */
  lines?: TransferReceiveLine[];
  discrepancyNotes?: string;
}

interface InventoryTransferReceiveModalProps {
  isOpen: boolean;
  transferId: string | null;
  isSaving: boolean;
  submitError: string | null;
  onClose: () => void;
  onSubmit: (payload: TransferReceiveSubmitPayload) => void;
}

interface LineState {
  itemId: string;
  productName: string;
  productSku: string;
  shipped: number;
  /**
   * Raw text input value — kept as a string so clearing the field doesn't
   * collapse to `NaN` and so we can display decimals without the browser
   * stripping trailing zeros.
   */
  receivedInput: string;
  tracksSerials: boolean;
  serials: Array<{ id: string; serialNumber: string }>;
}

const NUMBER_FORMATTER_OPTIONS: Intl.NumberFormatOptions = {
  maximumFractionDigits: 4,
};

function parseReceived(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * modal that captures per-line received quantities and an
 * optional discrepancy note when a deferred transfer is received at the
 * destination site.
 *
 * The parent remounts this component via `key={transferId}` whenever a fresh
 * transfer is opened, so internal state (user overrides + note) is reset by
 * React unmounting the tree rather than a `useEffect` that races with the
 * query result.
 */
export function InventoryTransferReceiveModal({
  isOpen,
  transferId,
  isSaving,
  submitError,
  onClose,
  onSubmit,
}: InventoryTransferReceiveModalProps) {
  const { t } = useTranslation('inventory');
  const { t: tErrors } = useTranslation('errors');

  const detailQuery = trpc.transfers.getById.useQuery(
    { id: transferId ?? '' },
    { enabled: isOpen && !!transferId }
  );

  // Keep user edits in a sparse map keyed by `itemId`. Lines default to their
  // shipped quantity at render time; an entry here shadows that default once
  // the user has touched the input.
  const [receivedOverrides, setReceivedOverrides] = useState<Record<string, string>>({});
  const [discrepancyNotes, setDiscrepancyNotes] = useState('');

  const lines: LineState[] = useMemo(() => {
    if (!detailQuery.data) {
      return [];
    }
    return detailQuery.data.items.map(item => ({
      itemId: item.id,
      productName: item.productName,
      productSku: item.productSku,
      shipped: item.quantity,
      receivedInput: receivedOverrides[item.id] ?? String(item.quantity),
      tracksSerials: item.tracksSerials,
      serials: item.serials ?? [],
    }));
  }, [detailQuery.data, receivedOverrides]);

  const lineValidation = useMemo(() => {
    let hasNegative = false;
    let hasOverflow = false;
    let hasAnyVariance = false;
    let hasInvalidNumber = false;
    let totalShortage = 0;
    let shortLineCount = 0;

    for (const line of lines) {
      const received = parseReceived(line.receivedInput);
      if (Number.isNaN(received)) {
        hasInvalidNumber = true;
        continue;
      }
      if (received < 0) {
        hasNegative = true;
      }
      if (received > line.shipped) {
        hasOverflow = true;
      }
      if (received !== line.shipped) {
        hasAnyVariance = true;
      }
      if (received < line.shipped) {
        totalShortage += line.shipped - received;
        shortLineCount += 1;
      }
    }

    return {
      hasNegative,
      hasOverflow,
      hasAnyVariance,
      hasInvalidNumber,
      totalShortage,
      shortLineCount,
    };
  }, [lines]);

  const canSubmit =
    !isSaving &&
    lines.length > 0 &&
    !lineValidation.hasNegative &&
    !lineValidation.hasOverflow &&
    !lineValidation.hasInvalidNumber;

  function handleReceivedChange(itemId: string, nextValue: string) {
    setReceivedOverrides(previous => ({ ...previous, [itemId]: nextValue }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    const trimmedNotes = discrepancyNotes.trim();
    const parsedLines: TransferReceiveLine[] = lines.map(line => ({
      itemId: line.itemId,
      receivedQuantity: parseReceived(line.receivedInput),
    }));

    // Only send the `lines` payload when at least one entry diverged from the
    // shipped quantity — keeps the wire minimal for unchanged receipts and
    // matches the legacy server path that already handles the empty case.
    const payload: TransferReceiveSubmitPayload = {};
    if (lineValidation.hasAnyVariance) {
      payload.lines = parsedLines;
    }
    if (lineValidation.hasAnyVariance && trimmedNotes.length > 0) {
      payload.discrepancyNotes = trimmedNotes;
    }

    onSubmit(payload);
  }

  const detailError = detailQuery.error
    ? translateServerError(detailQuery.error, tErrors, t('transferReceive.error'))
    : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('transferReceive.title')}
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={isSaving}>
            {t('transferReceive.cancel')}
          </button>
          <button
            type="submit"
            form="inventory-transfer-receive-form"
            className="btn-primary"
            disabled={!canSubmit}
          >
            {isSaving ? t('transferReceive.submitting') : t('transferReceive.confirm')}
          </button>
        </div>
      }
    >
      {detailQuery.isLoading && !detailQuery.data && (
        <p className="text-sm text-secondary-500">{t('transferReceive.loading')}</p>
      )}

      {detailError && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-2 text-sm text-danger-700">
          {detailError}
        </div>
      )}

      {detailQuery.data && (
        <form
          id="inventory-transfer-receive-form"
          className="space-y-4"
          onSubmit={handleSubmit}
          noValidate
        >
          <p className="text-sm text-secondary-600">{t('transferReceive.description')}</p>

          <div className="overflow-hidden rounded-xl border border-secondary-200">
            <table className="min-w-full divide-y divide-secondary-200 text-sm">
              <thead className="bg-secondary-50 text-xs uppercase tracking-wide text-secondary-500">
                <tr>
                  <th className="px-3 py-2 text-left">{t('transferReceive.columns.product')}</th>
                  <th className="px-3 py-2 text-left">{t('transferReceive.columns.sku')}</th>
                  <th className="px-3 py-2 text-right">{t('transferReceive.columns.shipped')}</th>
                  <th className="px-3 py-2 text-right">{t('transferReceive.columns.received')}</th>
                  <th className="px-3 py-2 text-right">{t('transferReceive.columns.variance')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100">
                {lines.map(line => {
                  const received = parseReceived(line.receivedInput);
                  const isInvalid = Number.isNaN(received);
                  const isOverflow = !isInvalid && received > line.shipped;
                  const isNegative = !isInvalid && received < 0;
                  const shortage =
                    !isInvalid && received < line.shipped ? line.shipped - received : 0;
                  const inputInvalid = isInvalid || isOverflow || isNegative;
                  const inputError = isOverflow
                    ? t('transferReceive.errors.exceedsShipped')
                    : isNegative
                      ? t('transferReceive.errors.negative')
                      : null;

                  return (
                    <tr key={line.itemId}>
                      <td className="px-3 py-2 text-secondary-900">{line.productName}</td>
                      <td className="px-3 py-2 font-mono text-xs text-secondary-600">
                        {line.productSku}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-secondary-900">
                        {formatQuantity(line.shipped, undefined, NUMBER_FORMATTER_OPTIONS)}
                      </td>
                      <td className="px-3 py-2 text-right align-top">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min={0}
                          max={line.shipped}
                          className={`input w-28 text-right ${inputInvalid ? 'border-danger-400' : ''}`}
                          value={line.receivedInput}
                          onChange={event => handleReceivedChange(line.itemId, event.target.value)}
                          readOnly={line.tracksSerials}
                          aria-readonly={line.tracksSerials}
                          aria-label={t('transferReceive.receivedAriaLabel', {
                            product: line.productName,
                          })}
                          aria-invalid={inputInvalid}
                          aria-describedby={inputError ? `receive-error-${line.itemId}` : undefined}
                        />
                        {inputError && (
                          <p
                            id={`receive-error-${line.itemId}`}
                            className="mt-1 text-xs text-danger-700"
                          >
                            {inputError}
                          </p>
                        )}
                        {line.tracksSerials && (
                          <div className="mt-2 flex max-w-52 flex-wrap justify-end gap-1">
                            {line.serials.map(serial => (
                              <span
                                key={serial.id}
                                className="rounded bg-secondary-100 px-1.5 py-0.5 font-mono text-[11px] text-secondary-700"
                              >
                                {serial.serialNumber}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {shortage > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-800">
                            {t('transferReceive.varianceShort', {
                              amount: formatQuantity(shortage, undefined, NUMBER_FORMATTER_OPTIONS),
                            })}
                          </span>
                        ) : (
                          <span className="text-xs text-secondary-500">
                            {t('transferReceive.varianceMatch')}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-sm text-secondary-600" data-testid="transfer-receive-summary">
            {lineValidation.hasAnyVariance
              ? t('transferReceive.summary.shortage', {
                  amount: formatQuantity(
                    lineValidation.totalShortage,
                    undefined,
                    NUMBER_FORMATTER_OPTIONS
                  ),
                  count: lineValidation.shortLineCount,
                })
              : t('transferReceive.summary.match')}
          </p>

          {lineValidation.hasAnyVariance && (
            <div className="space-y-1">
              <label htmlFor="transfer-receive-discrepancy-notes" className="label block">
                {t('transferReceive.discrepancyLabel')}
              </label>
              <textarea
                id="transfer-receive-discrepancy-notes"
                className="input"
                rows={2}
                value={discrepancyNotes}
                onChange={event => setDiscrepancyNotes(event.target.value)}
                placeholder={t('transferReceive.discrepancyPlaceholder')}
                maxLength={500}
                aria-describedby="transfer-receive-discrepancy-help"
              />
              <p id="transfer-receive-discrepancy-help" className="text-xs text-secondary-500">
                {t('transferReceive.discrepancyHelp')}
              </p>
            </div>
          )}

          {submitError && (
            <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-2 text-sm text-danger-700">
              {submitError}
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
