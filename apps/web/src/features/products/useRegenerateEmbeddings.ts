import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

/** Admin action that brings the smart search index up to date with the catalog. */
export function useRegenerateEmbeddings() {
  const { t } = useTranslation('products');
  const toast = useToast();
  const utils = trpc.useUtils();

  return trpc.products.regenerateEmbeddings.useMutation({
    onSuccess: async data => {
      if (!data.ok) {
        toast.warning({ title: t('semantic.regenerateUnavailable') });
        return;
      }
      toast.success({ title: t('semantic.regenerated', { count: data.embedded }) });
      await Promise.all([
        utils.products.embeddingHealth.invalidate(),
        utils.products.semanticSearch.invalidate(),
      ]);
    },
    onError: onErrorToast(toast, t, { titleKey: 'products:semantic.regenerateError' }),
  });
}
