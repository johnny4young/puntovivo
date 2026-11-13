import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { useEmbeddedServerState } from '@/hooks/useEmbeddedServerState';

/** Refreshes every query and tells the cashier once the server is back. */
export function EmbeddedServerRecovery() {
  const state = useEmbeddedServerState();
  const previous = useRef(state);
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation('common');

  useEffect(() => {
    const wasRestarting = previous.current === 'restarting';
    previous.current = state;
    if (!wasRestarting || state !== 'running') return;
    void queryClient.invalidateQueries();
    toast.info({ title: t('embeddedServer.recovered'), durationMs: 10_000 });
  }, [state, queryClient, toast, t]);

  return null;
}
