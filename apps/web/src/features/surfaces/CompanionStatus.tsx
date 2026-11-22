import { useTranslation } from 'react-i18next';

/** Placeholder while a screen's first read is in flight. */
export function CompanionSkeleton() {
  const { t } = useTranslation('companion');
  return (
    <div
      className="min-h-80 animate-pulse rounded-[22px] bg-surface-2 motion-reduce:animate-none"
      role="status"
      aria-label={t('owner.loading')}
    />
  );
}

export function CompanionError({ message }: { message: string }) {
  return (
    <p className="text-sm text-danger-700" role="alert">
      {message}
    </p>
  );
}
