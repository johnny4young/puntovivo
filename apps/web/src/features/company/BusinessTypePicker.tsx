import { useTranslation } from 'react-i18next';
import {
  Beef,
  CookingPot,
  Hammer,
  Pill,
  Sandwich,
  Store,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { VERTICAL_PRESET_IDS, type VerticalPresetId } from '@puntovivo/shared/vertical-presets';

import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

/**
 * Onboarding step zero: the operator names the business and Puntovivo
 * turns on the matching register surfaces.
 *
 * The vertical ids are the server's preset ids, so picking one both
 * applies the module patch and records `tenants.settings.businessType`
 * in the same transaction — which is what resolves the readiness
 * section this step is built from.
 */
const VERTICAL_ICONS: Record<VerticalPresetId, LucideIcon> = {
  retail: Store,
  restaurant: CookingPot,
  quickservice: Sandwich,
  wholesale: Warehouse,
  hardware: Hammer,
  butchery: Beef,
  pharmacy: Pill,
};

const VERTICALS = VERTICAL_PRESET_IDS.map(id => ({ id, icon: VERTICAL_ICONS[id] }));

export interface BusinessTypePickerProps {
  /** Currently recorded vertical; null until the operator picks one. */
  current: VerticalPresetId | null;
  onApplied?: () => void;
}

export function BusinessTypePicker({ current, onApplied }: BusinessTypePickerProps) {
  const { t } = useTranslation(['companySetupGuide', 'modules', 'errors']);
  const toast = useToast();
  const { updateTenantSettings } = useAuth();
  const utils = trpc.useUtils();

  const applyPreset = useCriticalMutation('modules.applyPreset', {
    onSuccess: async (_result, variables) => {
      updateTenantSettings({ businessType: variables.presetId });
      await Promise.all([
        utils.modules.getEffective.invalidate(),
        utils.modules.list.invalidate(),
        utils.setupReadiness.get.invalidate(),
        utils.setupReadiness.vertical.invalidate(),
      ]);
      onApplied?.();
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'companySetupGuide:businessTypePicker.error',
    }),
  });

  const isApplying = applyPreset.isPending;

  return (
    <section
      className="rounded-2xl border border-line/80 bg-surface-2/40 p-5 sm:p-6"
      data-testid="business-type-picker"
    >
      <h3 className="text-base font-semibold text-secondary-900">
        {t('companySetupGuide:businessTypePicker.title')}
      </h3>
      <p className="mt-1 text-sm text-secondary-600">
        {t('companySetupGuide:businessTypePicker.description')}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {VERTICALS.map(({ id, icon: Icon }) => {
          const label = t(`modules:presets.verticals.${id}`);
          const isCurrent = current === id;
          return (
            <Button
              key={id}
              type="button"
              variant={isCurrent ? 'primary' : 'outline'}
              className="h-auto w-full justify-start gap-3 px-4 py-3 text-left"
              disabled={isApplying}
              aria-pressed={isCurrent}
              data-testid={`business-type-${id}`}
              onClick={() => applyPreset.mutate({ presetId: id })}
            >
              <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
              <span className="font-medium">{label}</span>
            </Button>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-secondary-500" aria-live="polite">
        {isApplying
          ? t('companySetupGuide:businessTypePicker.applying')
          : current
            ? t('companySetupGuide:businessTypePicker.current', {
                vertical: t(`modules:presets.verticals.${current}`),
              })
            : ''}
      </p>
    </section>
  );
}
