import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { inferRouterInputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

type ReportInput = inferRouterInputs<AppRouter>['registerIncidents']['report'];
type SentKey = 'sent.default' | 'sent.transfer' | 'sent.call';

/** Sends a till incident, then says where the manager will see it and refreshes today's last one. */
export function useReportTillIncident() {
  const { t } = useTranslation('tillIncidents');
  const toast = useToast();
  const utils = trpc.useUtils();
  const sentKey = useRef<SentKey>('sent.default');
  // On the mutation itself, so the confirmation survives the sheet closing mid-request.
  const report = trpc.registerIncidents.report.useMutation({
    onError: onErrorToast(toast, t, { fallbackKey: 'tillIncidents:error' }),
    onSuccess: () => {
      void utils.registerIncidents.latestToday.invalidate();
      toast.success({ title: t(sentKey.current) });
    },
  });
  const send = (input: ReportInput, key: SentKey, onSent: () => void) => {
    sentKey.current = key;
    report.mutate(input, { onSuccess: onSent });
  };
  return { send, isPending: report.isPending };
}
