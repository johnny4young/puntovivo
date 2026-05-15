import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
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

interface RefundConfirmOverlayProps {
  isOpen: boolean;
  isPending: boolean;
  saleNumber?: string;
  refundTotal: number;
  /**
   * Refund threshold (tenant currency). When `refundTotal` exceeds it,
   * the overlay surfaces an admin-approval warning lock per the V8
   * design. The server-side authorization is enforced separately by
   * `managerOrAdminProcedure`; this is purely a visual heads-up.
   */
  adminApprovalThreshold?: number;
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
  adminApprovalThreshold,
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
      title={t('refund.title', { defaultValue: 'Devolver venta' })}
      description={
        saleNumber
          ? t('refund.descriptionWithNumber', {
              defaultValue: 'Confirma el motivo para registrar la devolución del ticket {{number}}.',
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
            disabled={isPending}
            className="sm:min-w-[10rem]"
          >
            {isPending
              ? t('refund.processing', { defaultValue: 'Procesando...' })
              : t('refund.confirm', { defaultValue: 'Confirmar devolución' })}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
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
              <p className="mt-2 font-display text-3xl text-warning-700">
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
