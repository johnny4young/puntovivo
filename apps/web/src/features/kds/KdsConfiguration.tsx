/** Manager-owned station/routing editor. Explicit saves never rewrite sent preparations. */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { resolveStationLabel } from './stationLabel';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useKitchenOnline } from './useKitchenOnline';
import type { KitchenOutputs } from './types';
const fieldClass = 'min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-ink';
const buttonClass = 'min-h-11 rounded-lg border border-line-strong px-3 py-2 disabled:opacity-50';
/** Snapshot of the station generation when the manager opens the edit form. */
type StationDraft = {
  code: string;
  name: string;
  isActive: boolean;
  position: number;
  expectedVersion: number;
  printerMode: 'none' | 'site_printer' | 'tcp';
  printerHost: string;
  printerPort: number;
  printerPaperWidth: '58mm' | '80mm';
  printerCharacterSet: 'cp858' | 'cp437' | 'cp850' | 'pc858_euro';
  printerCopies: number;
};
const newStation = (): StationDraft => ({
  code: '',
  name: '',
  isActive: true,
  position: 0,
  expectedVersion: 0,
  printerMode: 'none',
  printerHost: '',
  printerPort: 9100,
  printerPaperWidth: '80mm',
  printerCharacterSet: 'cp858',
  printerCopies: 1,
});
export function KdsConfiguration({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const { t } = useTranslation('kds');
  const toast = useToast();
  const utils = trpc.useUtils();
  const online = useKitchenOnline();
  const stations = trpc.kds.stations.useQuery({ siteId });
  const [draft, setDraft] = useState<StationDraft>(newStation);
  const [kind, setKind] = useState<'product' | 'category'>('product');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [configuredOnly, setConfiguredOnly] = useState(false);
  const save = trpc.kds.saveStation.useMutation({
    onSuccess: () => {
      setDraft(newStation());
      toast.success({ title: t('config.saved') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'config.saveError' }),
    onSettled: async () => {
      await utils.kds.stations.invalidate();
    },
  });
  const unavailable = !online || stations.isError || save.isPending;
  return (
    <Modal isOpen onClose={onClose} title={t('config.title')} size="xl">
      <div className="flex flex-col gap-6">
        <p>{t('config.description')}</p>
        {!online && <p role="status">{t('errors.offline')}</p>}
        {stations.isError && <p role="alert">{t('config.loadError')}</p>}
        <section aria-label={t('config.stations')} className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold">{t('config.stations')}</h3>
          {stations.isLoading && <p role="status">{t('config.loading')}</p>}
          <ul className="flex flex-col gap-2">
            {(stations.data ?? []).map(station => (
              <li key={station.id} className="flex items-center justify-between gap-3">
                <span>
                  {resolveStationLabel(station, t('station.main'))} · {station.code} ·{' '}
                  {t(station.isActive ? 'config.active' : 'config.inactive')}
                  {station.printerConfig?.mode === 'site_printer'
                    ? ` · ${t('config.printerTagSite')}`
                    : station.printerConfig?.mode === 'tcp' && station.printerConfig.host
                      ? ` · ${t('config.printerTagTcp', {
                          host: station.printerConfig.host,
                          port: station.printerConfig.port ?? 9100,
                        })}`
                      : ''}
                </span>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={unavailable}
                  onClick={() =>
                    setDraft({
                      code: station.code,
                      name: station.name,
                      isActive: station.isActive,
                      position: station.position,
                      expectedVersion: station.version,
                      printerMode: station.printerConfig?.mode ?? 'none',
                      printerHost: station.printerConfig?.host ?? '',
                      printerPort: station.printerConfig?.port ?? 9100,
                      printerPaperWidth: station.printerConfig?.paperWidth ?? '80mm',
                      printerCharacterSet: station.printerConfig?.characterSet ?? 'cp858',
                      printerCopies: station.printerConfig?.copies ?? 1,
                    })
                  }
                >
                  {t('config.edit', { name: station.name })}
                </button>
              </li>
            ))}
          </ul>
          {!stations.isLoading &&
            !stations.isError &&
            !stations.data?.some(station => station.code === 'main') && (
              <button
                type="button"
                className={buttonClass}
                disabled={unavailable}
                onClick={() => setDraft({ ...newStation(), code: 'main', name: t('station.main') })}
              >
                {t('config.configureMain')}
              </button>
            )}
          <form
            onSubmit={event => {
              event.preventDefault();
              if (unavailable) return;
              save.mutate({
                siteId,
                code: draft.code,
                name: draft.name,
                isActive: draft.isActive,
                position: draft.position,
                expectedVersion: draft.expectedVersion,
                printerConfig:
                  draft.printerMode === 'none'
                    ? null
                    : {
                        mode: draft.printerMode,
                        ...(draft.printerMode === 'tcp'
                          ? { host: draft.printerHost.trim(), port: draft.printerPort }
                          : {}),
                        paperWidth: draft.printerPaperWidth,
                        characterSet: draft.printerCharacterSet,
                        copies: draft.printerCopies,
                      },
              });
            }}
          >
            <fieldset
              disabled={unavailable}
              className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2"
            >
              <legend className="px-2 font-semibold">
                {t(draft.expectedVersion ? 'config.editStation' : 'config.newStation')}
              </legend>
              <label>
                {t('config.code')}
                <input
                  className={fieldClass}
                  required
                  maxLength={80}
                  pattern={'[a-z0-9][a-z0-9_\\-]*'}
                  value={draft.code}
                  disabled={draft.expectedVersion > 0}
                  onChange={event => setDraft({ ...draft, code: event.target.value })}
                />
              </label>
              <label>
                {t('config.name')}
                <input
                  className={fieldClass}
                  required
                  maxLength={120}
                  value={draft.name}
                  onChange={event => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label>
                {t('config.position')}
                <input
                  type="number"
                  className={fieldClass}
                  required
                  min={0}
                  max={999}
                  step={1}
                  value={draft.position}
                  onChange={event => setDraft({ ...draft, position: Number(event.target.value) })}
                />
              </label>
              <label>
                {t('config.printerMode')}
                <select
                  className={fieldClass}
                  value={draft.printerMode}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      printerMode: event.target.value as StationDraft['printerMode'],
                    })
                  }
                  data-testid="kds-station-printer-mode"
                >
                  <option value="none">{t('config.printerNone')}</option>
                  <option value="site_printer">{t('config.printerSite')}</option>
                  <option value="tcp">{t('config.printerTcp')}</option>
                </select>
              </label>
              {draft.printerMode === 'tcp' && (
                <>
                  <label>
                    {t('config.printerHost')}
                    <input
                      className={fieldClass}
                      required
                      maxLength={253}
                      placeholder="192.168.1.50"
                      value={draft.printerHost}
                      onChange={event => setDraft({ ...draft, printerHost: event.target.value })}
                      data-testid="kds-station-printer-host"
                    />
                  </label>
                  <label>
                    {t('config.printerPort')}
                    <input
                      type="number"
                      className={fieldClass}
                      required
                      min={9100}
                      max={9103}
                      step={1}
                      value={draft.printerPort}
                      onChange={event =>
                        setDraft({ ...draft, printerPort: Number(event.target.value) || 9100 })
                      }
                      data-testid="kds-station-printer-port"
                    />
                  </label>
                </>
              )}
              {draft.printerMode !== 'none' && (
                <>
                  <label>
                    {t('config.printerPaperWidth')}
                    <select
                      className={fieldClass}
                      value={draft.printerPaperWidth}
                      onChange={event =>
                        setDraft({
                          ...draft,
                          printerPaperWidth: event.target.value as '58mm' | '80mm',
                        })
                      }
                      data-testid="kds-station-printer-width"
                    >
                      <option value="80mm">80mm</option>
                      <option value="58mm">58mm</option>
                    </select>
                  </label>
                  <label>
                    {t('config.printerCopies')}
                    <input
                      type="number"
                      className={fieldClass}
                      min={1}
                      max={3}
                      step={1}
                      value={draft.printerCopies}
                      onChange={event =>
                        setDraft({
                          ...draft,
                          printerCopies: Math.max(1, Math.min(3, Number(event.target.value) || 1)),
                        })
                      }
                      data-testid="kds-station-printer-copies"
                    />
                  </label>
                </>
              )}
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  disabled={draft.code === 'main'}
                  onChange={event => setDraft({ ...draft, isActive: event.target.checked })}
                />
                {t('config.active')}
              </label>
              <button type="submit" className={buttonClass}>
                {t('config.saveStation')}
              </button>
              <button type="button" className={buttonClass} onClick={() => setDraft(newStation())}>
                {t('config.clear')}
              </button>
            </fieldset>
          </form>
        </section>
        <section aria-label={t('config.routing')} className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold">{t('config.routing')}</h3>
          <p>{t('config.precedence')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              {t('config.targetKind')}
              <select
                className={fieldClass}
                value={kind}
                onChange={event => setKind(event.target.value as typeof kind)}
              >
                <option value="product">{t('config.product')}</option>
                <option value="category">{t('config.category')}</option>
              </select>
            </label>
            <label>
              {t('config.search')}
              <input
                type="search"
                className={fieldClass}
                maxLength={120}
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={configuredOnly}
                onChange={event => setConfiguredOnly(event.target.checked)}
              />
              {t('config.configuredOnly')}
            </label>
          </div>
          <RoutingTargets
            key={`${kind}:${debouncedSearch}:${configuredOnly}`}
            siteId={siteId}
            kind={kind}
            search={debouncedSearch}
            configuredOnly={configuredOnly}
            stations={stations.data ?? []}
            disabled={unavailable || stations.isLoading || search !== debouncedSearch}
          />
        </section>
      </div>
    </Modal>
  );
}
/** Keyset pagination avoids loading a whole large catalog into the renderer. */
function RoutingTargets({
  siteId,
  kind,
  search,
  configuredOnly,
  stations,
  disabled,
}: {
  siteId: string;
  kind: 'product' | 'category';
  search: string;
  configuredOnly: boolean;
  stations: KitchenOutputs['stations'];
  disabled: boolean;
}) {
  const { t } = useTranslation('kds');
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const cursor = pages.at(-1);
  const query = trpc.kds.routingTargets.useQuery({
    siteId,
    targetKind: kind,
    search,
    configuredOnly,
    ...(cursor ? { cursor } : {}),
  });
  return (
    <div className="flex flex-col gap-3">
      {query.isLoading ? (
        <p role="status">{t('config.loading')}</p>
      ) : query.isError ? (
        <p role="alert">{t('config.loadError')}</p>
      ) : query.data?.items.length === 0 ? (
        <p>{t('config.noTargets')}</p>
      ) : null}
      {!query.isError &&
        query.data?.items.map(target => (
          <RoutingTarget
            key={`${target.id}:${target.rule?.id}:${target.rule?.version}`}
            siteId={siteId}
            kind={kind}
            target={target}
            stations={stations}
            disabled={disabled}
          />
        ))}
      <div className="flex gap-3">
        <button
          type="button"
          className={buttonClass}
          disabled={pages.length === 1 || query.isFetching}
          onClick={() => setPages(pages.slice(0, -1))}
        >
          {t('config.previous')}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!query.data?.nextCursor || query.isFetching}
          onClick={() => setPages([...pages, query.data!.nextCursor!])}
        >
          {t('config.next')}
        </button>
      </div>
    </div>
  );
}
/** Each save carries both row identity and observed version, including deletion/recreation. */
function RoutingTarget({
  siteId,
  kind,
  target,
  stations,
  disabled,
}: {
  siteId: string;
  kind: 'product' | 'category';
  target: KitchenOutputs['routingTargets']['items'][number];
  stations: KitchenOutputs['stations'];
  disabled: boolean;
}) {
  const { t } = useTranslation('kds');
  const toast = useToast();
  const utils = trpc.useUtils();
  const initial =
    target.rule?.route === 'exclude' ? 'exclude' : (target.rule?.stationId ?? 'inherit');
  const [route, setRoute] = useState(initial);
  const options = {
    onError: onErrorToast(toast, t, { titleKey: 'config.saveError' }),
    onSuccess: () => toast.success({ title: t('config.saved') }),
    onSettled: async () => {
      await utils.kds.routingTargets.invalidate();
    },
  };
  const save = trpc.kds.saveRoutingRule.useMutation(options);
  const remove = trpc.kds.removeRoutingRule.useMutation(options);
  const pending = save.isPending || remove.isPending;
  const observed = {
    siteId,
    targetKind: kind,
    targetId: target.id,
    expectedVersion: target.rule?.version ?? 0,
    expectedRuleId: target.rule?.id ?? null,
  };
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        if (disabled || pending) return;
        if (route === 'inherit') remove.mutate(observed);
        else
          save.mutate({
            ...observed,
            route: route === 'exclude' ? 'exclude' : 'station',
            stationId: route === 'exclude' ? null : route,
          });
      }}
    >
      <fieldset
        disabled={disabled || pending}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-line p-3"
      >
        <label className="min-w-48 flex-1">
          {target.name}
          <select
            className={fieldClass}
            value={route}
            onChange={event => setRoute(event.target.value)}
          >
            <option value="inherit">
              {t(kind === 'product' ? 'config.inheritProduct' : 'config.inheritCategory')}
            </option>
            <option value="exclude">{t('config.exclude')}</option>
            {stations.map(station => (
              <option key={station.id} value={station.id} disabled={!station.isActive}>
                {resolveStationLabel(station, t('station.main'))}
                {station.isActive ? '' : ` (${t('config.inactive')})`}
              </option>
            ))}
            {target.rule?.stationId &&
              !stations.some(station => station.id === target.rule?.stationId) && (
                <option value={target.rule.stationId} disabled>
                  {t('config.unavailableStation')}
                </option>
              )}
          </select>
        </label>
        <button
          type="submit"
          className={buttonClass}
          disabled={disabled || pending || route === initial}
        >
          {t('config.saveRoute')}
        </button>
      </fieldset>
    </form>
  );
}
