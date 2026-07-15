import { Clock3, LogIn, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { formatDateTime } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { onErrorToast } from '@/lib/mutationHelpers';
import { useCriticalMutation } from '@/lib/useCriticalMutation';

interface TimeClockControlProps {
  site: { id: string; name: string } | null;
}

export function TimeClockControl({ site }: TimeClockControlProps) {
  const { t } = useTranslation(['common', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const currentQuery = trpc.employeeShifts.current.useQuery();
  const refreshCurrent = async () => {
    await utils.employeeShifts.current.invalidate();
  };
  const clockInMutation = useCriticalMutation('employeeShifts.clockIn', {
    onSuccess: async () => {
      await refreshCurrent();
      toast.success({ title: t('common:userMenu.timeClock.clockInSuccess') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'common:userMenu.timeClock.errorTitle',
    }),
  });
  const clockOutMutation = useCriticalMutation('employeeShifts.clockOut', {
    onSuccess: async () => {
      await refreshCurrent();
      toast.success({ title: t('common:userMenu.timeClock.clockOutSuccess') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'common:userMenu.timeClock.errorTitle',
    }),
  });

  const current = currentQuery.data ?? null;
  const isMutating = clockInMutation.isPending || clockOutMutation.isPending;

  return (
    <section
      aria-labelledby="time-clock-title"
      className="mt-3 rounded-2xl border border-line bg-surface-2/70 p-3"
    >
      <div className="flex items-center gap-2 text-secondary-950">
        <Clock3 className="h-4 w-4 text-primary-700" aria-hidden="true" />
        <h3 id="time-clock-title" className="text-xs font-semibold uppercase tracking-[0.12em]">
          {t('common:userMenu.timeClock.title')}
        </h3>
      </div>

      {currentQuery.isLoading ? (
        <p className="mt-2 text-xs text-fg2">{t('common:userMenu.timeClock.loading')}</p>
      ) : currentQuery.error ? (
        <p role="alert" className="mt-2 text-xs text-danger-700">
          {t('common:userMenu.timeClock.errorTitle')}
        </p>
      ) : current ? (
        <>
          <p className="mt-2 text-sm font-semibold text-secondary-950">
            {t('common:userMenu.timeClock.clockedIn', {
              time: formatDateTime(current.clockedInAt),
            })}
          </p>
          <p className="mt-1 text-xs text-fg2">
            {t('common:userMenu.timeClock.site', { site: current.siteName })}
          </p>
          <button
            type="button"
            className="btn-outline mt-3 w-full justify-center px-3"
            disabled={isMutating}
            onClick={() => clockOutMutation.mutate({})}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {t('common:userMenu.timeClock.clockOut')}
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 text-xs text-fg2">
            {site
              ? t('common:userMenu.timeClock.site', { site: site.name })
              : t('common:userMenu.timeClock.noSite')}
          </p>
          <button
            type="button"
            className="btn-primary mt-3 w-full justify-center px-3"
            disabled={!site || isMutating}
            onClick={() => {
              if (site) clockInMutation.mutate({ siteId: site.id });
            }}
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            {t('common:userMenu.timeClock.clockIn')}
          </button>
        </>
      )}
    </section>
  );
}
