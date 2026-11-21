import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface DaySealProps {
  /** The business day that was closed; the time is when it was signed. */
  date: string;
  signedAt: string;
  timeZone: string;
}

/** The stamp a signed day carries: no motion, so it reads the same with Reduce Motion. */
export function DaySeal({ date, signedAt, timeZone }: DaySealProps) {
  const { t, i18n } = useTranslation('dayCloseGuide');
  const businessDay = new Date(`${date}T12:00:00.000Z`);
  const day = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', timeZone: 'UTC' }).format(
    businessDay
  );
  const month = new Intl.DateTimeFormat(i18n.language, { month: 'short', timeZone: 'UTC' })
    .format(businessDay)
    .replace('.', '')
    .toLocaleUpperCase(i18n.language);
  const time = new Intl.DateTimeFormat(i18n.language, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(signedAt));
  return (
    <div
      data-testid="day-close-seal"
      className={cn(
        'relative flex h-[148px] w-[148px] -rotate-[9deg] flex-col items-center justify-center rounded-full border-[3px] border-success-700 bg-success-50 text-success-700',
        "before:absolute before:inset-[7px] before:rounded-full before:border-[1.5px] before:border-dashed before:border-success-700 before:content-['']"
      )}
    >
      <span className="font-numeric text-[12.5px] font-bold tracking-[0.12em]">
        {t('seal.label')}
      </span>
      <span className="font-numeric text-[32px] font-extrabold leading-[1.05]">
        {day} {month}
      </span>
      <span className="font-mono text-[12px]">{time}</span>
    </div>
  );
}
