import { useEffect, useRef, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Clock, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';
import { Link } from 'react-router';

import { useAuth } from '@/features/auth/AuthProvider';
import { useIsModuleActive } from '@/features/modules';
import { toSupportedAppLocale } from '@/i18n/resolveLocale';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { trpc } from '@/lib/trpc';
import { useCheckoutTransferDisplay } from './checkoutTransferDisplay';
import type { SalePaymentValues } from './salePaymentModal.types';
import { TransferQrCode } from './TransferQrCode';
import { useWalletCharge, type WalletChargeState } from './useWalletCharge';

interface SalePaymentTransferSectionProps {
  form: UseFormReturn<SalePaymentValues>;
  grandTotal: number;
  referenceValid: boolean;
  canSubmit: boolean;
  isSaving: boolean;
  onConfirm: () => void;
}

export function SalePaymentTransferSection({
  form,
  grandTotal,
  referenceValid,
  canSubmit,
  isSaving,
  onConfirm,
}: SalePaymentTransferSectionProps) {
  const { t, i18n } = useTranslation(['sales', 'common']);
  const { currentSite } = useTenant();
  const { user } = useAuth();
  const customerDisplayActive = useIsModuleActive('customer-display');
  const setDisplayTransfer = useCheckoutTransferDisplay(state => state.setTransfer);
  const siteId = currentSite?.id ?? '';
  // A tip typed while charging changes the total per keystroke; ask once it settles.
  const qrAmount = useDebouncedValue(grandTotal, 300);
  const query = trpc.transferDestinations.forCharge.useQuery(
    { siteId, amount: qrAmount, locale: toSupportedAppLocale(i18n.resolvedLanguage) },
    { enabled: siteId.length > 0, staleTime: 60_000, placeholderData: keepPreviousData }
  );
  const destinations = query.data?.destinations ?? [];
  const [pickedId, setPickedId] = useState<string | null>(null);
  const selected = destinations.find(item => item.id === pickedId) ?? destinations[0] ?? null;

  const amountSettled = qrAmount === grandTotal;
  const wallet = useWalletCharge({
    siteId,
    amount: qrAmount,
    enabled: amountSettled && query.data?.autoConfirm === true,
    keepOnLeave: isSaving,
  });
  const live = wallet.mode === 'live' ? wallet : null;
  const providerCharge = live?.status === 'pending' && live.qrPayload ? live : null;

  const label = providerCharge ? providerCharge.railLabel : selected?.label;
  const account = providerCharge ? '' : selected?.account;
  const qrPayload = providerCharge?.qrPayload ?? selected?.qr.payload;
  // Only a QR that spells out the amount goes stale while a new total is fetched.
  const qrIsStale = providerCharge
    ? !amountSettled
    : Boolean(selected?.qr.amountIncluded) && (query.isPlaceholderData || !amountSettled);

  const approvedReference = live?.status === 'approved' ? live.reference : null;
  useEffect(() => {
    if (approvedReference) {
      form.setValue('transferReference', approvedReference, { shouldValidate: true });
    }
  }, [approvedReference, form]);
  const autoConfirmedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!approvedReference || !referenceValid || !canSubmit) return;
    if (autoConfirmedRef.current === approvedReference) return;
    autoConfirmedRef.current = approvedReference;
    onConfirm();
  }, [approvedReference, canSubmit, onConfirm, referenceValid]);
  useEffect(() => {
    if (!customerDisplayActive || qrIsStale) return;
    if (label === undefined || account === undefined || qrPayload === undefined) return;
    setDisplayTransfer({ label, account, qrPayload, amount: grandTotal });
    return () => setDisplayTransfer(null);
  }, [account, customerDisplayActive, grandTotal, label, qrIsStale, qrPayload, setDisplayTransfer]);

  const referenceField = form.register('transferReference');
  const qrCopy = [
    customerDisplayActive ? t('payment.transferQr.onCustomerDisplay') : null,
    selected && !providerCharge && !selected.qr.amountIncluded
      ? t('payment.transferQr.amountTyped')
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className="sale-pay-transfer" data-testid="sale-payment-transfer">
      {query.isLoading ? (
        <p className="text-sm text-fg2" role="status">
          {t('common:status.loading')}
        </p>
      ) : query.isError && destinations.length === 0 ? (
        <p className="sale-pay-note" data-tone="muted" role="alert">
          {t('payment.transferQr.loadError')}
          <button
            type="button"
            className="ml-auto font-semibold text-primary-700 underline"
            onClick={() => void query.refetch()}
          >
            {t('common:actions.retry')}
          </button>
        </p>
      ) : providerCharge?.qrPayload ? (
        <div className="sale-pay-transfer-qr-row">
          <TransferQrCode
            payload={providerCharge.qrPayload}
            label={t('payment.transferQr.qrLabel', { name: providerCharge.railLabel })}
            testId="sale-payment-transfer-qr"
            pending={qrIsStale}
          />
          <div className="min-w-0">
            <p className="sale-pay-transfer-title">
              {t('payment.wallet.providerQrTitle', { rail: providerCharge.railLabel })}
            </p>
            {qrCopy && <p className="sale-pay-transfer-copy">{qrCopy}</p>}
          </div>
        </div>
      ) : selected ? (
        <div className="sale-pay-transfer-qr-row">
          <TransferQrCode
            payload={selected.qr.payload}
            label={t('payment.transferQr.qrLabel', { name: selected.label })}
            testId="sale-payment-transfer-qr"
            pending={qrIsStale}
          />
          <div className="min-w-0">
            <p className="sale-pay-transfer-title">{t('payment.transferQr.title')}</p>
            {qrCopy && <p className="sale-pay-transfer-copy">{qrCopy}</p>}
            <div
              className="sale-pay-transfer-chips"
              role="group"
              aria-label={t('payment.transferQr.destinations')}
            >
              {destinations.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="sale-pay-transfer-chip"
                  aria-pressed={item.id === selected.id}
                  onClick={() => setPickedId(item.id)}
                  data-testid={`sale-payment-transfer-destination-${item.id}`}
                >
                  <span>{item.label}</span> {item.account}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="sale-pay-note" data-tone="muted" data-testid="sale-payment-transfer-empty">
          {t('payment.transferQr.empty')}
          {user?.role === 'admin' && (
            <Link to="/company?tab=payments" className="ml-auto font-semibold text-primary-700">
              {t('payment.transferQr.configure')}
            </Link>
          )}
        </p>
      )}

      <div>
        <label htmlFor="sale-payment-transfer-reference" className="sales-cap">
          {t('payment.transferQr.reference')}
        </label>
        <div className="sale-pay-money-field relative mt-1.5">
          <input
            id="sale-payment-transfer-reference"
            className="sale-pay-transfer-reference"
            autoComplete="off"
            spellCheck={false}
            maxLength={120}
            required
            data-testid="sale-payment-transfer-reference"
            {...referenceField}
          />
          {referenceValid && (
            <CircleCheck
              className="sale-pay-dv-ok"
              role="img"
              aria-label={t('payment.transferQr.referenceOk')}
              data-testid="sale-payment-transfer-reference-ok"
            />
          )}
        </div>
      </div>

      <WalletStatusNote wallet={wallet} autoConfirming={canSubmit} />
    </section>
  );
}

function WalletStatusNote({
  wallet,
  autoConfirming,
}: {
  wallet: WalletChargeState;
  autoConfirming: boolean;
}) {
  const { t } = useTranslation('sales');
  const note =
    wallet.mode !== 'live'
      ? wallet.mode === 'manual' && wallet.providerUnavailable
        ? {
            state: 'unavailable',
            tone: 'muted',
            Icon: Clock,
            text: t('payment.wallet.unavailable'),
          }
        : { state: 'manual', tone: 'muted', Icon: Clock, text: t('payment.transferQr.manualNote') }
      : wallet.status === 'approved'
        ? {
            state: 'approved',
            tone: 'success',
            role: 'status',
            Icon: CircleCheck,
            text: t(
              autoConfirming ? 'payment.wallet.approvedConfirming' : 'payment.wallet.approved',
              {
                rail: wallet.railLabel,
              }
            ),
          }
        : wallet.status === 'declined'
          ? {
              state: 'declined',
              tone: 'danger',
              role: 'alert',
              Icon: CircleAlert,
              text: t('payment.wallet.declined', { rail: wallet.railLabel }),
            }
          : {
              state: 'pending',
              tone: 'muted',
              role: 'status',
              Icon: LoaderCircle,
              text: t('payment.wallet.pending', { rail: wallet.railLabel }),
            };
  const { Icon } = note;
  return (
    <p
      className="sale-pay-note"
      data-tone={note.tone}
      role={'role' in note ? note.role : undefined}
      data-testid="sale-payment-wallet-status"
      data-state={note.state}
    >
      <Icon
        className={`h-5 w-5 shrink-0${note.state === 'pending' ? ' motion-safe:animate-spin' : ''}`}
        aria-hidden="true"
      />
      {note.text}
    </p>
  );
}
