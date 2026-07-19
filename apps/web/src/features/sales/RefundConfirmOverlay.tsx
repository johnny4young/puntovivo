import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Banknote,
  Minus,
  Plus,
  Replace,
  ShieldAlert,
  Sparkles,
  Ticket,
} from 'lucide-react';
import { ModalButton } from '@/components/form-controls/Modal';
import { Overlay } from '@/components/overlay/Overlay';
import { cn, formatCurrency } from '@/lib/utils';

/**
 * Catalog of return reasons drawn from the V8 design-system handoff.
 * Kept in the client because the existing `sales.returnSale` schema
 * accepts a free-text `reason` string; the catalog values double as
 * i18n keys (`sales:refund.reasons.<id>`).
 */
const RETURN_REASONS = ['expired', 'duplicate', 'wrong_item', 'other'] as const;
export type RefundReason = (typeof RETURN_REASONS)[number];

/**
 * V8 action grid — what the cashier wants to give the customer back.
 * Encoded into the free-text `reason` passed to `sales.returnSale` as a
 * `[<action>]` prefix so the audit log captures the intent without
 * extending the server schema. UI only.
 */
const REFUND_ACTIONS = ['cash', 'replace', 'credit_note', 'voucher'] as const;
export type RefundAction = (typeof REFUND_ACTIONS)[number];

const ACTION_ICONS: Record<RefundAction, typeof Banknote> = {
  cash: Banknote,
  replace: Replace,
  credit_note: Sparkles,
  voucher: Ticket,
};

interface RefundLineSummary {
  id: string;
  productName: string;
  quantity: number;
  total: number;
}

// ENG-179b — explicit `| undefined` on optional fields.
interface RefundConfirmOverlayProps {
  isOpen: boolean;
  isPending: boolean;
  saleNumber?: string | undefined;
  refundTotal: number;
  /**
   * Optional line summary used to surface the V8 per-line checkbox
   * panel. The selection state is visual only — the server still
   * refunds the full ticket; the picked lines and the action are
   * baked into the free-text `reason` string so the audit log keeps
   * the operator's intent.
   */
  lines?: ReadonlyArray<RefundLineSummary> | undefined;
  /**
   * Refund threshold (tenant currency). When `refundTotal` exceeds it,
   * the overlay surfaces an admin-approval warning lock per the V8
   * design. The server-side role/grant authorization is enforced separately;
   * this threshold remains purely a visual heads-up.
   */
  adminApprovalThreshold?: number | undefined;
  approvalPanel?: ReactNode | undefined;
  confirmDisabled?: boolean | undefined;
  onClose: () => void;
  onConfirm: (reason: string | undefined) => void;
}

/**
 * ENG-084 — V8 "Devolución · ticket original" refund flow.
 *
 * Replaces the previous one-button ConfirmModal with an editorial
 * Overlay that lets the cashier:
 *   1. Pick a reason (Vencido / Compra duplicada / Cambio / Otro)
 *      from a pill grid; reason is forwarded to `sales.returnSale`
 *      so the audit log captures it.
 *   2. Read the refund total in the warning-tinted card.
 *   3. See the admin-approval lock when the refund crosses the
 *      tenant threshold.
 *
 * Server contract unchanged; this is presentation only.
 */
export function RefundConfirmOverlay({
  isOpen,
  isPending,
  saleNumber,
  refundTotal,
  lines,
  adminApprovalThreshold,
  approvalPanel,
  confirmDisabled = false,
  onClose,
  onConfirm,
}: RefundConfirmOverlayProps) {
  const { t } = useTranslation('sales');
  const [reason, setReason] = useState<RefundReason | ''>('');
  const [action, setAction] = useState<RefundAction>('cash');
  const [selectedLineIds, setSelectedLineIds] = useState<ReadonlySet<string>>(
    () => new Set(lines?.map(line => line.id) ?? [])
  );
  const [lineQuantities, setLineQuantities] = useState<ReadonlyMap<string, number>>(
    () => new Map(lines?.map(line => [line.id, line.quantity]) ?? [])
  );
  const requiresApproval =
    adminApprovalThreshold !== undefined && refundTotal > adminApprovalThreshold;

  const toggleLine = (id: string) => {
    setSelectedLineIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setLineQuantity = (id: string, max: number, value: number) => {
    setLineQuantities(prev => {
      const next = new Map(prev);
      next.set(id, Math.max(0, Math.min(max, value)));
      return next;
    });
  };

  const handleConfirm = () => {
    // Bake selected lines + their refund qty into the free-text reason
    // so the audit log captures intent without extending the server
    // schema. Server still refunds the whole ticket — handoff §8 says
    // "presentation only".
    const lineMeta =
      lines && lines.length > 0
        ? lines
            .filter(line => selectedLineIds.has(line.id))
            .map(line => {
              const qty = lineQuantities.get(line.id) ?? line.quantity;
              return `${line.productName.slice(0, 30)}×${qty}`;
            })
            .join('; ')
        : '';
    const parts = [`[${action}]`];
    if (lineMeta) parts.push(`(${lineMeta})`);
    if (reason) parts.push(reason);
    onConfirm(parts.join(' '));
  };

  return (
    <Overlay
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      kicker={t('refund.kicker', { defaultValue: 'Devolución' })}
      title={t('refund.title', { defaultValue: 'Devolver venta' })}
      description={
        saleNumber
          ? t('refund.descriptionWithNumber', {
              defaultValue:
                'Confirma el motivo para registrar la devolución del ticket {{number}}.',
              number: saleNumber,
            })
          : t('refund.description', {
              defaultValue: 'Confirma el motivo para registrar la devolución del ticket.',
            })
      }
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isPending} className="sm:min-w-[8.5rem]">
            {t('refund.cancel', { defaultValue: 'Cancelar' })}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={handleConfirm}
            disabled={isPending || confirmDisabled}
            className="disabled:bg-secondary-200 disabled:text-secondary-500 sm:min-w-[10rem]"
          >
            {isPending
              ? t('refund.processing', { defaultValue: 'Procesando...' })
              : t('refund.confirm', { defaultValue: 'Confirmar devolución' })}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        {approvalPanel}
        {lines && lines.length > 0 && (
          <div className="rounded-2xl border border-line/70 bg-surface/95 px-4 py-3">
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-secondary-500">
              {t('refund.linesLabel', { defaultValue: 'Líneas a devolver' })}
            </p>
            <ul className="mt-2 space-y-1.5">
              {lines.map(line => {
                const checked = selectedLineIds.has(line.id);
                const currentQty = lineQuantities.get(line.id) ?? line.quantity;
                return (
                  <li key={line.id}>
                    <div
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-xl border bg-surface px-3 py-2 text-sm transition-colors',
                        checked
                          ? 'border-primary-200 bg-primary-50/60 text-secondary-950'
                          : 'border-line/70 text-secondary-700 hover:border-primary-200'
                      )}
                    >
                      <label className="flex min-w-0 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-line-strong text-primary-600 focus:ring-primary-300"
                          checked={checked}
                          onChange={() => toggleLine(line.id)}
                          aria-label={t('refund.toggleLine', {
                            defaultValue: 'Incluir línea',
                          })}
                        />
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{line.productName}</span>
                          <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-secondary-500">
                            {t('refund.lineMaxLabel', { defaultValue: 'máx' })} ×{line.quantity}
                          </span>
                        </span>
                      </label>
                      {checked && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={t('refund.decrementQty', { defaultValue: 'Restar' })}
                            disabled={currentQty <= 0}
                            onClick={() => setLineQuantity(line.id, line.quantity, currentQty - 1)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-warning-500/40 text-warning-700 transition hover:border-warning-500 hover:bg-warning-50 disabled:opacity-40"
                          >
                            <Minus className="h-3 w-3" aria-hidden="true" />
                          </button>
                          <input
                            type="number"
                            min={0}
                            max={line.quantity}
                            step={1}
                            value={currentQty}
                            onChange={event =>
                              setLineQuantity(line.id, line.quantity, Number(event.target.value))
                            }
                            className="h-7 w-12 rounded-md border border-warning-500/40 bg-warning-50/40 text-center font-mono text-[12px] tabular-nums text-warning-700 outline-none focus:border-warning-500"
                            aria-label={t('refund.qtyForLine', {
                              defaultValue: 'Cantidad a devolver',
                            })}
                          />
                          <button
                            type="button"
                            aria-label={t('refund.incrementQty', { defaultValue: 'Sumar' })}
                            disabled={currentQty >= line.quantity}
                            onClick={() => setLineQuantity(line.id, line.quantity, currentQty + 1)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-warning-500/40 text-warning-700 transition hover:border-warning-500 hover:bg-warning-50 disabled:opacity-40"
                          >
                            <Plus className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                      <span className="font-mono text-[12.5px] tabular-nums text-secondary-700">
                        {formatCurrency(line.total)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[10.5px] text-secondary-500">
              {t('refund.linesHint', {
                defaultValue:
                  'La selección de líneas se registra en el motivo. El reembolso queda completo por compatibilidad con el flujo actual.',
              })}
            </p>
          </div>
        )}

        <div
          className="relative overflow-hidden rounded-2xl border border-warning-500/30 bg-warning-50/70 px-5 py-4"
          aria-label={t('refund.totalLabel', { defaultValue: 'Total a devolver' })}
        >
          {/* V8 radial-gradient accent in the warning corner */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 90% 0%, color-mix(in oklch, var(--warning-500) 20%, transparent), transparent 55%)',
            }}
          />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-warning-700">
                {t('refund.totalLabel', { defaultValue: 'Total a devolver' })}
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums tracking-[-0.02em] text-warning-700">
                {formatCurrency(refundTotal)}
              </p>
            </div>
            <AlertTriangle className="h-6 w-6 shrink-0 text-warning-700" />
          </div>
        </div>

        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-secondary-500">
            {t('refund.reasonLabel', { defaultValue: 'Motivo' })}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {RETURN_REASONS.map(option => {
              const isActive = reason === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setReason(option)}
                  className={cn(
                    'flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-sm font-medium transition-all',
                    isActive
                      ? 'border-primary-400 bg-primary-50 text-primary-700'
                      : 'border-line-strong/60 bg-surface text-secondary-700 hover:border-primary-300 hover:bg-primary-50/60'
                  )}
                  aria-pressed={isActive}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                      isActive ? 'border-primary-500 bg-primary-500' : 'border-line-strong/60'
                    )}
                  >
                    {isActive && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                  {t(`refund.reasons.${option}`, {
                    defaultValue:
                      option === 'expired'
                        ? 'Vencido / mal estado'
                        : option === 'duplicate'
                          ? 'Compra duplicada'
                          : option === 'wrong_item'
                            ? 'Cambio de producto'
                            : 'Otro',
                  })}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-secondary-500">
            {t('refund.actionLabel', { defaultValue: 'Acción' })}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {REFUND_ACTIONS.map(option => {
              const isActive = action === option;
              const Icon = ACTION_ICONS[option];
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setAction(option)}
                  className={cn(
                    'flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left text-sm font-medium transition-all',
                    isActive
                      ? 'border-primary-400 bg-primary-50 text-primary-700'
                      : 'border-line-strong/60 bg-surface text-secondary-700 hover:border-primary-300 hover:bg-primary-50/60'
                  )}
                  aria-pressed={isActive}
                >
                  <span
                    className={cn(
                      'glyph-tile h-9 w-9',
                      isActive ? 'glyph-tile-primary' : 'bg-secondary-100 text-secondary-600'
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold leading-tight">
                      {t(`refund.actions.${option}.label`, {
                        defaultValue:
                          option === 'cash'
                            ? 'Devolver dinero'
                            : option === 'replace'
                              ? 'Cambio mismo producto'
                              : option === 'credit_note'
                                ? 'Saldo a favor'
                                : 'Vale',
                      })}
                    </span>
                    <span className="block text-[10.5px] uppercase tracking-[0.18em] text-secondary-500">
                      {t(`refund.actions.${option}.helper`, {
                        defaultValue:
                          option === 'cash'
                            ? 'Efectivo / mismo medio'
                            : option === 'replace'
                              ? 'Sin tocar saldo'
                              : option === 'credit_note'
                                ? 'Crédito tienda'
                                : 'Voucher imprimible',
                      })}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {requiresApproval && (
          <div className="flex items-start gap-3 rounded-2xl border border-danger-500/30 bg-danger-50/60 px-4 py-3 text-danger-700">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold">
                {t('refund.approvalLockTitle', {
                  defaultValue: 'Aprobación de administrador requerida',
                })}
              </p>
              <p className="mt-1 leading-5">
                {t('refund.approvalLockBody', {
                  defaultValue:
                    'El monto excede el límite operativo. Solicita autorización antes de confirmar.',
                })}
              </p>
            </div>
          </div>
        )}
      </div>
    </Overlay>
  );
}
