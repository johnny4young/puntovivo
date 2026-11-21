import { useTranslation } from 'react-i18next';
import {
  DEFAULT_REGISTER_ZONES,
  REGISTER_ZONES,
  resolveRegisterZones,
  sanitizeRegisterZoneOverrides,
  type RegisterZoneDescriptor,
} from '@puntovivo/shared/register-zones';
import { isVerticalPresetId, type VerticalPresetId } from '@puntovivo/shared/vertical-presets';

import { useToast } from '@/components/feedback/ToastProvider';
import { Badge } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useModulesSnapshot } from '@/features/modules';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

// Keyed in the design matrix's column order.
const PROFILE_COLUMNS = Object.keys(DEFAULT_REGISTER_ZONES) as VerticalPresetId[];

const MODULE_LABEL_KEY = {
  'dine-in': 'items.dineIn.label',
  quotations: 'items.quotations.label',
} as const;

const CELL = 'border-t border-line/70 px-1 text-center';
const OWN = 'bg-primary-50';

function ZoneMark({ on, label }: { on: boolean; label: string }) {
  return on ? (
    <span className="inline-block h-3 w-3 rounded-full bg-primary" role="img" aria-label={label} />
  ) : (
    <span className="text-fg2" role="img" aria-label={label}>
      –
    </span>
  );
}

/** Register zones per business profile; the tenant's own column is switchable by admins. */
export function CompanyRegisterZonesCard() {
  const { t } = useTranslation('modules');
  const toast = useToast();
  const { tenant, updateTenantSettings } = useAuth();
  const { modules } = useModulesSnapshot();

  const storedType = tenant?.settings.businessType;
  // An unknown stored profile resolves like no profile, so it gets the own column too.
  const businessType = isVerticalPresetId(storedType) ? storedType : null;
  const overrides = sanitizeRegisterZoneOverrides(tenant?.settings.registerZones);
  const zones = resolveRegisterZones(businessType, overrides);
  // Without a profile the tenant gets a column of its own in front of the profiles.
  const columns: Array<VerticalPresetId | null> =
    businessType === null ? [null, ...PROFILE_COLUMNS] : PROFILE_COLUMNS;

  const setZone = trpc.registerZones.set.useMutation({
    onSuccess: result => updateTenantSettings({ registerZones: result.overrides }),
    onError: onErrorToast(toast, t, { titleKey: 'zones.error' }),
  });

  const stateLabel = (on: boolean) => t(on ? 'zones.on' : 'zones.off');

  function ownCell(zone: RegisterZoneDescriptor, moduleOff: boolean) {
    const on = zones[zone.id] && !moduleOff;
    if (!zone.switchable) return <ZoneMark on={on} label={stateLabel(on)} />;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={t(`zones.items.${zone.id}`)}
        disabled={moduleOff || setZone.isPending}
        onClick={() => setZone.mutate({ zoneId: zone.id, enabled: !on })}
        className={cn('pv-switch disabled:cursor-not-allowed disabled:opacity-60', on && 'on')}
        data-testid={`register-zone-toggle-${zone.id}`}
      />
    );
  }

  return (
    <section className="card space-y-4 p-6" data-testid="register-zones-card">
      <h2 className="text-lg font-semibold text-secondary-950">{t('zones.title')}</h2>

      <div className="-mx-2 overflow-x-auto px-2">
        <table className="w-full min-w-[760px] table-fixed border-separate border-spacing-0 text-sm">
          <colgroup>
            <col />
            {columns.map(column => (
              <col key={column ?? 'own'} className="w-[76px]" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                {t('zones.zoneColumn')}
              </th>
              {columns.map(column => {
                const own = column === businessType;
                return (
                  <th
                    key={column ?? 'own'}
                    scope="col"
                    className={cn(
                      'px-1 pb-2 pt-3 align-bottom text-xs leading-tight',
                      own ? cn('rounded-t-xl font-bold text-fg1', OWN) : 'font-semibold text-fg2'
                    )}
                    aria-current={own ? 'true' : undefined}
                    data-testid={own ? 'register-zones-own-column' : undefined}
                  >
                    {column === null ? t('zones.ownColumn') : t(`presets.verticals.${column}`)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {REGISTER_ZONES.map(zone => {
              const moduleOff = zone.requiresModule !== null && !modules[zone.requiresModule];
              const unavailable = !zone.locked && !zone.switchable;
              return (
                <tr key={zone.id} data-testid={`register-zone-row-${zone.id}`}>
                  <th scope="row" className="border-t border-line/70 py-2.5 pr-3 text-left">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-fg1">
                      {t(`zones.items.${zone.id}`)}
                      {overrides[zone.id] !== undefined && (
                        <Badge variant="neutral">{t('toggle.explicit')}</Badge>
                      )}
                      {unavailable && <Badge variant="warning">{t('toggle.unavailable')}</Badge>}
                    </span>
                    {moduleOff && zone.switchable && zone.requiresModule && (
                      <span className="block text-xs font-normal text-fg2">
                        {t('zones.requiresModule', {
                          module: t(MODULE_LABEL_KEY[zone.requiresModule]),
                        })}
                      </span>
                    )}
                  </th>
                  {columns.map(column => {
                    if (column === businessType) {
                      return (
                        <td key={column ?? 'own'} className={cn(CELL, OWN)}>
                          {ownCell(zone, moduleOff)}
                        </td>
                      );
                    }
                    const on = column !== null && DEFAULT_REGISTER_ZONES[column][zone.id];
                    return (
                      <td key={column ?? 'own'} className={CELL}>
                        <ZoneMark on={on} label={stateLabel(on)} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
