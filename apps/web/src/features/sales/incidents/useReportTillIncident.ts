import { useTranslation } from 'react-i18next';
import type { inferRouterInputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

type ReportInput = inferRouterInputs<AppRouter>['registerIncidents']['report'];

/** Sends a till incident, then says where the manager will see it and refreshes today's last one. */
export function useReportTillIncident() {
  const { t } = useTranslation('tillIncidents');
  const toast = useToast();
  const utils = trpc.useUtils();
  const report = trpc.registerIncidents.report.useMutation({
    onError: onErrorToast(toast, t, { fallbackKey: 'tillIncidents:error' }),
  });
  const send = (
    input: ReportInput,
    sentKey: 'sent.default' | 'sent.transfer' | 'sent.call',
    onSent: () => void
  ) =>
    report.mutate(input, {
      onSuccess: () => {
        void utils.registerIncidents.latestToday.invalidate();
        toast.success({ title: t(sentKey) });
        onSent();
      },
    });
  return { send, isPending: report.isPending };
}
