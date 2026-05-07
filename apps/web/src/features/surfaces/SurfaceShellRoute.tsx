import { Suspense, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLoadingState } from '@/components/feedback/LoadingState';

export function SurfaceShellRoute({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common');

  return (
    <Suspense
      fallback={
        <PageLoadingState
          title={t('loading.pageTitle')}
          description={t('loading.pageDescription')}
        />
      }
    >
      {children}
    </Suspense>
  );
}
