import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { OFFLINE_CAPABILITY_CATALOG, type OfflineCapabilityStatus } from './OfflineCapabilityCatalog';

interface OfflineCapabilityGridProps {
  /**
   * When false the panel hides itself — surface only while the device
   * is offline or the hub is unreachable; for healthy connections it
   * is dead chrome.
   */
  visible: boolean;
  /** Render a compact variant inside the existing offline banner. */
  variant?: 'standalone' | 'inline';
}

// Backward-compatible local alias — existing render path stays untouched.
const CAPABILITIES = OFFLINE_CAPABILITY_CATALOG;

const STATUS_TONE: Record<OfflineCapabilityStatus, string> = {
  available: 'badge badge-success',
  limited: 'badge badge-warning',
  pending: 'badge badge-secondary',
  blocked: 'badge badge-danger',
};

/**
 * ENG-088 — V12 "Modo offline" capability grid from the Claude
 * Design handoff.
 *
 * Surfaces six tiles that tell the cashier exactly what still works
 * when the device drops off the hub: vender · cobrar efectivo work
 * fully offline; cobrar tarjeta + recibo digital fall back to
 * limited modes; sumar puntos queues; ajustar inventario is blocked
 * until reconnection. The grid replaces the previous one-line "you
 * are offline" banner with a calm "tranquila, sigue vendiendo"
 * affordance.
 */
export function OfflineCapabilityGrid({ visible, variant = 'standalone' }: OfflineCapabilityGridProps) {
  const { t } = useTranslation('common');
  if (!visible) return null;

  return (
    <section
      data-testid="offline-capability-grid"
      className={cn(
        'card relative overflow-hidden p-5 sm:p-6',
        variant === 'inline' && 'border-warning-500/30 bg-warning-50/70 p-4'
      )}
    >
      {variant === 'standalone' && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 90% 0%, color-mix(in oklch, var(--warning-500) 16%, transparent), transparent 55%)',
          }}
        />
      )}
      <header className="relative">
        <p className="page-kicker">{t('offlineGrid.kicker', { defaultValue: 'Modo offline' })}</p>
        <h2 className="mt-1 text-2xl font-bold tracking-[-0.02em] text-secondary-950">
          {t('offlineGrid.title', { defaultValue: 'Tranquila, sigue vendiendo' })}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary-600">
          {t('offlineGrid.description', {
            defaultValue:
              'Las ventas se guardan en esta tableta y se sincronizan cuando regrese la conexión.',
          })}
        </p>
      </header>
      <div className="relative mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CAPABILITIES.map(cap => {
          const Icon = cap.icon;
          return (
            <div
              key={cap.id}
              className="rounded-2xl border border-line/70 bg-surface/95 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="glyph-tile glyph-tile-primary h-9 w-9">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className={STATUS_TONE[cap.status]}>
                  {t(`offlineGrid.status.${cap.status}`, {
                    defaultValue:
                      cap.status === 'available'
                        ? 'Disponible'
                        : cap.status === 'limited'
                          ? 'Limitado'
                          : cap.status === 'pending'
                            ? 'Pendiente'
                            : 'Bloqueado',
                  })}
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold text-secondary-950">
                {t(`offlineGrid.capabilities.${cap.id}.label`, {
                  defaultValue:
                    cap.id === 'sell'
                      ? 'Vender'
                      : cap.id === 'cash'
                        ? 'Cobrar efectivo'
                        : cap.id === 'card'
                          ? 'Cobrar tarjeta'
                          : cap.id === 'receipt'
                            ? 'Recibo digital'
                            : cap.id === 'loyalty'
                              ? 'Sumar puntos'
                              : 'Ajustar inventario',
                })}
              </p>
              {cap.note && (
                <p className="mt-1 text-[0.62rem] uppercase tracking-[0.18em] text-secondary-500">
                  {t(`offlineGrid.capabilities.${cap.id}.note`, { defaultValue: '' })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
