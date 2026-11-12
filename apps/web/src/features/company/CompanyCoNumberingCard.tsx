/**
 * DIAN numbering ranges per site, under the Colombian fiscal card.
 * Ranges are never edited: an admin registers, activates, retires or (before
 * the first number) deletes them.
 */
import { useMemo, useState } from 'react';
import { Hash, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { FiscalMaturityBadge } from '@/components/fiscal/FiscalMaturityBadge';
import { SimpleFormField } from '@/components/form-controls/FormField';
import { Modal } from '@/components/form-controls/Modal';
import { Badge, Button } from '@/components/ui';
import type { BadgeVariant } from '@/components/ui/Badge';
import { onErrorToast } from '@/lib/mutationHelpers';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { numberingDocumentNumber } from './coNumbering';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type NumberingRange = RouterOutputs['fiscalNumbering']['list'][number];
type NumberingUsage = RouterOutputs['fiscalNumbering']['usage'][number];

const STATUS_VARIANT: Record<NumberingRange['status'], BadgeVariant> = {
  active: 'success',
  scheduled: 'info',
  exhausted: 'neutral',
  expired: 'neutral',
  retired: 'neutral',
};

const DAY_MS = 86_400_000;
const BOGOTA = 'America/Bogota';

/** Registration form values, kept as strings until submit. */
interface RangeDraft {
  kind: 'DEE' | 'FEV';
  siteId: string;
  resolutionNumber: string;
  resolutionDate: string;
  prefix: string;
  fromNumber: string;
  toNumber: string;
  validFrom: string;
  validUntil: string;
  technicalKey: string;
  environment: 'habilitacion' | 'produccion';
}

function emptyDraft(siteId: string, environment: RangeDraft['environment']): RangeDraft {
  return {
    kind: 'DEE',
    siteId,
    resolutionNumber: '',
    resolutionDate: '',
    prefix: '',
    fromNumber: '',
    toNumber: '',
    validFrom: '',
    validUntil: '',
    technicalKey: '',
    environment,
  };
}

function daysUntil(iso: string): number {
  return Math.floor((Date.parse(iso) - Date.now()) / DAY_MS);
}

export function CompanyCoNumberingCard() {
  const { t, i18n } = useTranslation(['fiscal', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const rangesQuery = trpc.fiscalNumbering.list.useQuery();
  const usageQuery = trpc.fiscalNumbering.usage.useQuery();
  const sitesQuery = trpc.sites.list.useQuery();
  const settingsQuery = trpc.fiscalSettings.getByCountry.useQuery({ countryCode: 'CO' });
  const tenantEnvironment =
    settingsQuery.data?.countryCode === 'CO'
      ? settingsQuery.data.settings.environment
      : 'habilitacion';

  const [draft, setDraft] = useState<RangeDraft | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [retiring, setRetiring] = useState<NumberingRange | null>(null);
  const [retireReason, setRetireReason] = useState('');
  const [removing, setRemoving] = useState<NumberingRange | null>(null);

  const refresh = async () => {
    await Promise.all([
      utils.fiscalNumbering.list.invalidate(),
      utils.fiscalNumbering.usage.invalidate(),
      utils.setupReadiness.get.invalidate(),
      utils.setupReadiness.checkout.invalidate(),
    ]);
  };
  const errorToast = onErrorToast(toast, t, { titleKey: 'fiscal:numbering.toast.error' });
  const createMutation = trpc.fiscalNumbering.create.useMutation({
    onSuccess: async result => {
      toast.success({
        title:
          result.status === 'active'
            ? t('fiscal:numbering.toast.createdActive')
            : t('fiscal:numbering.toast.createdScheduled'),
      });
      setDraft(null);
      setConfirming(false);
      await refresh();
    },
    onError: errorToast,
  });
  const activateMutation = trpc.fiscalNumbering.activate.useMutation({
    onSuccess: async () => {
      toast.success({ title: t('fiscal:numbering.toast.activated') });
      await refresh();
    },
    onError: errorToast,
  });
  const retireMutation = trpc.fiscalNumbering.retire.useMutation({
    onSuccess: async () => {
      toast.success({ title: t('fiscal:numbering.toast.retired') });
      setRetiring(null);
      setRetireReason('');
      await refresh();
    },
    onError: errorToast,
  });
  const removeMutation = trpc.fiscalNumbering.remove.useMutation({
    onSuccess: async () => {
      toast.success({ title: t('fiscal:numbering.toast.removed') });
      setRemoving(null);
      await refresh();
    },
    onError: errorToast,
  });

  const ranges = useMemo(() => rangesQuery.data ?? [], [rangesQuery.data]);
  const usageById = useMemo(
    () => new Map<string, NumberingUsage>((usageQuery.data ?? []).map(u => [u.rangeId, u])),
    [usageQuery.data]
  );
  const sites = sitesQuery.data?.items ?? [];
  const bySite = useMemo(() => {
    const groups = new Map<string, { siteName: string; rows: NumberingRange[] }>();
    for (const range of ranges) {
      const group = groups.get(range.siteId) ?? { siteName: range.siteName, rows: [] };
      group.rows.push(range);
      groups.set(range.siteId, group);
    }
    return [...groups.entries()];
  }, [ranges]);

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: BOGOTA }).format(
      new Date(iso)
    );

  const openForm = () => {
    setConfirming(false);
    setDraft(emptyDraft(sites[0]?.id ?? '', tenantEnvironment));
  };
  const update = <K extends keyof RangeDraft>(key: K, value: RangeDraft[K]) =>
    setDraft(current => (current ? { ...current, [key]: value } : current));

  const submitDraft = () => {
    if (!draft) return;
    createMutation.mutate({
      siteId: draft.siteId,
      kind: draft.kind,
      resolutionNumber: draft.resolutionNumber.trim(),
      resolutionDate: draft.resolutionDate,
      prefix: draft.prefix.trim().toUpperCase(),
      fromNumber: Number(draft.fromNumber),
      toNumber: Number(draft.toNumber),
      validFrom: draft.validFrom,
      validUntil: draft.validUntil,
      environment: draft.environment,
      ...(draft.kind === 'FEV' ? { technicalKey: draft.technicalKey.trim() } : {}),
    });
  };

  const draftComplete =
    draft !== null &&
    draft.siteId !== '' &&
    draft.resolutionNumber.trim() !== '' &&
    draft.resolutionDate !== '' &&
    Number(draft.fromNumber) >= 1 &&
    Number(draft.toNumber) >= Number(draft.fromNumber) &&
    draft.validFrom !== '' &&
    draft.validUntil !== '' &&
    (draft.kind === 'DEE' || draft.technicalKey.trim() !== '');

  return (
    <section className="card space-y-5 p-6" data-testid="fiscal-co-numbering">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="glyph-tile glyph-tile-primary h-11 w-11">
            <Hash className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <div className="pv-kicker">{t('fiscal:numbering.kicker')}</div>
            <h2 className="pv-title text-lg">{t('fiscal:numbering.title')}</h2>
          </div>
          {settingsQuery.data?.maturity && (
            <FiscalMaturityBadge maturity={settingsQuery.data.maturity} />
          )}
        </div>
        {ranges.length > 0 && (
          <Button variant="outline" size="compact" onClick={openForm}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('fiscal:numbering.actions.register')}
          </Button>
        )}
      </div>

      {rangesQuery.isSuccess && ranges.length === 0 && (
        <div className="flex flex-col items-start gap-3" data-testid="fiscal-co-numbering-empty">
          <p className="text-sm font-medium text-secondary-900">{t('fiscal:numbering.empty')}</p>
          <Button onClick={openForm}>{t('fiscal:numbering.actions.register')}</Button>
        </div>
      )}

      {bySite.map(([siteId, group]) => (
        <div key={siteId} className="space-y-2">
          <h3 className="text-sm font-semibold text-secondary-900">{group.siteName}</h3>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="min-w-full text-left text-sm">
              <caption className="sr-only">
                {t('fiscal:numbering.table.caption', { site: group.siteName })}
              </caption>
              <thead className="bg-surface-2 text-xs uppercase tracking-wide text-secondary-500">
                <tr>
                  <th className="px-3 py-2 font-semibold" scope="col">
                    {t('fiscal:numbering.table.kind')}
                  </th>
                  <th className="px-3 py-2 font-semibold" scope="col">
                    {t('fiscal:numbering.table.range')}
                  </th>
                  <th className="px-3 py-2 font-semibold" scope="col">
                    {t('fiscal:numbering.table.usage')}
                  </th>
                  <th className="px-3 py-2 font-semibold" scope="col">
                    {t('fiscal:numbering.table.validity')}
                  </th>
                  <th className="px-3 py-2 font-semibold" scope="col">
                    {t('fiscal:numbering.table.status')}
                  </th>
                  <th className="px-3 py-2 font-semibold" scope="col">
                    <span className="sr-only">{t('fiscal:numbering.table.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {group.rows.map(range => {
                  const usage = usageById.get(range.id);
                  const size = range.toNumber - range.fromNumber + 1;
                  const used = size - range.remaining;
                  const days = daysUntil(range.validUntil);
                  const open = range.status === 'active' || range.status === 'scheduled';
                  const unused = range.currentNumber === range.fromNumber - 1;
                  return (
                    <tr key={range.id} data-testid={`numbering-row-${range.id}`}>
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-secondary-900">
                          {t(`fiscal:numbering.kind.${range.kind}`)}
                        </div>
                        <div className="text-xs text-secondary-500">
                          {t(`fiscal:numbering.environment.${range.environment}`)}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top tabular-nums">
                        <div>
                          {range.prefix || '—'} {range.fromNumber}–{range.toNumber}
                        </div>
                        <div className="text-xs text-secondary-500">
                          {t('fiscal:numbering.table.resolution', {
                            number: range.resolutionNumber,
                          })}
                        </div>
                      </td>
                      <td className="min-w-40 px-3 py-2 align-top">
                        <div
                          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={size}
                          aria-valuenow={used}
                          aria-label={t('fiscal:numbering.table.usage')}
                        >
                          <div
                            className="h-full rounded-full bg-primary-500"
                            style={{ width: `${size > 0 ? (used / size) * 100 : 0}%` }}
                          />
                        </div>
                        <div className="mt-1 text-xs text-secondary-600 tabular-nums">
                          {t('fiscal:numbering.table.remaining', { count: range.remaining })}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div>{formatDate(range.validUntil)}</div>
                        {open && (
                          <div className="text-xs text-secondary-600">
                            {days >= 0
                              ? t('fiscal:numbering.table.expiresIn', { count: days })
                              : t('fiscal:numbering.table.expired')}
                          </div>
                        )}
                      </td>
                      <td className="space-y-1 px-3 py-2 align-top">
                        <Badge variant={STATUS_VARIANT[range.status]}>
                          {t(`fiscal:numbering.status.${range.status}`)}
                        </Badge>
                        {usage?.alert && (
                          <p
                            className={cn(
                              'max-w-56 text-xs font-medium',
                              usage.alert.level === 'critical'
                                ? 'text-danger-700'
                                : 'text-warning-700'
                            )}
                            data-testid={`numbering-alert-${range.id}`}
                          >
                            {t(
                              `fiscal:numbering.alert.${usage.alert.reason}${
                                usage.hasScheduledSuccessor ? '' : 'NoSuccessor'
                              }`,
                              {
                                days: Math.max(0, usage.daysUntilExpiry),
                                count: usage.remaining,
                              }
                            )}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right align-top">
                        <div className="flex justify-end gap-2">
                          {range.status === 'scheduled' &&
                            range.environment === tenantEnvironment && (
                              <Button
                                variant="outline"
                                size="compact"
                                disabled={activateMutation.isPending}
                                onClick={() => activateMutation.mutate({ id: range.id })}
                              >
                                {t('fiscal:numbering.actions.activate')}
                              </Button>
                            )}
                          {open && unused && range.issuedCount === 0 ? (
                            <Button
                              variant="ghost"
                              size="compact"
                              onClick={() => setRemoving(range)}
                            >
                              {t('fiscal:numbering.actions.remove')}
                            </Button>
                          ) : (
                            open && (
                              <Button
                                variant="ghost"
                                size="compact"
                                onClick={() => setRetiring(range)}
                              >
                                {t('fiscal:numbering.actions.retire')}
                              </Button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <Modal
        isOpen={draft !== null}
        onClose={() => setDraft(null)}
        title={confirming ? t('fiscal:numbering.confirm.title') : t('fiscal:numbering.form.title')}
        size="lg"
        footer={
          confirming ? (
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t('common:actions.back', { defaultValue: 'Back' })}
              </Button>
              <Button onClick={submitDraft} disabled={createMutation.isPending}>
                {t('fiscal:numbering.actions.save')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                {t('common:actions.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button disabled={!draftComplete} onClick={() => setConfirming(true)}>
                {t('fiscal:numbering.actions.review')}
              </Button>
            </>
          )
        }
      >
        {draft && confirming && (
          <div className="space-y-3" data-testid="numbering-confirm">
            <p className="text-sm text-secondary-700">
              {t('fiscal:numbering.confirm.firstNumber')}
            </p>
            <p className="font-mono text-lg font-semibold text-secondary-950">
              {numberingDocumentNumber(draft.prefix.trim().toUpperCase(), Number(draft.fromNumber))}
            </p>
            <p className="text-sm text-secondary-700">{t('fiscal:numbering.confirm.immutable')}</p>
          </div>
        )}
        {draft && !confirming && (
          <div className="grid gap-4 sm:grid-cols-2" data-testid="numbering-form">
            <SimpleFormField label={t('fiscal:numbering.form.kind')} htmlFor="numbering-kind">
              <select
                id="numbering-kind"
                className="pv-input"
                value={draft.kind}
                onChange={event => update('kind', event.target.value as RangeDraft['kind'])}
              >
                <option value="DEE">{t('fiscal:numbering.kind.DEE')}</option>
                <option value="FEV">{t('fiscal:numbering.kind.FEV')}</option>
              </select>
            </SimpleFormField>
            <SimpleFormField label={t('fiscal:numbering.form.site')} htmlFor="numbering-site">
              <select
                id="numbering-site"
                className="pv-input"
                value={draft.siteId}
                onChange={event => update('siteId', event.target.value)}
              >
                {sites.map(site => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </SimpleFormField>
            <SimpleFormField
              label={t('fiscal:numbering.form.resolutionNumber')}
              htmlFor="numbering-resolution"
            >
              <input
                id="numbering-resolution"
                className="pv-input"
                maxLength={40}
                value={draft.resolutionNumber}
                onChange={event => update('resolutionNumber', event.target.value)}
              />
            </SimpleFormField>
            <SimpleFormField
              label={t('fiscal:numbering.form.resolutionDate')}
              htmlFor="numbering-resolution-date"
            >
              <input
                id="numbering-resolution-date"
                type="date"
                className="pv-input"
                value={draft.resolutionDate}
                onChange={event => update('resolutionDate', event.target.value)}
              />
            </SimpleFormField>
            <SimpleFormField label={t('fiscal:numbering.form.prefix')} htmlFor="numbering-prefix">
              <input
                id="numbering-prefix"
                className="pv-input uppercase"
                maxLength={4}
                value={draft.prefix}
                onChange={event => update('prefix', event.target.value.toUpperCase())}
              />
            </SimpleFormField>
            <div className="grid grid-cols-2 gap-3">
              <SimpleFormField label={t('fiscal:numbering.form.from')} htmlFor="numbering-from">
                <input
                  id="numbering-from"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className="pv-input"
                  value={draft.fromNumber}
                  onChange={event => update('fromNumber', event.target.value)}
                />
              </SimpleFormField>
              <SimpleFormField label={t('fiscal:numbering.form.to')} htmlFor="numbering-to">
                <input
                  id="numbering-to"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className="pv-input"
                  value={draft.toNumber}
                  onChange={event => update('toNumber', event.target.value)}
                />
              </SimpleFormField>
            </div>
            <SimpleFormField
              label={t('fiscal:numbering.form.validFrom')}
              htmlFor="numbering-valid-from"
            >
              <input
                id="numbering-valid-from"
                type="date"
                className="pv-input"
                value={draft.validFrom}
                onChange={event => update('validFrom', event.target.value)}
              />
            </SimpleFormField>
            <SimpleFormField
              label={t('fiscal:numbering.form.validUntil')}
              htmlFor="numbering-valid-until"
            >
              <input
                id="numbering-valid-until"
                type="date"
                className="pv-input"
                value={draft.validUntil}
                onChange={event => update('validUntil', event.target.value)}
              />
            </SimpleFormField>
            {draft.kind === 'FEV' && (
              <SimpleFormField
                label={t('fiscal:numbering.form.technicalKey')}
                htmlFor="numbering-technical-key"
              >
                <input
                  id="numbering-technical-key"
                  className="pv-input font-mono"
                  autoComplete="off"
                  value={draft.technicalKey}
                  onChange={event => update('technicalKey', event.target.value)}
                />
              </SimpleFormField>
            )}
            <SimpleFormField
              label={t('fiscal:numbering.form.environment')}
              htmlFor="numbering-environment"
            >
              <select
                id="numbering-environment"
                className="pv-input"
                value={draft.environment}
                onChange={event =>
                  update('environment', event.target.value as RangeDraft['environment'])
                }
              >
                <option value="habilitacion">
                  {t('fiscal:numbering.environment.habilitacion')}
                </option>
                <option value="produccion">{t('fiscal:numbering.environment.produccion')}</option>
              </select>
            </SimpleFormField>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={retiring !== null}
        onClose={() => setRetiring(null)}
        title={t('fiscal:numbering.retire.title')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRetiring(null)}>
              {t('common:actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="danger"
              disabled={retireReason.trim() === '' || retireMutation.isPending}
              onClick={() =>
                retiring && retireMutation.mutate({ id: retiring.id, reason: retireReason.trim() })
              }
            >
              {t('fiscal:numbering.actions.retire')}
            </Button>
          </>
        }
      >
        <SimpleFormField label={t('fiscal:numbering.retire.reason')} htmlFor="numbering-retire">
          <textarea
            id="numbering-retire"
            className="pv-input"
            rows={3}
            maxLength={500}
            value={retireReason}
            onChange={event => setRetireReason(event.target.value)}
          />
        </SimpleFormField>
      </Modal>

      <Modal
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('fiscal:numbering.remove.title')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              {t('common:actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="danger"
              disabled={removeMutation.isPending}
              onClick={() => removing && removeMutation.mutate({ id: removing.id })}
            >
              {t('fiscal:numbering.actions.remove')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-secondary-700">
          {removing &&
            t('fiscal:numbering.remove.body', {
              range: `${removing.prefix} ${removing.fromNumber}–${removing.toNumber}`,
            })}
        </p>
      </Modal>
    </section>
  );
}
