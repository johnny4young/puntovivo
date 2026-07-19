/**
 * ENG-215 — the customer's loyalty ledger, inside their detail drawer.
 *
 * ENG-213 shipped the ledger and the checkout chip, but the history had no
 * surface and `loyalty.adjust` was reachable only by API — so a cashier who
 * mis-attributed a sale left the admin with no way to fix the balance. This
 * panel closes that: the balance, the movements behind it, and (admins only)
 * a manual correction that demands a note.
 *
 * Visibility follows the same rule as the checkout chip: silent unless it
 * has something to say. A tenant that never enabled the program has no
 * points anywhere, so no customer shows the section. The exception is the
 * admin, who must be able to grant the very first points on a fresh
 * program — for them the panel is always mounted.
 *
 * The reads are role-safe by construction: `loyalty.forCustomer` is
 * tenant-wide (the cashier needs the balance) and carries no cost data,
 * while the adjust mutation is admin-gated on the server too.
 */
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { cn, formatDate } from '@/lib/utils';

/** How many movements the drawer shows before it stops being a summary. */
const MOVEMENT_LIMIT = 8;

/** Server bound (`adjustLoyaltyInput.note`): an unexplained change is a support ticket. */
const MIN_NOTE_LENGTH = 3;

export function CustomerLoyaltyPanel({ customerId }: { customerId: string }) {
  const { t } = useTranslation(['customers', 'errors']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const isAdmin = user?.role === 'admin';

  const [points, setPoints] = useState<string>('');
  const [note, setNote] = useState<string>('');

  const loyaltyQuery = trpc.loyalty.forCustomer.useQuery(
    { customerId, limit: MOVEMENT_LIMIT },
    { enabled: !!customerId }
  );

  const adjustMutation = trpc.loyalty.adjust.useMutation({
    onSuccess: () => {
      setPoints('');
      setNote('');
      toast.success({ title: t('customers:loyalty.toast.adjusted') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'customers:loyalty.toast.adjustError' }),
    onSettled: () => utils.loyalty.forCustomer.invalidate(),
  });

  // Cache-leak guard (ENG-199 lesson): `enabled: false` still serves the
  // previous customer's cached data, so gate the read on the flag too.
  const data = customerId ? loyaltyQuery.data : undefined;
  const balance = data?.points ?? 0;
  const movements = data?.movements ?? [];

  if (!customerId) return null;
  // Nothing to say and nobody who could act on it.
  if (!isAdmin && balance <= 0 && movements.length === 0) return null;

  const parsedPoints = Number(points);
  const pointsAreValid =
    points.trim() !== '' && Number.isInteger(parsedPoints) && parsedPoints !== 0;
  const noteIsValid = note.trim().length >= MIN_NOTE_LENGTH;
  const canSubmit = pointsAreValid && noteIsValid && !adjustMutation.isPending;

  return (
    <section className="mt-5 border-t border-line pt-4" data-testid="customer-loyalty-panel">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-secondary-900">
          <Sparkles className="h-4 w-4 text-primary-600" aria-hidden="true" />
          {t('customers:loyalty.title')}
        </h3>
        <span className="pv-badge primary" data-testid="customer-loyalty-balance">
          {t('customers:loyalty.pointsBalance', { count: balance })}
        </span>
      </div>

      {movements.length === 0 ? (
        <p className="mt-3 text-sm text-secondary-500">{t('customers:loyalty.empty')}</p>
      ) : (
        <ul className="mt-3 space-y-1.5" data-testid="customer-loyalty-movements">
          {movements.map(movement => (
            <li key={movement.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="text-secondary-900">
                  {t(`customers:loyalty.kind.${movement.kind}`)}
                </span>
                {movement.note && (
                  <span className="ml-1.5 truncate text-secondary-500">· {movement.note}</span>
                )}
                <span className="ml-1.5 text-xs text-secondary-400">
                  {formatDate(movement.createdAt)}
                </span>
              </span>
              {/* The sign IS the story of the row, so it is never dropped. */}
              <span
                className={cn(
                  'flex-shrink-0 font-medium tabular-nums',
                  movement.points < 0 ? 'text-danger-500' : 'text-success-600'
                )}
              >
                {movement.points > 0 ? '+' : ''}
                {movement.points}
              </span>
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-secondary-500">
            {t('customers:loyalty.adjust.heading')}
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="flex flex-col">
              <span className="text-[11px] text-secondary-500">
                {t('customers:loyalty.adjust.pointsLabel')}
              </span>
              <input
                type="number"
                step={1}
                className="input mt-1 w-28"
                value={points}
                placeholder="-10"
                disabled={adjustMutation.isPending}
                aria-label={t('customers:loyalty.adjust.pointsAria')}
                onChange={event => setPoints(event.target.value)}
              />
            </label>
            <label className="flex min-w-[12rem] flex-1 flex-col">
              <span className="text-[11px] text-secondary-500">
                {t('customers:loyalty.adjust.noteLabel')}
              </span>
              <input
                type="text"
                className="input mt-1"
                value={note}
                maxLength={240}
                placeholder={t('customers:loyalty.adjust.notePlaceholder')}
                disabled={adjustMutation.isPending}
                aria-label={t('customers:loyalty.adjust.noteAria')}
                onChange={event => setNote(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn-primary mb-0.5"
              disabled={!canSubmit}
              data-testid="customer-loyalty-adjust-submit"
              onClick={() =>
                void adjustMutation.mutateAsync({
                  customerId,
                  points: parsedPoints,
                  note: note.trim(),
                })
              }
            >
              {t('customers:loyalty.adjust.submit')}
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-secondary-500">
            {t('customers:loyalty.adjust.help')}
          </p>
        </div>
      )}
    </section>
  );
}
