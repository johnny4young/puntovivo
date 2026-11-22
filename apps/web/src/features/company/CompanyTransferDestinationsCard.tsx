import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Landmark, Pencil, Plus, QrCode, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import {
  BANK_ACCOUNT_TYPES,
  MAX_SITE_TRANSFER_DESTINATIONS,
  TRANSFER_DESTINATION_KINDS,
  TRANSFER_DESTINATION_LIMITS as LIMITS,
  defaultTransferLabel,
  formatTransferAccount,
  isEmvcoQrPayload,
  normalizeTransferAccount,
  type BankAccountType,
  type TransferDestinationKind,
} from '@puntovivo/shared/transfer-destinations';
import { useToast } from '@/components/feedback/ToastProvider';
import { ConfirmModal, Modal } from '@/components/form-controls/Modal';
import { Badge, Button } from '@/components/ui';
import { TransferQrCode } from '@/features/sales/TransferQrCode';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';

type Destination = inferRouterOutputs<AppRouter>['transferDestinations']['list'][number];

const TID = 'transfer-destinations';

/** The label the admin typed, or '' while it still follows the kind or bank name. */
const customLabel = (destination: Destination) =>
  destination.label !== defaultTransferLabel(destination.kind, destination.bankName)
    ? destination.label
    : '';

/** Admins choose where each site receives transfers and in which order registers show them. */
export function CompanyTransferDestinationsCard() {
  const { t } = useTranslation(['operations', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const { sites, currentSite } = useTenant();
  const isAdmin = user?.role === 'admin';
  const [pickedSiteId, setPickedSiteId] = useState<string | null>(null);
  const siteId = pickedSiteId ?? currentSite?.id ?? sites[0]?.id ?? '';
  // `null` is closed, `'new'` adds, a row edits it.
  const [editing, setEditing] = useState<Destination | 'new' | null>(null);
  const [removing, setRemoving] = useState<Destination | null>(null);

  const query = trpc.transferDestinations.list.useQuery(
    { siteId },
    { enabled: isAdmin && siteId !== '' }
  );
  const destinations = query.data ?? [];
  const isFull = destinations.length >= MAX_SITE_TRANSFER_DESTINATIONS;

  const refresh = (list: Destination[], forSiteId: string) => {
    utils.transferDestinations.list.setData({ siteId: forSiteId }, list);
    void utils.transferDestinations.forCharge.invalidate();
  };
  const onError = onErrorToast(toast, t);
  const setMutation = trpc.transferDestinations.set.useMutation({
    onSuccess: (list, input) => {
      refresh(list, input.siteId);
      setEditing(null);
    },
    onError,
  });
  const reorderMutation = trpc.transferDestinations.reorder.useMutation({
    onSuccess: (list, input) => refresh(list, input.siteId),
    onError,
  });
  const removeMutation = trpc.transferDestinations.remove.useMutation({
    onSuccess: (list, input) => {
      refresh(list, input.siteId);
      setRemoving(null);
    },
    onError,
  });
  const busy = reorderMutation.isPending || removeMutation.isPending;

  if (!isAdmin) return null;

  const move = (index: number, offset: -1 | 1) => {
    const ids = destinations.map(destination => destination.id);
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(index + offset, 0, moved);
    reorderMutation.mutate({ siteId, ids });
  };

  const kindName = (destination: Destination) =>
    destination.kind === 'bank_account'
      ? [
          destination.bankName,
          destination.accountType &&
            t(`operations:transferDestinations.accountTypes.${destination.accountType}`),
        ]
          .filter(Boolean)
          .join(' · ')
      : t(`operations:transferDestinations.kinds.${destination.kind}`);

  return (
    <div className="card space-y-4 p-6" data-testid={`${TID}-card`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="pv-gt pv-gt-primary h-9 w-9">
          <Landmark className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 className="pv-title text-lg">{t('operations:transferDestinations.title')}</h2>
        <span className="text-sm tabular-nums text-fg2" data-testid={`${TID}-count`}>
          {t('operations:transferDestinations.count', {
            count: destinations.length,
            max: MAX_SITE_TRANSFER_DESTINATIONS,
          })}
        </span>
        <Button
          variant="outline"
          className="ml-auto"
          disabled={isFull || !query.isSuccess}
          onClick={() => setEditing('new')}
          data-testid={`${TID}-add`}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('operations:transferDestinations.add')}
        </Button>
      </div>

      {sites.length > 1 && (
        <div className="pv-field max-w-xs">
          <label className="label" htmlFor={`${TID}-site`}>
            {t('operations:transferDestinations.site')}
          </label>
          <select
            id={`${TID}-site`}
            className="pv-input w-full"
            value={siteId}
            onChange={event => setPickedSiteId(event.target.value)}
            data-testid={`${TID}-site`}
          >
            {sites.map(site => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {query.isLoading && (
        <p className="text-sm text-fg2" data-testid={`${TID}-loading`}>
          {t('common:actions.loading')}
        </p>
      )}
      {query.error && (
        <p className="text-sm text-danger-700" role="alert" data-testid={`${TID}-error`}>
          {translateServerError(query.error, t, t('errors:server.unknown'))}
        </p>
      )}

      {query.isSuccess && destinations.length === 0 && (
        <p
          className="rounded-xl border border-dashed border-line p-4 text-sm text-fg2"
          data-testid={`${TID}-empty`}
        >
          {t('operations:transferDestinations.empty')}
        </p>
      )}

      {destinations.length > 0 && (
        <ol className="flex flex-col gap-2" data-testid={`${TID}-list`}>
          {destinations.map((destination, index) => {
            const name = kindName(destination);
            return (
              <li
                key={destination.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card p-3"
                data-testid={`${TID}-row-${destination.id}`}
              >
                <div className="min-w-[12rem] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-fg1">{name}</span>
                    {customLabel(destination) && (
                      <span className="text-sm text-fg2">{destination.label}</span>
                    )}
                    {destination.qrPayload && (
                      <Badge variant="info" data-testid={`${TID}-qr-${destination.id}`}>
                        <QrCode className="h-3 w-3" aria-hidden="true" />
                        {t('operations:transferDestinations.qrStored')}
                      </Badge>
                    )}
                  </div>
                  <span className="block font-mono text-sm tabular-nums text-fg1">
                    {formatTransferAccount(destination.account)}
                  </span>
                </div>
                <div className="flex gap-1">
                  {[
                    {
                      id: 'up',
                      labelKey: 'moveUp',
                      Icon: ArrowUp,
                      edge: index === 0,
                      onClick: () => move(index, -1),
                    },
                    {
                      id: 'down',
                      labelKey: 'moveDown',
                      Icon: ArrowDown,
                      edge: index === destinations.length - 1,
                      onClick: () => move(index, 1),
                    },
                    {
                      id: 'edit',
                      labelKey: 'edit',
                      Icon: Pencil,
                      onClick: () => setEditing(destination),
                    },
                    {
                      id: 'remove',
                      labelKey: 'remove',
                      Icon: Trash2,
                      className: 'text-danger-700',
                      onClick: () => setRemoving(destination),
                    },
                  ].map(({ id, labelKey, Icon, edge, className, onClick }) => (
                    <Button
                      key={id}
                      variant="ghost"
                      size="icon"
                      className={className}
                      disabled={busy || Boolean(edge)}
                      onClick={onClick}
                      aria-label={t(`operations:transferDestinations.${labelKey}`, {
                        name: destination.label,
                      })}
                      data-testid={`${TID}-${id}-${destination.id}`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {editing !== null && (
        <DestinationForm
          destination={editing === 'new' ? null : editing}
          saving={setMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={values =>
            setMutation.mutate({
              siteId,
              ...(editing !== 'new' ? { id: editing.id } : {}),
              ...values,
            })
          }
        />
      )}

      <ConfirmModal
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) removeMutation.mutate({ siteId, id: removing.id });
        }}
        title={t('operations:transferDestinations.removeTitle')}
        message={t('operations:transferDestinations.removeMessage', {
          name: removing?.label ?? '',
        })}
        confirmText={t('operations:transferDestinations.removeConfirm')}
        cancelText={t('common:actions.cancel')}
        variant="danger"
        loading={removeMutation.isPending}
      />
    </div>
  );
}

interface DestinationValues {
  kind: TransferDestinationKind;
  label: string | null;
  account: string;
  bankName: string | null;
  accountType: BankAccountType | null;
  holderName: string | null;
  holderId: string | null;
  qrPayload: string | null;
}

interface DestinationFormProps {
  destination: Destination | null;
  saving: boolean;
  onClose: () => void;
  onSave: (values: DestinationValues) => void;
}

const blankToNull = (value: string) => value.trim() || null;

function DestinationForm({ destination, saving, onClose, onSave }: DestinationFormProps) {
  const { t } = useTranslation(['operations', 'common']);
  const [kind, setKind] = useState<TransferDestinationKind>(destination?.kind ?? 'bre_b');
  const [account, setAccount] = useState(destination?.account ?? '');
  const [bankName, setBankName] = useState(destination?.bankName ?? '');
  const [accountType, setAccountType] = useState<BankAccountType | ''>(
    destination?.accountType ?? ''
  );
  const [holderName, setHolderName] = useState(destination?.holderName ?? '');
  const [holderId, setHolderId] = useState(destination?.holderId ?? '');
  const [qrPayload, setQrPayload] = useState(destination?.qrPayload ?? '');
  const [label, setLabel] = useState(destination ? customLabel(destination) : '');
  const [submitted, setSubmitted] = useState(false);

  const isBank = kind === 'bank_account';
  const normalizedAccount = normalizeTransferAccount(kind, account);
  const qr = qrPayload.trim();
  const errors = {
    account: normalizedAccount === null,
    bankName: isBank && !bankName.trim(),
    accountType: isBank && !accountType,
    qrPayload: qr !== '' && !isEmvcoQrPayload(qr),
  };
  const show = {
    account: errors.account && (submitted || account.trim() !== ''),
    bankName: errors.bankName && submitted,
    accountType: errors.accountType && submitted,
    qrPayload: errors.qrPayload,
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (normalizedAccount === null || Object.values(errors).some(Boolean)) return;
    onSave({
      kind,
      label: blankToNull(label),
      account: normalizedAccount,
      bankName: isBank ? blankToNull(bankName) : null,
      accountType: isBank && accountType ? accountType : null,
      holderName: blankToNull(holderName),
      holderId: blankToNull(holderId),
      qrPayload: qr || null,
    });
  };

  const error = (field: keyof typeof show, message: string) =>
    show[field] && (
      <p
        id={`${TID}-${field}-error`}
        className="text-xs text-danger-700"
        role="alert"
        data-testid={`${TID}-${field}-error`}
      >
        {message}
      </p>
    );
  const describedBy = (field: keyof typeof show) =>
    show[field] ? { 'aria-invalid': true, 'aria-describedby': `${TID}-${field}-error` } : {};

  return (
    <Modal
      isOpen
      onClose={saving ? () => undefined : onClose}
      title={t(`operations:transferDestinations.${destination ? 'editTitle' : 'addTitle'}`)}
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4" data-testid={`${TID}-form`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="pv-field">
            <label className="label" htmlFor={`${TID}-kind`}>
              {t('operations:transferDestinations.fields.kind')}
            </label>
            <select
              id={`${TID}-kind`}
              className="pv-input w-full"
              value={kind}
              onChange={event => setKind(event.target.value as TransferDestinationKind)}
              data-testid={`${TID}-kind`}
            >
              {TRANSFER_DESTINATION_KINDS.map(option => (
                <option key={option} value={option}>
                  {t(`operations:transferDestinations.kinds.${option}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="pv-field">
            <label className="label" htmlFor={`${TID}-account`}>
              {t(`operations:transferDestinations.fields.account.${kind}`)}
            </label>
            <input
              id={`${TID}-account`}
              className="input w-full"
              value={account}
              maxLength={LIMITS.account}
              inputMode={kind === 'bre_b' ? 'text' : 'numeric'}
              autoComplete="off"
              onChange={event => setAccount(event.target.value)}
              data-testid={`${TID}-account`}
              {...describedBy('account')}
            />
            {error('account', t(`operations:transferDestinations.errors.account.${kind}`))}
          </div>

          {isBank && (
            <>
              <div className="pv-field">
                <label className="label" htmlFor={`${TID}-bank-name`}>
                  {t('operations:transferDestinations.fields.bankName')}
                </label>
                <input
                  id={`${TID}-bank-name`}
                  className="input w-full"
                  value={bankName}
                  maxLength={LIMITS.bankName}
                  onChange={event => setBankName(event.target.value)}
                  data-testid={`${TID}-bank-name`}
                  {...describedBy('bankName')}
                />
                {error('bankName', t('operations:transferDestinations.errors.bankName'))}
              </div>
              <div className="pv-field">
                <label className="label" htmlFor={`${TID}-account-type`}>
                  {t('operations:transferDestinations.fields.accountType')}
                </label>
                <select
                  id={`${TID}-account-type`}
                  className="pv-input w-full"
                  value={accountType}
                  onChange={event => setAccountType(event.target.value as BankAccountType | '')}
                  data-testid={`${TID}-account-type`}
                  {...describedBy('accountType')}
                >
                  <option value="">{t('operations:transferDestinations.chooseAccountType')}</option>
                  {BANK_ACCOUNT_TYPES.map(option => (
                    <option key={option} value={option}>
                      {t(`operations:transferDestinations.accountTypes.${option}`)}
                    </option>
                  ))}
                </select>
                {error('accountType', t('operations:transferDestinations.errors.accountType'))}
              </div>
            </>
          )}

          <div className="pv-field">
            <label className="label" htmlFor={`${TID}-label`}>
              {t('operations:transferDestinations.fields.label')}
            </label>
            <input
              id={`${TID}-label`}
              className="input w-full"
              value={label}
              maxLength={LIMITS.label}
              placeholder={defaultTransferLabel(kind, blankToNull(bankName))}
              onChange={event => setLabel(event.target.value)}
              data-testid={`${TID}-label`}
            />
          </div>
          <div className="pv-field">
            <label className="label" htmlFor={`${TID}-holder-name`}>
              {t('operations:transferDestinations.fields.holderName')}
            </label>
            <input
              id={`${TID}-holder-name`}
              className="input w-full"
              value={holderName}
              maxLength={LIMITS.holderName}
              onChange={event => setHolderName(event.target.value)}
              data-testid={`${TID}-holder-name`}
            />
          </div>
          <div className="pv-field">
            <label className="label" htmlFor={`${TID}-holder-id`}>
              {t('operations:transferDestinations.fields.holderId')}
            </label>
            <input
              id={`${TID}-holder-id`}
              className="input w-full"
              value={holderId}
              maxLength={LIMITS.holderId}
              onChange={event => setHolderId(event.target.value)}
              data-testid={`${TID}-holder-id`}
            />
          </div>
        </div>

        <div className="pv-field">
          <label className="label" htmlFor={`${TID}-qr-payload`}>
            {t('operations:transferDestinations.fields.qrPayload')}
          </label>
          <input
            id={`${TID}-qr-payload`}
            className="input w-full font-mono"
            value={qrPayload}
            maxLength={LIMITS.qrPayload}
            autoComplete="off"
            spellCheck={false}
            onChange={event => setQrPayload(event.target.value)}
            onKeyDown={event => {
              // Scanners end the read with Enter; it must not save a half-filled form.
              if (event.key === 'Enter') event.preventDefault();
            }}
            aria-describedby={show.qrPayload ? `${TID}-qrPayload-error` : `${TID}-qr-payload-hint`}
            aria-invalid={show.qrPayload || undefined}
            data-testid={`${TID}-qr-payload`}
          />
          <p id={`${TID}-qr-payload-hint`} className="text-xs text-fg2">
            {t('operations:transferDestinations.qrHint')}
          </p>
          {error('qrPayload', t('operations:transferDestinations.errors.qrPayload'))}
          {qr.trim() !== '' && (
            <div className="mt-3 flex items-start gap-3 rounded-lg border border-secondary-200 bg-secondary-50 p-3">
              <TransferQrCode
                payload={qr.trim()}
                label={t('operations:transferDestinations.qrPreviewLabel')}
                className="transfer-qr"
                testId={`${TID}-qr-preview`}
              />
              <p className="text-xs text-fg2">
                {t('operations:transferDestinations.qrPreviewNote')}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            disabled={saving}
            onClick={onClose}
            data-testid={`${TID}-cancel`}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" disabled={saving} data-testid={`${TID}-save`}>
            {t('common:actions.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
