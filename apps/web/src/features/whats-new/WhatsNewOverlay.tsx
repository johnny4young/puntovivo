import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Overlay } from '@/components/overlay/Overlay';
import { ModalButton } from '@/components/form-controls/Modal';
import { useAuth } from '@/features/auth/AuthProvider';
import { trpc } from '@/lib/trpc';

/**
 * ENG-092 — per-release announcement overlay.
 *
 * Mounted at the app shell level (above MainLayout). After every
 * authenticated render it fetches the unseen whats-new entries for
 * the current user via `whatsNew.listUnseen`; if any are returned,
 * the most recent one fires the Overlay primitive from ENG-082 with
 * a "NOVEDADES" kicker. Clicking "Lo vi" calls `whatsNew.markSeen`
 * so the same entry does not reappear for the user.
 *
 * The component is intentionally tolerant of network failures —
 * a stale list or a failing markSeen is preferred over blocking the
 * operator behind a noisy overlay.
 */
export function WhatsNewOverlay() {
  const { t } = useTranslation('common');
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const [dismissedNow, setDismissedNow] = useState<Set<string>>(new Set());

  const listQuery = trpc.whatsNew.listUnseen.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const markSeen = trpc.whatsNew.markSeen.useMutation({
    onSuccess: () => {
      void utils.whatsNew.listUnseen.invalidate();
    },
  });

  // Surface the most recent unseen entry that the user hasn't dismissed
  // this session (so dismissal feels instant even before markSeen
  // completes and the listUnseen query refetches).
  const current = useMemo(() => {
    const rows = listQuery.data ?? [];
    return rows.find(row => !dismissedNow.has(row.id));
  }, [listQuery.data, dismissedNow]);

  if (!isAuthenticated || !current) {
    return null;
  }

  const handleDismiss = () => {
    setDismissedNow(prev => {
      const next = new Set(prev);
      next.add(current.id);
      return next;
    });
    markSeen.mutate({ entryId: current.id });
  };

  return (
    <Overlay
      isOpen
      onClose={handleDismiss}
      size="md"
      kicker={t('whatsNew.kicker', { defaultValue: 'Novedades' })}
      title={current.title}
      description={t('whatsNew.versionLabel', {
        defaultValue: 'Versión {{version}}',
        version: current.version,
      })}
      footer={
        <ModalButton
          variant="primary"
          onClick={handleDismiss}
          disabled={markSeen.isPending}
        >
          {t('whatsNew.acknowledge', { defaultValue: 'Lo vi' })}
        </ModalButton>
      }
    >
      <div className="whitespace-pre-line text-sm leading-6 text-secondary-700">
        {current.body}
      </div>
    </Overlay>
  );
}
