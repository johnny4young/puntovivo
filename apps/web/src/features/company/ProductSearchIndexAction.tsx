import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { useIsModuleActive } from '@/features/modules';
import { useRegenerateEmbeddings } from '@/features/products/useRegenerateEmbeddings';
import { cn } from '@/lib/utils';

export function ProductSearchIndexAction() {
  const { t } = useTranslation('aiSettings');
  const { user } = useAuth();
  const semanticSearchActive = useIsModuleActive('semantic-search');
  const regenerate = useRegenerateEmbeddings();

  if (!semanticSearchActive || user?.role !== 'admin') return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/70 pt-4">
      <p className="text-sm font-medium text-ink">{t('card.searchIndexLabel')}</p>
      <button
        type="button"
        data-testid="ai-search-index-update"
        className="btn-outline flex items-center gap-2"
        disabled={regenerate.isPending}
        aria-busy={regenerate.isPending}
        onClick={() => regenerate.mutate()}
      >
        <RefreshCw className={cn('h-4 w-4', regenerate.isPending && 'animate-spin')} aria-hidden />
        {regenerate.isPending ? t('card.searchIndexUpdating') : t('card.searchIndexUpdate')}
      </button>
    </div>
  );
}
