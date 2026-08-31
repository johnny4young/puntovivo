import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { ModalButton } from '@/components/form-controls/Modal';
import { Overlay } from '@/components/overlay/Overlay';
import { cn, formatCurrency } from '@/lib/utils';

/**
 * Catalog of return reasons drawn from the V8 design specification.
 * Kept in the client because the existing `sales.returnSale` schema
 * accepts a free-text `reason` string; the catalog values double as
 * i18n keys (`sales:refund.reasons.<id>`).
 */
const RETURN_REASONS = ['expired', 'duplicate', 'wrong_item', 'other'] as const;
export type RefundReason = (typeof RETURN_REASONS)[number];

interface RefundLineSummary {
  id: string;
  productName: string;
  quantity: number;
  total: number;
}

// explicit `| undefined` on optional fields.
interface RefundConfirmOverlayProps {
  isOpen: boolean;
  isPending: boolean;
  saleNumber?: string | undefined;
  refundTotal: number;
  /** Read-only ticket summary. The current server contract refunds all lines. */
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
 * Full-ticket refund confirmation.
 *
 * Replaces the previous one-button ConfirmModal with an editorial
 * Overlay that lets the cashier:
 * 1. Pick a reason (Vencido / Compra duplicada / Cambio / Otro)
 * from a pill grid; reason is forwarded to `sales.returnSale`
 * so the audit log captures it.
 * 2. Read the refund total in the warning-tinted card.
 * 3. See the admin-approval lock when the refund crosses the
 * tenant threshold.
 *
 * The UI deliberately exposes only the contract the server can persist:
 * whole-ticket return, whole-ticket stock restoration, and reversal of the
 * original cash contribution. Partial lines and substitute tender actions
 * stay absent until they have transactional server models.
 */
export function RefundConfirmOverlay(props: RefundConfirmOverlayProps) {
  if (!props.isOpen) return null;
  return <RefundConfirmOverlayContent key={props.saleNumber ?? '__open-refund__'} {...props} />;
}

function RefundConfirmOverlayContent({
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
  const requiresApproval =
    adminApprovalThreshold !== undefined && refundTotal > adminApprovalThreshold;

  const handleConfirm = () => {
    onConfirm(reason || undefined);
  };

  return (
    <Overlay
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      kicker={t('refund.kicker', { defaultValue: 'Devolución' })}
      title={t('refund.title', { defaultValue: 'Devolver venta completa' })}
      description={
        saleNumber
          ? t('refund.descriptionWithNumber', {
              defaultValue: 'Confirma el motivo para devolver el ticket completo {{number}}.',
              number: saleNumber,
            })
          : t('refund.description', {
              defaultValue: 'Confirma el motivo para devolver el ticket completo.',
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
              {t('refund.linesLabel', { defaultValue: 'Líneas del ticket' })}
            </p>
            <ul className="mt-2 space-y-1.5">
              {lines.map(line => (
                <li
                  key={line.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line/70 bg-surface px-3 py-2 text-sm text-secondary-950"
                >
                  <span className="min-w-0 truncate font-medium">{line.productName}</span>
                  <span className="shrink-0 font-mono text-[12px] tabular-nums text-secondary-600">
                    ×{line.quantity}
                  </span>
                  <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-secondary-700">
                    {formatCurrency(line.total)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 rounded-xl border border-warning-500/25 bg-warning-50/60 px-3 py-2 text-xs leading-5 text-warning-800">
              {t('refund.fullTicketNotice', {
                defaultValue:
                  'Esta acción devuelve el ticket completo y restaura todas sus líneas de inventario.',
              })}
            </p>
          </div>
        )}

        <div
          className="relative overflow-hidden rounded-2xl border border-warning-500/30 bg-warning-50/70 px-5 py-4"
          aria-label={t('refund.totalLabel', { defaultValue: 'Total completo a devolver' })}
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
                {t('refund.totalLabel', { defaultValue: 'Total completo a devolver' })}
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
